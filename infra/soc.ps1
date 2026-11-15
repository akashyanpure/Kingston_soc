<#
.SYNOPSIS
  Kingston SOC - AWS on/off control. Run from the repo root:  .\infra\soc.ps1 <command>

.DESCRIPTION
  init     One-time: check tools + AWS login, create the GUARD stack ($10 cap, kill switch,
            CloudFront URL, S3 bucket, secrets). Asks for your alert email the first time.
  up        Create the server, deploy the committed code, restore the latest backup (or seed),
            switch CloudFront to the app. Prints the URL. ~10-15 min.
  deploy    While UP: ship the latest commit to the running server (rebuild + restart).
  down      Back up to S3, switch CloudFront to the offline page, DESTROY the server. $0 after.
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
  [switch]$Force
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

# Run shell commands on the server through SSM (no SSH). Returns stdout; fails on error.
function Invoke-Remote($instanceId, [string[]]$lines, [int]$timeoutSec = 1800) {
  $req = @{
    InstanceIds    = @($instanceId)
    DocumentName   = 'AWS-RunShellScript'
    TimeoutSeconds = 60
    Parameters     = @{ commands = $lines; executionTimeout = @("$timeoutSec") }
  } | ConvertTo-Json -Depth 5
  $f = Join-Path $env:TEMP 'soc-ssm.json'
  [IO.File]::WriteAllText($f, $req)
  $sent = AwsJson ssm send-command --cli-input-json "file://$f"
  $cmdId = $sent.Command.CommandId
  $deadline = (Get-Date).AddSeconds($timeoutSec + 120)
  do {
    Start-Sleep -Seconds 5
    $inv = & $AWS ssm get-command-invocation --command-id $cmdId --instance-id $instanceId --output json 2>$null | Out-String
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
  Say "waiting for $url/api/health (first build ~10-15 min on the small server)"
  $deadline = (Get-Date).AddMinutes($minutes)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "$url/api/health" -UseBasicParsing -TimeoutSec 10
      if ($r.StatusCode -eq 200 -and $r.Content -match '"ok":true') { Write-Host ''; return $true }
    } catch { }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 15
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
    Say "READY. App URL (offline until 'up'): $($g.Url)" 'Green'
    Write-Host 'Budget alerts (50% / 100% / forecast) go to your email. Kill switch: off unless enable_killswitch = true.' -ForegroundColor Yellow
  }

  'up' {
    Assert-Login; Assert-GuardReady
    $g = Get-Guard
    Say 'packaging the last commit'
    Publish-Release $g
    Say 'creating the server (APP stack)'
    TF $App apply -auto-approve -input=false
    $dns = TFOut $App 'public_dns'
    Say 'pointing CloudFront at the server (~3-5 min)'
    Set-Origin $dns
    if (Wait-Healthy $g.Url) {
      Say "UP: $($g.Url)" 'Green'
      Write-Host "Logins: .\infra\soc.ps1 users   |   Stop paying: .\infra\soc.ps1 down"
    } else {
      Write-Host "Not healthy yet. Check '.\infra\soc.ps1 logs' (or the bootstrap log: /var/log/soc-bootstrap.log)." -ForegroundColor Yellow
    }
  }

  'deploy' {
    Assert-Login; Assert-GuardReady
    $id = Get-InstanceId; if (-not $id) { Fail "the app is down - use 'up'" }
    $g = Get-Guard
    Publish-Release $g
    Say 'rebuilding on the server'
    Invoke-Remote $id @(
      'set -euo pipefail', 'source /opt/soc/instance.env',
      'aws s3 cp --only-show-errors "s3://$BUCKET/releases/latest.tar.gz" /opt/soc/release.tar.gz',
      'rm -rf /opt/soc/src.new && mkdir -p /opt/soc/src.new && tar -xzf /opt/soc/release.tar.gz -C /opt/soc/src.new',
      'rm -rf /opt/soc/src && mv /opt/soc/src.new /opt/soc/src',
      'bash /opt/soc/src/infra/server/deploy.sh'
    ) 2400 | Out-Null
    if (Wait-Healthy $g.Url 10) { Say 'DEPLOYED' 'Green' } else { Fail 'deployed, but health check is failing - see logs' }
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
    Say 'switching CloudFront to the offline page'
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
    if ([string]::IsNullOrWhiteSpace($g.Kill)) { Fail "kill switch is off. Enable: add 'enable_killswitch = true' to infra\guard\terraform.tfvars, then run init." }
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
