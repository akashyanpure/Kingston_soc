# Kingston SOC on AWS — on only when you need it

One small server (t4g.micro) that exists only while the app is **up**. A permanent, ~$0
**guard** stack holds the $10/month budget + kill switch, the stable HTTPS URL (CloudFront),
the backup bucket and the secrets.

```
        phone / browser
              │ https://xxxx.cloudfront.net  (stable URL)
        ┌─────▼──────┐   DOWN → offline page (S3); API calls get 503 so the phone keeps work queued
        │ CloudFront │  web app (PWA) always from S3 · /api/* → server
        └─────┬──────┘   UP → secret header, port 80, CloudFront IPs only
   ┌──────────▼───────────────── EC2 t4g.micro (APP stack, destroyed on `down`) ┐
   │ Caddy (web app + /api proxy) → API + PDF worker (Chromium) → PostgreSQL 17  │
   └──────────────────────────────┬─────────────────────────────────────────────┘
                                  │ backups (on down + daily), releases
                            S3 bucket (GUARD stack)
```

## The two commands you need

```powershell
pnpm cloud:up     # START: everything, in one go (first run on a new PC also does init)
pnpm cloud:nuke   # KILL ALL: delete every AWS resource of this project, incl. backups (asks to type 'kingston-soc')
```

To just stop paying but keep the data and URL, use `pnpm cloud:down` instead of `nuke`.

## All commands (from the repo root)

| Command | What it does | Time |
|---|---|---|
| `pnpm cloud:init` | One-time: budget, kill switch, CloudFront URL, bucket, secrets (`up` runs it for you if needed) | ~5 min |
| `pnpm cloud:up` | Create the server, deploy the **last commit**, restore latest backup (or seed demo data) | ~4–6 min (first ever ~15 min) |
| `pnpm cloud:deploy` | Ship only what changed, web and API **in parallel** (`-- -Web` / `-- -Api` to force one) | web ~1 min · API ~1–2 min |
| `pnpm cloud:down` | Back up → offline page → **destroy the server** ($0 afterwards) | ~5 min |
| `pnpm cloud:status` | Up/down, URL, health, spend vs cap | seconds |
| `pnpm cloud:cost` | Month-to-date spend + forecast | seconds |
| `pnpm cloud:backup` | Back up now (while up) | ~1 min |
| `pnpm cloud:logs` | Recent server logs (while up) | seconds |
| `pnpm cloud:users` | Cloud logins + password | seconds |
| `pnpm cloud:killtest` | Dry-run the kill switch (changes nothing) | seconds |
| `pnpm cloud:nuke` | Delete **everything**, including backups | ~15 min |

(Same as `powershell -ExecutionPolicy Bypass -File infra\soc.ps1 <command>`.)

## Spending protection

- The account itself has an **AWS-enforced $20 monthly bill limit**.
- AWS Budget (whole account, $10): emails at **50%**, **100%** actual and **100% forecast**.
- **Kill switch: ON** (default `enable_killswitch = true`, activated 2026-11-17). At 80% ($8) actual
  spend it terminates all EC2 instances in every region, deletes unattached volumes, NAT gateways
  and spare Elastic IPs, stops RDS, disables the CloudFront URL and emails a report
  (`kill_scope = "project"` limits it to this project). Test with `pnpm cloud:killtest`
  (dry run). Confirm the AWS "Subscription Confirmation" emails or the report is not delivered.
  Opt out: `enable_killswitch = false` in `infra/guard/terraform.tfvars`, then `pnpm cloud:init`.
- After the kill switch fires, the server is gone and CloudFront is disabled; `pnpm cloud:up`
  re-enables CloudFront and recreates the server (restoring the last backup).
- AWS billing data lags by hours, so no budget action is a to-the-cent stop.

## Cost

| State | Cost |
|---|---|
| **Down** | ~$0 (a few MB of backups in S3; budget, Lambda, SNS, CloudFront idle within free allowances) |
| **Up** | ~$0.36/day (t4g.micro ~$0.21, public IPv4 $0.12, 20 GB disk ~$0.06) |

## Notes

- Only **committed** code is deployed (`git archive HEAD`).
- Test data only: this is a personal account. Real tenant/landlord data needs the council's own
  AWS account and a DPIA.
- Terraform state lives in `infra/guard` and `infra/app` on this PC (git-ignored; it contains
  secrets). Don't delete those folders while anything is deployed.
- Server shell (optional): install the AWS Session Manager plugin, then
  `aws ssm start-session --target <instance id from cloud:status>`.

## Why deploys are fast

- **Web app** lives in S3 behind CloudFront: built on this PC, uploaded, cache refreshed — no server.
- **API image** is two layers: dependencies (Node packages + Chromium, rebuilt only when the
  lockfile/manifests change, cached in S3 under `cache/`) and a thin code layer (~30–60 s).
- A fresh server downloads the cached dependency layer instead of building it.
- `deploy` compares against the last deployed commit (`releases/deployed.json`) and runs web and
  API in parallel. CloudFront changes don't block (`wait_for_deployment = false`).
- Server CPU credits are `unlimited` (full speed; ~$0.02 surplus per build). Set
  `cpu_credits = "standard"` in `infra/app` to forbid any surplus charge (builds get much slower).
