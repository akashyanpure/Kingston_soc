<#
.SYNOPSIS
  Kingston SOC - AWS on/off control. Run from the repo root:  .\infra\soc.ps1 <command>

.DESCRIPTION
  init      One-time (run automatically by 'up' on a fresh PC): check tools + AWS login, create the GUARD stack ($10 cap, kill switch,
            CloudFront URL, S3 bucket, secrets). Asks for your alert email the first time.
  up        Upload the web app, create the server, deploy the committed API code, restore the
            latest backup (or seed). ~5 min (first ever ~20 min while the dependency cache builds).
  deploy    Ship what changed since the last deploy, in parallel:
              web (apps/web, shared, report)   -> local build + S3 upload, ~1 min, no server needed
              api (apps/api, db, infra/server) -> code layer rebuild on the server, ~1-2 min
            Force one side with -Web or -Api. The web app can be deployed even while DOWN.
  down      Back up to S3, switch the API to 'switched off' (503), DESTROY the server. $0 after.
            The web app stays online (phones keep working offline and sync later).
  status    Up/down, URL, health, month-to-date spend vs the $10 cap.
  cost      Month-to-date spend and forecast.
  backup    While UP: back up database + files to S3 now.
  logs      While UP: last API/web log lines.
  users     Show the cloud login accounts and their password.
  killtest  Dry-run the kill switch, if enabled (lists what it WOULD delete; changes nothing).
  nuke      Remove EVERYTHING incl. backups, budget and kill switch. Asks for confirmation.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'up', 'deploy', 'down', 'status', 'cost', 'backup', 'logs', 'users', 'killtest', 'nuke', 'help')]
  [string]$Command = 'help',
  [switch]$Force,
  [switch]$Web,
  [switch]$Api
)

# 'Continue': in Windows PowerShell 5.1, 'Stop' turns any stderr line from aws/terraform into a
# fatal error. Every native call below checks $LASTEXITCODE and calls Fail instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$Guard = Join-Path $PSScriptRoot 'guard'
$App = Join-Path $PSScriptRoot 'app'
$OriginFile = Join-Path $Guard 'app_origin.auto.tfvars'
$GuardVars = Join-Path $Guard 'terraform.tfvars'
if (-not $env:AWS_PROFILE) { $env:AWS_PROFILE = 'soc' }

function Say($msg, $color = 'Cyan') { Write-Host "`n== $msg" -ForegroundColor $color }
function Fail($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

function Find-Exe($name, $extra) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in $extra) { if (Test-Path $p) { return $p } }
  Fail "$name not found. Install it (winget) and open a new terminal."
}
$TF = Find-Exe 'terraform' @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\terraform.exe")
$AWS = Find-Exe 'aws' @("$env:ProgramFiles\Amazon\AWSCLIV2\aws.exe")
$PNPM = Find-Exe 'pnpm' @("$env:APPDATA\npm\pnpm.cmd")

function TF {
  param([string]$Dir, [Parameter(ValueFromRemainingArguments = $true)][string[]]$TfArgs)
  & $TF "-chdir=$Dir" @TfArgs
  if ($LASTEXITCODE -ne 0) { Fail "terraform $($TfArgs -join ' ') failed in $Dir" }
}
function TFOut($Dir, $Name) {
  $v = & $TF "-chdir=$Dir" output -raw $Name 2>$null
  if ($LASTEXITCODE -ne 0) { return $null }
  return $v
}
function AwsJson {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$A)
  $out = & $AWS @A --output json
  if ($LASTEXITCODE -ne 0) { Fail "aws $($A -join ' ') failed" }
  if ($out) { return ($out | Out-String | ConvertFrom-Json) }
}

function Assert-Login {
  $id = & $AWS sts get-caller-identity --output json 2>$null
  if ($LASTEXITCODE -ne 0) {
    Fail "AWS profile '$env:AWS_PROFILE' is not set up. Run:  aws configure --profile soc   (region eu-north-1)"
  }
  $acct = ($id | Out-String | ConvertFrom-Json).Account
  Write-Host "AWS account $acct (profile $env:AWS_PROFILE)"
}

function Assert-GuardReady {
  if (-not (Test-Path (Join-Path $Guard 'terraform.tfstate'))) { Fail "Run '.\infra\soc.ps1 init' first." }
}

function Get-Guard {
  return @{
    Url    = TFOut $Guard 'url'
    Bucket = TFOut $Guard 'bucket'
    Region = TFOut $Guard 'region'
    Prefix = TFOut $Guard 'ssm_prefix'
    Kill   = TFOut $Guard 'killswitch_function'
    Budget = TFOut $Guard 'budget_name'
    Dist   = TFOut $Guard 'distribution_id'
  }
}

function Get-InstanceId {
  if (-not (Test-Path (Join-Path $App 'terraform.tfstate'))) { return $null }
  $id = TFOut $App 'instance_id'
  if ([string]::IsNullOrWhiteSpace($id)) { return $null }
  return $id
}

function Set-Origin($dns) {
  Set-Content -Path $OriginFile -Value "app_origin = `"$dns`"" -Encoding ASCII
  TF $Guard apply -auto-approve -input=false
}

function Publish-Release($g) {
  Push-Location $Root
  try {
    $dirty = git status --porcelain --untracked-files=no
    if ($dirty) { Write-Host "WARNING: uncommitted changes are NOT deployed (only the last commit is):" -ForegroundColor Yellow; $dirty | Write-Host }
    $sha = (git rev-parse --short HEAD).Trim()
    $tmp = Join-Path $env:TEMP "soc-release-$sha.tar.gz"
    git archive --format=tar.gz -o $tmp HEAD
    if ($LASTEXITCODE -ne 0) { Fail 'git archive failed' }
    & $AWS s3 cp $tmp "s3://$($g.Bucket)/releases/archive/$sha.tar.gz" --only-show-errors
    & $AWS s3 cp $tmp "s3://$($g.Bucket)/releases/latest.tar.gz" --only-show-errors
    if ($LASTEXITCODE -ne 0) { Fail 'upload of release failed' }
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Host "Release $sha uploaded."
  } finally { Pop-Location }
}

# Run shell commands on the server through SSM (no SSH).
# Start-Remote returns at once (so other work can run in parallel); Wait-Remote collects the result.
function Start-Remote($instanceId, [string[]]$lines, [int]$timeoutSec = 1800) {
  $req = @{
    InstanceIds    = @($instanceId)
    DocumentName   = 'AWS-RunShellScript'
    TimeoutSeconds = 60
    Parameters     = @{ commands = $lines; executionTimeout = @("$timeoutSec") }
  } | ConvertTo-Json -Depth 5
  $f = Join-Path $env:TEMP 'soc-ssm.json'
  [IO.File]::WriteAllText($f, $req)
  $sent = AwsJson ssm send-command --cli-input-json "file://$f"
  return @{ Id = $sent.Command.CommandId; Instance = $instanceId; Timeout = $timeoutSec }
}
function Wait-Remote($job) {
  $deadline = (Get-Date).AddSeconds($job.Timeout + 120)
  do {
    Start-Sleep -Seconds 5
    $inv = & $AWS ssm get-command-invocation --command-id $job.Id --instance-id $job.Instance --output json 2>$null | Out-String
    if ($LASTEXITCODE -ne 0) { continue }
    $inv = $inv | ConvertFrom-Json
    Write-Host -NoNewline '.'
  } while ($inv.Status -in @('Pending', 'InProgress', 'Delayed') -and (Get-Date) -lt $deadline)
  Write-Host ''
  if ($inv.StandardOutputContent) { Write-Host $inv.StandardOutputContent }
  if ($inv.Status -ne 'Success') {
    if ($inv.StandardErrorContent) { Write-Host $inv.StandardErrorContent -ForegroundColor Yellow }
    throw "remote command $($inv.Status)"
  }
  return $inv.StandardOutputContent
}
function Invoke-Remote($instanceId, [string[]]$lines, [int]$timeoutSec = 1800) {
  return Wait-Remote (Start-Remote $instanceId $lines $timeoutSec)
}

# -- Web app: built on this PC, served by CloudFront from S3 (no server involved) --
function Deploy-Web($g) {
  # Build from the LAST COMMIT in a separate worktree, so unfinished edits in the working
  # folder never ship (same rule as the API). pnpm's shared store makes the install fast.
  $wt = Join-Path $env:TEMP 'soc-web-build'
  Push-Location $Root
  try {
    $sha = (git rev-parse --short HEAD).Trim()
    Say "web: building commit $sha"
    if (Test-Path (Join-Path $wt '.git')) {
      git -C $wt checkout --quiet --detach --force HEAD 2>$null
      if ($LASTEXITCODE -ne 0) { git -C $wt checkout --quiet --detach --force $sha }
    } else {
      git worktree prune
      git worktree add --quiet --detach --force $wt HEAD
      if ($LASTEXITCODE -ne 0) { Fail 'could not create the build worktree' }
    }
    git -C $wt checkout --quiet --detach --force $sha
    Push-Location $wt
    try {
      & $PNPM install --frozen-lockfile --prefer-offline --filter kingston-soc --filter '@soc/web...' --reporter=silent
      if ($LASTEXITCODE -ne 0) { Fail 'web dependency install failed' }
      & $PNPM --filter @soc/web build | Out-Null
      if ($LASTEXITCODE -ne 0) { Fail 'web build failed' }
    } finally { Pop-Location }
    $dist = Join-Path $wt 'apps\web\dist'
    Say 'web: uploading to S3'
    # Hashed assets: cache for a year. Everything else (index.html, sw.js, manifest, icons): always revalidate.
    & $AWS s3 sync "$dist\assets" "s3://$($g.Bucket)/web/assets" --exclude '*.map' --cache-control 'public,max-age=31536000,immutable' --only-show-errors
    if ($LASTEXITCODE -ne 0) { Fail 'web upload (assets) failed' }
    & $AWS s3 sync $dist "s3://$($g.Bucket)/web" --delete --exclude 'assets/*' --exclude '*.map' --cache-control 'no-cache' --only-show-errors
    if ($LASTEXITCODE -ne 0) { Fail 'web upload failed' }
    & $AWS cloudfront create-invalidation --distribution-id $g.Dist --paths '/*' --output text | Out-Null
    Write-Host "web: $sha live (CloudFront refresh ~30-60 s; installed apps update on next open)"
  } finally { Pop-Location }
}

$WebPaths = @('apps/web/', 'packages/shared/', 'packages/report/', 'pnpm-lock.yaml', 'package.json')
$ApiPaths = @('apps/api/', 'packages/db/', 'packages/shared/', 'packages/report/', 'infra/server/', 'pnpm-lock.yaml', 'package.json')

function Get-Deployed($g) {
  $f = Join-Path $env:TEMP 'soc-deployed.json'
  if (Test-Path $f) { Remove-Item $f }
  & $AWS s3 cp "s3://$($g.Bucket)/releases/deployed.json" $f --only-show-errors 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $f)) { return @{ web = ''; api = '' } }
  $j = Get-Content $f -Raw | ConvertFrom-Json
  Remove-Item $f -ErrorAction SilentlyContinue
  return @{ web = "$($j.web)"; api = "$($j.api)" }
}
function Set-Deployed($g, $d) {
  $f = Join-Path $env:TEMP 'soc-deployed.json'
  [IO.File]::WriteAllText($f, (@{ web = $d.web; api = $d.api } | ConvertTo-Json))
  & $AWS s3 cp $f "s3://$($g.Bucket)/releases/deployed.json" --only-show-errors | Out-Null
  Remove-Item $f -ErrorAction SilentlyContinue
}
function Test-Changed($sha, $paths) {
  if ([string]::IsNullOrWhiteSpace($sha)) { return $true }
  Push-Location $Root
  try {
    $files = git diff --name-only $sha HEAD 2>$null
    if ($LASTEXITCODE -ne 0) { return $true }
    foreach ($file in $files) { foreach ($p in $paths) { if ($file.StartsWith($p)) { return $true } } }
    return $false
  } finally { Pop-Location }
}
function Get-HeadSha { Push-Location $Root; try { return (git rev-parse --short HEAD).Trim() } finally { Pop-Location } }

$DeployApiLines = @(
  'set -euo pipefail', 'source /opt/soc/instance.env',
  'aws s3 cp --only-show-errors "s3://$BUCKET/releases/latest.tar.gz" /opt/soc/release.tar.gz',
  'rm -rf /opt/soc/src.new && mkdir -p /opt/soc/src.new && tar -xzf /opt/soc/release.tar.gz -C /opt/soc/src.new',
  'rm -rf /opt/soc/src && mv /opt/soc/src.new /opt/soc/src',
  'bash /opt/soc/src/infra/server/deploy.sh'
)

function Wait-SsmOnline($instanceId) {
  Say 'waiting for the server to register with SSM'
  for ($i = 0; $i -lt 60; $i++) {
    $info = AwsJson ssm describe-instance-information --filters "Key=InstanceIds,Values=$instanceId"
    if ($info.InstanceInformationList.Count -gt 0 -and $info.InstanceInformationList[0].PingStatus -eq 'Online') { return }
    Start-Sleep -Seconds 10
  }
  Fail 'server did not come online in SSM within 10 minutes'
}

function Wait-Healthy($url, [int]$minutes = 30) {
  Say "waiting for $url/api/health (fresh server ~4-6 min)"
  $deadline = (Get-Date).AddMinutes($minutes)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200 -and $r.Content -match '"ok":true') { Write-Host ''; return $true }
    } catch { }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 5
  }
  Write-Host ''
  return $false
}

function Show-Spend($g) {
  $b = AwsJson budgets describe-budget --account-id ((AwsJson sts get-caller-identity).Account) --budget-name $g.Budget
  $actual = [double]$b.Budget.CalculatedSpend.ActualSpend.Amount
  $fc = $b.Budget.CalculatedSpend.ForecastedSpend
  $limit = [double]$b.Budget.BudgetLimit.Amount
  Write-Host ("Month-to-date spend: `${0:N2} of `${1:N2} cap" -f $actual, $limit)
  if ($fc) { Write-Host ("Forecast for the month: `${0:N2}" -f [double]$fc.Amount) }
  Write-Host '(AWS updates billing data a few times a day; the kill switch fires at the configured % of the cap.)'
}

switch ($Command) {
  'help' { (Get-Help $PSCommandPath).Description.Text | Out-Host }

  'init' {
    Assert-Login
    if (-not (Test-Path $GuardVars)) {
      $email = Read-Host 'Email for cost alerts and kill-switch reports'
      if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Fail 'that does not look like an email address' }
      Set-Content -Path $GuardVars -Value "alert_email = `"$email`"" -Encoding ASCII
    }
    if (-not (Test-Path $OriginFile)) { Set-Content -Path $OriginFile -Value 'app_origin = ""' -Encoding ASCII }
    Say 'terraform init'
    TF $Guard init -input=false -upgrade
    TF $App init -input=false -upgrade
    Say 'creating GUARD stack (budget, kill switch, CloudFront, bucket, secrets) - CloudFront takes ~5 min'
    TF $Guard apply -auto-approve -input=false
    $g = Get-Guard
    Deploy-Web $g
    $d = Get-Deployed $g; $d.web = Get-HeadSha; Set-Deployed $g $d
    Say "READY. App URL: $($g.Url)  (the API is 'switched off' until 'up')" 'Green'
    Write-Host 'Budget alerts (50% / 100% / forecast) go to your email. Kill switch: ON at 80% of the cap.' -ForegroundColor Yellow
    Write-Host 'IMPORTANT: confirm the two AWS "Subscription Confirmation" emails, or the kill-switch report is not delivered.' -ForegroundColor Yellow
  }

  'up' {
    Assert-Login
    if (-not (Test-Path (Join-Path $Guard 'terraform.tfstate'))) {
      Say 'first run on this PC: creating the GUARD stack first (init)'
      & $PSCommandPath init
      if ($LASTEXITCODE -ne 0) { Fail 'init failed' }
    }
    Assert-GuardReady
    $g = Get-Guard
    Say 'packaging the last commit'
    Publish-Release $g
    Say 'creating the server (APP stack)'
    TF $App apply -auto-approve -input=false
    $dns = TFOut $App 'public_dns'
    Say 'pointing CloudFront at the server'
    Set-Origin $dns
    # The server is now booting on its own (~3-5 min); upload the web app meanwhile.
    Deploy-Web $g
    if (Wait-Healthy $g.Url) {
      $sha = Get-HeadSha; Set-Deployed $g @{ web = $sha; api = $sha }
      Say "UP: $($g.Url)" 'Green'
      Write-Host "Logins: .\infra\soc.ps1 users   |   Stop paying: .\infra\soc.ps1 down"
    } else {
      Write-Host "Not healthy yet. Check '.\infra\soc.ps1 logs' (or the bootstrap log: /var/log/soc-bootstrap.log)." -ForegroundColor Yellow
    }
  }

  'deploy' {
    Assert-Login; Assert-GuardReady
    $g = Get-Guard
    $id = Get-InstanceId
    $d = Get-Deployed $g
    $doWeb = $Web -or (-not $Api -and (Test-Changed $d.web $WebPaths))
    $doApi = $Api -or (-not $Web -and (Test-Changed $d.api $ApiPaths))
    if ($doApi -and -not $id) {
      if ($Api) { Fail "the server is down - use 'up' (it deploys the API)" }
      Write-Host 'API changes will go out with the next up (the server is down).' -ForegroundColor Yellow
      $doApi = $false
    }
    if (-not $doWeb -and -not $doApi) { Say 'nothing changed since the last deploy (force with -Web or -Api)' 'Green'; break }
    $sha = Get-HeadSha
    $parts = @(); if ($doWeb) { $parts += 'web' }; if ($doApi) { $parts += 'api' }
    Write-Host ("Deploying {0} at {1}" -f ($parts -join ' + '), $sha)
    $job = $null
    if ($doApi) {
      Publish-Release $g
      Say 'api: rebuilding the code layer on the server (in parallel)'
      $job = Start-Remote $id $DeployApiLines 2400
    }
    if ($doWeb) { Deploy-Web $g; $d.web = $sha }
    if ($job) {
      Say 'api: waiting for the server'
      Wait-Remote $job | Out-Null
      if (-not (Wait-Healthy $g.Url 10)) { Fail 'API deployed, but the health check is failing - see logs' }
      $d.api = $sha
    }
    Set-Deployed $g $d
    Say 'DEPLOYED' 'Green'
  }

  'down' {
    Assert-Login; Assert-GuardReady
    $id = Get-InstanceId
    if ($id) {
      Say 'backing up to S3'
      try { Invoke-Remote $id @('bash /opt/soc/src/infra/server/backup.sh') 900 | Out-Null }
      catch {
        if (-not $Force) { Fail "backup failed ($_). Data would be lost. Fix it, or re-run with -Force to destroy anyway." }
        Write-Host "backup failed, continuing because of -Force" -ForegroundColor Yellow
      }
    }
    Say "switching the API to 'switched off'"
    Set-Origin ''
    if (Test-Path (Join-Path $App 'terraform.tfstate')) {
      Say 'destroying the server (APP stack)'
      TF $App destroy -auto-approve -input=false
    }
    Say 'DOWN. Nothing billable is running (backups stay in S3).' 'Green'
  }

  'status' {
    Assert-Login; Assert-GuardReady
    $g = Get-Guard
    $id = Get-InstanceId
    Write-Host "URL:    $($g.Url)"
    Write-Host "Server: $(if ($id) { $id } else { 'none (DOWN)' })"
    try { $r = Invoke-WebRequest -Uri "$($g.Url)/api/health" -UseBasicParsing -TimeoutSec 10; Write-Host "Health: $($r.Content)" }
    catch { Write-Host "Health: not serving ($($_.Exception.Message))" }
    Show-Spend $g
  }

  'cost' { Assert-Login; Assert-GuardReady; Show-Spend (Get-Guard) }

  'backup' {
    Assert-Login; Assert-GuardReady
    $id = Get-InstanceId; if (-not $id) { Fail 'the app is down (it was backed up when it went down)' }
    Invoke-Remote $id @('bash /opt/soc/src/infra/server/backup.sh') 900 | Out-Null
  }

  'logs' {
    Assert-Login; Assert-GuardReady
    $id = Get-InstanceId; if (-not $id) { Fail 'the app is down' }
    Invoke-Remote $id @(
      'echo "--- containers"; docker ps --format "{{.Names}}  {{.Status}}" || true',
      'echo "--- api"; docker logs --tail 60 soc-api 2>&1 || true',
      'echo "--- web"; docker logs --tail 20 soc-web 2>&1 || true',
      'echo "--- bootstrap"; tail -n 30 /var/log/soc-bootstrap.log || true'
    ) 120 | Out-Null
  }

  'users' {
    Assert-Login; Assert-GuardReady
    $g = Get-Guard
    $pw = (AwsJson ssm get-parameter --with-decryption --name "$($g.Prefix)/seed_password").Parameter.Value
    Write-Host "URL: $($g.Url)"
    Write-Host "Password for all seeded users: $pw"
    Write-Host '  p.dekaate@kingston.test (officer)   manager@kingston.test (manager)   admin@kingston.test (admin)'
  }

  'killtest' {
    Assert-Login; Assert-GuardReady
    $g = Get-Guard
    if ([string]::IsNullOrWhiteSpace($g.Kill)) { Fail "kill switch is off (enable_killswitch = false in infra\guard\terraform.tfvars). Remove that line, then run init." }
    $out = Join-Path $env:TEMP 'soc-killtest.json'
    $payloadFile = Join-Path $env:TEMP 'soc-killtest-payload.json'
    [IO.File]::WriteAllText($payloadFile, '{"dryRun": true}')
    & $AWS lambda invoke --function-name $g.Kill --cli-binary-format raw-in-base64-out --payload "file://$payloadFile" $out | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'invoke failed' }
    Get-Content $out | ConvertFrom-Json | ConvertTo-Json -Depth 5
  }

  'nuke' {
    Assert-Login; Assert-GuardReady
    Write-Host 'This deletes the server, ALL BACKUPS, the CloudFront URL, the budget and the kill switch.' -ForegroundColor Red
    $c = Read-Host "Type 'kingston-soc' to confirm"
    if ($c -ne 'kingston-soc') { Fail 'cancelled' }
    if (Test-Path (Join-Path $App 'terraform.tfstate')) { TF $App destroy -auto-approve -input=false }
    Set-Content -Path $OriginFile -Value 'app_origin = ""' -Encoding ASCII
    Say 'destroying GUARD stack (CloudFront deletion takes ~15 min)'
    TF $Guard destroy -auto-approve -input=false
    Say 'NUKED. Nothing from this project remains in AWS.' 'Green'
  }
}
