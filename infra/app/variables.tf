variable "profile" {
  description = "AWS CLI profile on this PC."
  type        = string
  default     = "soc"
}

variable "instance_type" {
  description = "t4g.micro (1 GB, ~$0.0088/h). t4g.small (2 GB) makes PDFs faster at ~2x cost."
  type        = string
  default     = "t4g.micro"
}

variable "disk_gb" {
  type    = number
  default = 20
}

variable "cpu_credits" {
  description = "unlimited = full speed (tiny surplus charge when busy); standard = never extra, but 10% CPU when out of credits."
  type        = string
  default     = "unlimited"
}
