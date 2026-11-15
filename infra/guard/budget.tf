# ─────────────────────────────────────────────────────────────────────────────
# Monthly budget (account-wide). Email alerts go straight to var.alert_email
# (no SNS needed):  50% actual, 100% actual, 100% forecast.
#
# KILL SWITCH — OFF by default (the account already has an AWS-enforced $20 bill limit,
# user decision 2026-11-15). Kept ready: set `enable_killswitch = true` in
# infra/guard/terraform.tfvars and run `pnpm cloud:init`. When enabled, actual spend at
# kill_at_percent of the cap triggers a Lambda that decommissions billable resources
# (see killswitch.py) and emails a report.
# ─────────────────────────────────────────────────────────────────────────────
locals {
  ks = var.enable_killswitch ? 1 : 0
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly-cap"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_cap_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }

  dynamic "notification" {
    for_each = var.enable_killswitch ? [1] : []
    content {
      comparison_operator       = "GREATER_THAN"
      threshold                 = var.kill_at_percent
      threshold_type            = "PERCENTAGE"
      notification_type         = "ACTUAL"
      subscriber_sns_topic_arns = [aws_sns_topic.kill[0].arn]
    }
  }

  depends_on = [aws_sns_topic_policy.kill]
}

# ── Kill switch (only when enable_killswitch = true) ─────────────────────────
resource "aws_sns_topic" "kill" {
  count = local.ks
  name  = "${var.project}-kill-switch"
}

resource "aws_sns_topic_subscription" "kill_email" {
  count     = local.ks
  topic_arn = aws_sns_topic.kill[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

data "aws_iam_policy_document" "budgets_publish" {
  count = local.ks
  statement {
    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.kill[0].arn]
    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "kill" {
  count  = local.ks
  arn    = aws_sns_topic.kill[0].arn
  policy = data.aws_iam_policy_document.budgets_publish[0].json
}

data "archive_file" "killswitch" {
  count       = local.ks
  type        = "zip"
  source_file = "${path.module}/killswitch.py"
  output_path = "${path.module}/.build/killswitch.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "killswitch" {
  count              = local.ks
  name               = "${var.project}-killswitch"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "killswitch" {
  count = local.ks
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.killswitch[0].arn}:*"]
  }
  statement {
    sid = "Ec2Decommission"
    actions = [
      "ec2:DescribeRegions", "ec2:DescribeInstances", "ec2:TerminateInstances",
      "ec2:DescribeVolumes", "ec2:DeleteVolume", "ec2:DescribeAddresses", "ec2:ReleaseAddress",
      "ec2:DescribeNatGateways", "ec2:DeleteNatGateway",
    ]
    resources = ["*"]
  }
  statement {
    sid       = "RdsStop"
    actions   = ["rds:DescribeDBInstances", "rds:StopDBInstance"]
    resources = ["*"]
  }
  statement {
    sid       = "CloudFrontDisable"
    actions   = ["cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"]
    resources = [aws_cloudfront_distribution.app.arn]
  }
  statement {
    sid       = "Notify"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.kill[0].arn]
  }
}

resource "aws_iam_role_policy" "killswitch" {
  count  = local.ks
  role   = aws_iam_role.killswitch[0].id
  policy = data.aws_iam_policy_document.killswitch[0].json
}

resource "aws_cloudwatch_log_group" "killswitch" {
  count             = local.ks
  name              = "/aws/lambda/${var.project}-killswitch"
  retention_in_days = 14
}

resource "aws_lambda_function" "killswitch" {
  count            = local.ks
  function_name    = "${var.project}-killswitch"
  role             = aws_iam_role.killswitch[0].arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "killswitch.handler"
  filename         = data.archive_file.killswitch[0].output_path
  source_code_hash = data.archive_file.killswitch[0].output_base64sha256
  timeout          = 300
  memory_size      = 128
  environment {
    variables = {
      PROJECT         = var.project
      SCOPE           = var.kill_scope
      DISTRIBUTION_ID = aws_cloudfront_distribution.app.id
      ALERT_TOPIC_ARN = aws_sns_topic.kill[0].arn # report goes to the same email subscription
      HOME_REGION     = var.region
    }
  }
  depends_on = [aws_cloudwatch_log_group.killswitch, aws_iam_role_policy.killswitch]
}

resource "aws_lambda_permission" "sns" {
  count         = local.ks
  statement_id  = "AllowKillTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.killswitch[0].function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.kill[0].arn
}

resource "aws_sns_topic_subscription" "kill_lambda" {
  count     = local.ks
  topic_arn = aws_sns_topic.kill[0].arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.killswitch[0].arn
}
