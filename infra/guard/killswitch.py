"""
Kingston SOC — budget KILL SWITCH.

Triggered by the monthly budget (SNS) when actual spend passes the kill threshold.
Decommissions billable compute so spend stops growing, then emails a summary.

SCOPE=account (default, as requested: "stop all services and decommission everything"):
    every region: terminate ALL EC2 instances, delete unattached EBS volumes,
    release Elastic IPs, delete NAT gateways, stop RDS instances.
SCOPE=project:
    home region only, resources tagged Project=<PROJECT>.
Always: disable the project's CloudFront distribution.

Manual dry run (lists what it WOULD do, changes nothing):
    aws lambda invoke --function-name kingston-soc-killswitch \
        --cli-binary-format raw-in-base64-out --payload '{"dryRun": true}' out.json
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

PROJECT = os.environ["PROJECT"]
SCOPE = os.environ.get("SCOPE", "account")
DISTRIBUTION_ID = os.environ["DISTRIBUTION_ID"]
ALERT_TOPIC_ARN = os.environ["ALERT_TOPIC_ARN"]
HOME_REGION = os.environ.get("HOME_REGION", "eu-north-1")


def _regions():
    if SCOPE == "project":
        return [HOME_REGION]
    try:
        ec2 = boto3.client("ec2", region_name=HOME_REGION)
        return [r["RegionName"] for r in ec2.describe_regions(AllRegions=False)["Regions"]]
    except ClientError:
        return [HOME_REGION]


def _filters():
    return [{"Name": "tag:Project", "Values": [PROJECT]}] if SCOPE == "project" else []


def _paged(client, op, key, **kw):
    for page in client.get_paginator(op).paginate(**kw):
        yield from page[key]


def handler(event, context):
    dry = bool(isinstance(event, dict) and event.get("dryRun"))
    log = []

    def act(desc, fn):
        if dry:
            log.append(f"[dry-run] {desc}")
            return
        try:
            fn()
            log.append(desc)
        except ClientError as e:  # keep going: partial shutdown beats none
            log.append(f"FAILED {desc}: {e.response['Error']['Code']}")

    def sweep(region):
        ec2 = boto3.client("ec2", region_name=region)
        # EC2 instances
        ids = [
            i["InstanceId"]
            for r in _paged(ec2, "describe_instances", "Reservations", Filters=_filters() + [
                {"Name": "instance-state-name", "Values": ["pending", "running", "stopping", "stopped"]}])
            for i in r["Instances"]
        ]
        if ids:
            act(f"{region}: terminate {len(ids)} instance(s) {ids}", lambda: ec2.terminate_instances(InstanceIds=ids))
        # Unattached EBS volumes (attached root volumes go with their instance)
        for v in _paged(ec2, "describe_volumes", "Volumes", Filters=_filters() + [{"Name": "status", "Values": ["available"]}]):
            vid = v["VolumeId"]
            act(f"{region}: delete volume {vid}", lambda vid=vid: ec2.delete_volume(VolumeId=vid))
        # Elastic IPs (billed even when idle)
        for a in ec2.describe_addresses(Filters=_filters())["Addresses"]:
            if "AllocationId" in a:
                alloc = a["AllocationId"]
                if a.get("AssociationId"):
                    continue  # released automatically with its terminated instance's ENI next run
                act(f"{region}: release EIP {a.get('PublicIp')}", lambda alloc=alloc: ec2.release_address(AllocationId=alloc))
        # NAT gateways (expensive idle)
        for n in _paged(ec2, "describe_nat_gateways", "NatGateways", Filter=_filters() + [{"Name": "state", "Values": ["available", "pending"]}]):
            nid = n["NatGatewayId"]
            act(f"{region}: delete NAT gateway {nid}", lambda nid=nid: ec2.delete_nat_gateway(NatGatewayId=nid))
        # RDS instances (stop; AWS restarts stopped RDS after 7 days, the budget re-fires daily)
        if SCOPE == "account":
            rds = boto3.client("rds", region_name=region)
            for db in _paged(rds, "describe_db_instances", "DBInstances"):
                if db["DBInstanceStatus"] == "available":
                    dbid = db["DBInstanceIdentifier"]
                    act(f"{region}: stop RDS {dbid}", lambda dbid=dbid: rds.stop_db_instance(DBInstanceIdentifier=dbid))

    for region in _regions():
        try:
            sweep(region)
        except ClientError as e:  # e.g. a region this account is not allowed to use
            log.append(f"skipped {region}: {e.response['Error']['Code']}")

    # CloudFront: disable the project distribution (no traffic = no cost)
    cf = boto3.client("cloudfront")
    cfg = cf.get_distribution_config(Id=DISTRIBUTION_ID)
    if cfg["DistributionConfig"]["Enabled"]:
        def disable():
            dc = cfg["DistributionConfig"]
            dc["Enabled"] = False
            cf.update_distribution(Id=DISTRIBUTION_ID, IfMatch=cfg["ETag"], DistributionConfig=dc)
        act(f"disable CloudFront {DISTRIBUTION_ID}", disable)

    summary = (
        f"Kingston SOC kill switch {'DRY RUN' if dry else 'FIRED'} (scope={SCOPE}).\n"
        "Monthly spend passed the kill threshold. Actions:\n  - " + ("\n  - ".join(log) or "nothing to do")
        + "\n\nTo bring the app back after checking costs: .\\infra\\soc.ps1 up"
    )
    print(summary)
    if not dry:
        boto3.client("sns", region_name=HOME_REGION).publish(
            TopicArn=ALERT_TOPIC_ARN, Subject="Kingston SOC: budget kill switch fired", Message=summary)
    return {"dryRun": dry, "actions": log}
