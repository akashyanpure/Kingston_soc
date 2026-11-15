# ─────────────────────────────────────────────────────────────────────────────
# GUARD stack — permanent, ~$0 while the app is down.
#   • $10/month account-wide budget → email alerts, and a KILL SWITCH (Lambda) that
#     terminates the app server and disables the CloudFront distribution.
#   • CloudFront distribution (stable https://xxxx.cloudfront.net URL). When the app is
#     down it serves an "offline" page from S3; when up it forwards to the server.
#   • S3 bucket for releases and nightly/at-shutdown backups.
#   • Secrets in SSM Parameter Store (standard tier = free).
# Remove everything with:  .\infra\soc.ps1 nuke
# ─────────────────────────────────────────────────────────────────────────────
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.4" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region  = var.region
  profile = var.profile
  default_tags {
    tags = { Project = var.project, Stack = "guard", ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "me" {}

locals {
  account_id = data.aws_caller_identity.me.account_id
  app_up     = var.app_origin != ""
  ssm_prefix = "/${var.project}"
}

# ── S3: releases + backups + offline page ────────────────────────────────────
resource "aws_s3_bucket" "data" {
  bucket        = "${var.project}-data-${local.account_id}"
  force_destroy = true # `nuke` deletes backups too — that is the point of nuke
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-old-releases"
    status = "Enabled"
    filter { prefix = "releases/archive/" }
    expiration { days = 7 }
  }
  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter { prefix = "backups/archive/" }
    expiration { days = var.backup_retention_days }
  }
}

resource "aws_s3_object" "offline_page" {
  bucket        = aws_s3_bucket.data.id
  key           = "offline/index.html"
  content_type  = "text/html; charset=utf-8"
  cache_control = "no-store"
  content       = file("${path.module}/offline.html")
  etag          = filemd5("${path.module}/offline.html")
}

# ── Secrets (persist across up/down so logins and backups keep working) ──────
resource "random_password" "db" {
  length  = 32
  special = false
}
resource "random_password" "session" {
  length  = 48
  special = false
}
resource "random_password" "seed_user" {
  length           = 20
  special          = true
  override_special = "!#%-_"
}
resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "secrets" {
  for_each = {
    db_password    = random_password.db.result
    session_secret = random_password.session.result
    seed_password  = random_password.seed_user.result
    origin_secret  = random_password.origin_secret.result
  }
  name  = "${local.ssm_prefix}/${each.key}"
  type  = "SecureString" # aws/ssm managed key: no KMS charge
  value = each.value
  tier  = "Standard"
}

# ── CloudFront (stable HTTPS URL, free allowance) ────────────────────────────
resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.project}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# When the app is down: API calls get 503 (so the phone's sync keeps work queued — a 200
# offline page would be mistaken for a successful upload); every other path shows the offline page.
resource "aws_cloudfront_function" "offline" {
  name    = "${var.project}-offline"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var req = event.request;
      if (req.uri.indexOf('/api/') === 0) {
        return {
          statusCode: 503,
          statusDescription: 'Service Unavailable',
          headers: {
            'content-type': { value: 'application/json' },
            'retry-after': { value: '300' },
            'cache-control': { value: 'no-store' }
          },
          body: { encoding: 'text', data: '{"error":{"code":"SERVICE_OFFLINE","message":"Kingston SOC is switched off. Your work is kept on the device."}}' }
        };
      }
      req.uri = '/offline/index.html';
      return req;
    }
  JS
}

# AWS managed policies (fixed, documented IDs)
locals {
  cache_disabled_policy  = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  cache_optimized_policy = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  all_viewer_orp         = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true # kill switch sets this false; the next `up` turns it back on
  comment         = "${var.project} (${local.app_up ? "UP" : "offline"})"
  price_class     = "PriceClass_100"
  is_ipv6_enabled = true
  http_version    = "http2and3"

  origin {
    origin_id                = "offline"
    domain_name              = aws_s3_bucket.data.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  dynamic "origin" {
    for_each = local.app_up ? [1] : []
    content {
      origin_id   = "app"
      domain_name = var.app_origin
      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only" # CloudFront ↔ server; server only accepts CloudFront IPs + secret header
        origin_ssl_protocols   = ["TLSv1.2"]
        origin_read_timeout    = 60
      }
      custom_header {
        name  = "X-Origin-Verify"
        value = random_password.origin_secret.result
      }
    }
  }

  default_cache_behavior {
    target_origin_id         = local.app_up ? "app" : "offline"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = local.cache_disabled_policy
    origin_request_policy_id = local.app_up ? local.all_viewer_orp : null

    dynamic "function_association" {
      for_each = local.app_up ? [] : [1]
      content {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.offline.arn
      }
    }
  }

  # Hashed static assets are safe to cache at the edge.
  dynamic "ordered_cache_behavior" {
    for_each = local.app_up ? [1] : []
    content {
      path_pattern           = "/assets/*"
      target_origin_id       = "app"
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true
      cache_policy_id        = local.cache_optimized_policy
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "CloudFrontReadsOfflinePage"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.data.arn}/offline/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "data" {
  bucket = aws_s3_bucket.data.id
  policy = data.aws_iam_policy_document.bucket.json
}
