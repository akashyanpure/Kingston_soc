variable "region" {
  description = "AWS region for everything except CloudFront/Budgets (global)."
  type        = string
  default     = "eu-north-1" # Stockholm: the only region this account (new AWS sign-up) may use
}

variable "profile" {
  description = "AWS CLI profile on this PC (created with `aws configure --profile soc`)."
  type        = string
  default     = "soc"
}

variable "project" {
  type    = string
  default = "kingston-soc"
}

variable "alert_email" {
  description = "Email for budget alerts and kill-switch reports (you must confirm the AWS subscription email)."
  type        = string
}

variable "monthly_cap_usd" {
  description = "Monthly budget for the WHOLE AWS account."
  type        = number
  default     = 10
}

variable "enable_killswitch" {
  description = "Create the budget kill switch (SNS + Lambda). ON by default; set false in terraform.tfvars to opt out."
  type        = bool
  default     = true
}

variable "kill_at_percent" {
  description = "Actual spend (% of cap) that fires the kill switch. 80 = $8 of $10; leaves headroom for AWS billing lag."
  type        = number
  default     = 80
}

variable "kill_scope" {
  description = "'account' = decommission ALL EC2/NAT/EIP and stop ALL RDS in every region. 'project' = only resources tagged with this project."
  type        = string
  default     = "account"
  validation {
    condition     = contains(["account", "project"], var.kill_scope)
    error_message = "kill_scope must be 'account' or 'project'."
  }
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "app_origin" {
  description = "Set by soc.ps1: the app server's public DNS name while UP, empty while DOWN (offline page)."
  type        = string
  default     = ""
}
