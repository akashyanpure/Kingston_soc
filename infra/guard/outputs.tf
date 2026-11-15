output "url" {
  value = "https://${aws_cloudfront_distribution.app.domain_name}"
}
output "distribution_id" {
  value = aws_cloudfront_distribution.app.id
}
output "bucket" {
  value = aws_s3_bucket.data.id
}
output "ssm_prefix" {
  value = local.ssm_prefix
}
output "region" {
  value = var.region
}
output "project" {
  value = var.project
}
output "killswitch_function" {
  value = var.enable_killswitch ? aws_lambda_function.killswitch[0].function_name : ""
}
output "budget_name" {
  value = aws_budgets_budget.monthly.name
}
