# Kingston SOC on AWS — on only when you need it

One small server (t4g.micro) that exists only while the app is **up**. A permanent, ~$0
**guard** stack holds the $10/month budget + kill switch, the stable HTTPS URL (CloudFront),
the backup bucket and the secrets.

```
        phone / browser
              │ https://xxxx.cloudfront.net  (stable URL)
        ┌─────▼──────┐   DOWN → offline page (S3); API calls get 503 so the phone keeps work queued
        │ CloudFront │
        └─────┬──────┘   UP → secret header, port 80, CloudFront IPs only
   ┌──────────▼───────────────── EC2 t4g.micro (APP stack, destroyed on `down`) ┐
   │ Caddy (web app + /api proxy) → API + PDF worker (Chromium) → PostgreSQL 17  │
   └──────────────────────────────┬─────────────────────────────────────────────┘
                                  │ backups (on down + daily), releases
                            S3 bucket (GUARD stack)
```

## Commands (from the repo root)

| Command | What it does | Time |
|---|---|---|
| `pnpm cloud:init` | One-time: budget, kill switch, CloudFront URL, bucket, secrets | ~5 min |
| `pnpm cloud:up` | Create the server, deploy the **last commit**, restore latest backup (or seed demo data) | ~10–15 min |
| `pnpm cloud:deploy` | While up: ship the latest commit | ~5–10 min |
| `pnpm cloud:down` | Back up → offline page → **destroy the server** ($0 afterwards) | ~5 min |
| `pnpm cloud:status` | Up/down, URL, health, spend vs cap | seconds |
| `pnpm cloud:cost` | Month-to-date spend + forecast | seconds |
| `pnpm cloud:backup` | Back up now (while up) | ~1 min |
| `pnpm cloud:logs` | Recent server logs (while up) | seconds |
| `pnpm cloud:users` | Cloud logins + password | seconds |
| `pnpm cloud:killtest` | Dry-run the kill switch (changes nothing) | seconds |
| `pnpm cloud:nuke` | Delete **everything**, including backups | ~15 min |

(Same as `powershell -ExecutionPolicy Bypass -File infra\soc.ps1 <command>`.)

## The $10 cap

- AWS Budget on the **whole account**: email at 50% ($5) actual and 100% forecast.
- At **80% ($8) actual** the kill switch Lambda runs: terminates **all EC2 instances in every
  region**, deletes unattached volumes, NAT gateways and spare Elastic IPs, stops RDS, and disables
  the CloudFront URL — then emails a report. (`kill_scope = "project"` in
  `infra/guard/terraform.tfvars` limits it to this project's resources.)
- It fires below $10 because AWS billing data lags by hours. It is a strong guard, not a
  to-the-cent hard limit; AWS has no hard spending stop.
- Bring the app back after checking: `pnpm cloud:up`.

## Cost

| State | Cost |
|---|---|
| **Down** | ~$0 (a few MB of backups in S3; budget, Lambda, SNS, CloudFront idle within free allowances) |
| **Up** | ~$0.36/day (t4g.micro ~$0.21, public IPv4 $0.12, 20 GB disk ~$0.06) |

## Notes

- Only **committed** code is deployed (`git archive HEAD`).
- Test data only: this is a personal account. Real tenant/landlord data needs the council's own
  AWS account and a DPIA.
- Terraform state lives in `infra/guard` and `infra/app` on this PC (git-ignored; it contains
  secrets). Don't delete those folders while anything is deployed.
- Server shell (optional): install the AWS Session Manager plugin, then
  `aws ssm start-session --target <instance id from cloud:status>`.
