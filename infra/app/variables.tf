variable "profile" {
  description = "AWS CLI profile on this PC."
  type        = string
  default     = "soc"
}

variable "instance_type" {
  description = "t4g.micro (1 GB, ~$0.0088/h in London). t4g.small (2 GB) makes PDFs faster at ~2x cost."
  type        = string
  default     = "t4g.micro"
}

variable "disk_gb" {
  type    = number
  default = 20
}
