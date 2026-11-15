# ─────────────────────────────────────────────────────────────────────────────
# $10/month cap (account-wide: covers ALL usage in this AWS account).
#   50%  actual     → email
#   100% forecast   → email
#   kill_at_percent actual (default 80% = $8) → KILL SWITCH + email
# AWS billing data lags by several hours, so the switch fires below $10 to leave
# headroom. Budgets and the switch cost nothing at this size (first 2 budgets free,
# Lambda/SNS within the always-free allowance).
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-cost-alerts"
}

resource "aws_sns_topic" "kill" {
  name = "${var.project}-kill-switch"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

data "aws_iam_policy_document" "budgets_publish" {
  for_each = { alerts = aws_sns_topic.alerts.arn, kill = aws_sns_topic.kill.arn }
  statement {
    actions   = ["SNS:Publish"]
    resources = [each.value]
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

resource "aws_sns_topic_policy" "budgets" {
  for_each = { alerts = aws_sns_topic.alerts.arn, kill = aws_sns_topic.kill.arn }
  arn      = each.value
  policy   = data.aws_iam_policy_document.budgets_publish[each.key].json
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-monthly-cap"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.monthly_cap_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 50
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = var.kill_at_percent
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.kill.arn]
  }

  depends_on = [aws_sns_topic_policy.budgets]
}

# ── Kill switch Lambda ───────────────────────────────────────────────────────
data "archive_file" "killswitch" {
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
  name               = "${var.project}-killswitch"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "killswitch" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.killswitch.arn}:*"]
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
    resources = [aws_sns_topic.alerts.arn]
  }
}

resource "aws_iam_role_policy" "killswitch" {
  role   = aws_iam_role.killswitch.id
  policy = data.aws_iam_policy_document.killswitch.json
}

resource "aws_cloudwatch_log_group" "killswitch" {
  name              = "/aws/lambda/${var.project}-killswitch"
  retention_in_days = 14
}

resource "aws_lambda_function" "killswitch" {
  function_name    = "${var.project}-killswitch"
  role             = aws_iam_role.killswitch.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "killswitch.handler"
  filename         = data.archive_file.killswitch.output_path
  source_code_hash = data.archive_file.killswitch.output_base64sha256
  timeout          = 300
  memory_size      = 128
  environment {
    variables = {
      PROJECT         = var.project
      SCOPE           = var.kill_scope
      DISTRIBUTION_ID = aws_cloudfront_distribution.app.id
      ALERT_TOPIC_ARN = aws_sns_topic.alerts.arn
      HOME_REGION     = var.region
    }
  }
  depends_on = [aws_cloudwatch_log_group.killswitch, aws_iam_role_policy.killswitch]
}

resource "aws_lambda_permission" "sns" {
  statement_id  = "AllowKillTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.killswitch.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.kill.arn
}

resource "aws_sns_topic_subscription" "kill_lambda" {
  topic_arn = aws_sns_topic.kill.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.killswitch.arn
}
