# Kingston SOC — Inventory & Schedule of Condition app

Mobile web app (PWA) that automates the Royal Borough of Kingston's *Schedule of Condition*
form (`Project_info_files/SOC TEMPLATE (PLS).docx` is the source of truth).
Monorepo: `apps/web` (PWA), `apps/api` (API + PDF), `packages/*` (db, shared, report), `infra/` (AWS).

## Run it on AWS — one command to start, one command to stop

```powershell
pnpm cloud:up     # START the whole app on AWS (~5 min; first time on a PC ~20 min)
pnpm cloud:down   # STOP: back up, then destroy the server. Nothing billable left running (~$0)
```

`down` keeps the backups and the app URL, so the next `pnpm cloud:up` restores everything.

| You want to… | Run |
|---|---|
| Start everything | `pnpm cloud:up` |
| **Stop everything billable (~$0), keep data** | `pnpm cloud:down` |
| Permanently delete the whole project from AWS, incl. backups (rarely needed) | `pnpm cloud:nuke` |
| See if it's up and what it costs | `pnpm cloud:status` |
| Ship new commits while up | `pnpm cloud:deploy` |
| Get the login password | `pnpm cloud:users` |

Only **committed** code is deployed. Full details: [infra/README.md](infra/README.md).

### One-time prerequisites (Windows)

1. `winget install Hashicorp.Terraform Amazon.AWSCLI OpenJS.NodeJS.LTS` then `npm i -g pnpm`, and `pnpm install`.
2. `aws configure --profile soc` — access key of your AWS account, region **eu-north-1**.
3. First `pnpm cloud:up` asks for an email for cost alerts. **Confirm the AWS subscription
   emails** it sends.

### Cost safety (always on)

- $10/month AWS Budget for the whole account: email at 50%, 100% and forecast 100%.
- **Kill switch ON:** at $8 actual spend a Lambda terminates EC2 instances (all regions), deletes
  spare volumes/NAT/Elastic IPs, stops RDS, disables the CloudFront URL and emails a report.
  Dry run (changes nothing): `pnpm cloud:killtest`. After it fires, `pnpm cloud:up` brings it back.
- AWS billing data lags by hours, so it is not a to-the-cent stop.

## Run it locally

```powershell
copy .env.example .env   # fill in DATABASE_URL etc. (needs PostgreSQL)
pnpm install
pnpm db:migrate; pnpm db:seed
pnpm dev                 # API + web
```
