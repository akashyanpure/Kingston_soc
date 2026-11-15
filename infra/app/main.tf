# ─────────────────────────────────────────────────────────────────────────────
# APP stack — exists only while the app is UP. `soc.ps1 down` backs up and destroys it.
#   one t4g.micro (ARM, 1 GB + 4 GB swap) running Docker: PostgreSQL + API (+Chromium) + Caddy
#   own tiny VPC (public subnet, no NAT), SG open ONLY to CloudFront on :80
#   no SSH: administration via SSM Session Manager
# Running cost ≈ $0.36/day (instance + 20 GB gp3 + public IPv4). $0 when destroyed.
# ─────────────────────────────────────────────────────────────────────────────
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

data "terraform_remote_state" "guard" {
  backend = "local"
  config  = { path = "${path.module}/../guard/terraform.tfstate" }
}

locals {
  g       = data.terraform_remote_state.guard.outputs
  project = local.g.project
}

provider "aws" {
  region  = local.g.region
  profile = var.profile
  default_tags {
    tags = { Project = local.project, Stack = "app", ManagedBy = "terraform" }
  }
}

data "aws_availability_zones" "az" {
  state = "available"
}

# ── Network ──────────────────────────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/24"
  enable_dns_hostnames = true # needed for the public DNS name CloudFront uses as origin
  enable_dns_support   = true
  tags                 = { Name = "${local.project}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.0.0/26"
  availability_zone       = data.aws_availability_zones.az.names[0]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.project}-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "server" {
  name        = "${local.project}-server"
  description = "HTTP from CloudFront only; all outbound"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "CloudFront origin-facing"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ── IAM: SSM management + S3 (releases/backups) + read secrets ───────────────
data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name               = "${local.project}-server"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_caller_identity" "me" {}

data "aws_iam_policy_document" "server" {
  statement {
    sid       = "Bucket"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.g.bucket}"]
  }
  statement {
    sid       = "Objects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${local.g.bucket}/releases/*", "arn:aws:s3:::${local.g.bucket}/backups/*"]
  }
  statement {
    sid       = "Secrets"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = ["arn:aws:ssm:${local.g.region}:${data.aws_caller_identity.me.account_id}:parameter${local.g.ssm_prefix}/*"]
  }
}

resource "aws_iam_role_policy" "server" {
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server.json
}

resource "aws_iam_instance_profile" "server" {
  name = "${local.project}-server"
  role = aws_iam_role.server.name
}

# ── Server ───────────────────────────────────────────────────────────────────
# Latest Amazon Linux 2023 (arm64). Looked up by name: the public SSM "latest AMI"
# parameter is not available in every region.
data "aws_ami" "al2023_arm" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-*-arm64"]
  }
  filter {
    name   = "architecture"
    values = ["arm64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_instance" "server" {
  ami                    = data.aws_ami.al2023_arm.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  # t4g defaults to "unlimited" CPU credits, which can bill extra. "standard" never does.
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2          # containers may need instance credentials
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.disk_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    bucket     = local.g.bucket
    region     = local.g.region
    ssm_prefix = local.g.ssm_prefix
    public_url = local.g.url
  })

  tags = { Name = "${local.project}-server" }

  depends_on = [aws_route_table_association.public, aws_iam_role_policy.server]
}
