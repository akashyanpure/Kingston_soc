# Kingston SOC — notes for Claude

- Source of truth for the form: `Project_info_files/SOC TEMPLATE (PLS).docx`. Load the
  `soc-template-form` skill first for any form/data/report work; other `soc-*` skills in
  `.claude/skills/` cover the domain, report, brief and build prompts.
- Windows PC, PowerShell. Package manager: pnpm workspace.

## AWS (see infra/README.md)

- **Start everything:** `pnpm cloud:up` (runs `init` automatically on a fresh PC).
- **Stop everything billable:** `pnpm cloud:down` (backs up to S3, destroys the server; ~$0
  afterwards; `up` restores). This is the standard "kill" command.
- `pnpm cloud:nuke` permanently deletes everything incl. backups (interactive: the user must type
  `kingston-soc`); never run it without the user's explicit request.
- Kill switch is **ON** (`enable_killswitch` defaults to true in `infra/guard/variables.tf`): at
  80% of the $10 cap it decommissions EC2/NAT/EIP/RDS in all regions and disables CloudFront.
  `pnpm cloud:killtest` is a safe dry run.
- AWS CLI profile `soc`, region `eu-north-1` (the only region the account allows).
- Terraform state is local in `infra/guard` and `infra/app` (git-ignored, holds secrets). Never
  delete it while anything is deployed.
- Deploys use the last **commit** (`git archive HEAD`), so commit before `cloud:up`/`cloud:deploy`.
