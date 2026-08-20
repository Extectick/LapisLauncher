[CmdletBinding()]
param(
  [string]$Repository = "Extectick/LapisLauncher",
  [string]$HostName = "147.45.133.170",
  [string]$DeployUser = "lapis-deploy",
  [string]$ExpectedEd25519HostKey = "AAAAC3NzaC1lZDI1NTE5AAAAIAjv7WMegUx8Hh6SBATU9o2K5HS3XFIt5XYyQ7sP4wbu"
)

$ErrorActionPreference = "Stop"
if ($Repository -notmatch "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") {
  throw "Invalid GitHub repository name."
}
if ($HostName -notmatch "^[A-Za-z0-9.-]+$") {
  throw "Invalid deployment host."
}
if ($DeployUser -notmatch "^[a-z_][a-z0-9_-]{0,31}$") {
  throw "Invalid deployment user."
}

$workspaceDirectory = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$privateKeyPath = Join-Path $workspaceDirectory ".local\github-actions\lapis-updates-deploy"
if (-not (Test-Path -LiteralPath $privateKeyPath)) {
  throw "Deployment private key is missing: $privateKeyPath"
}

function Set-GitHubSecret {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$Value
  )

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = "gh"
  foreach ($argument in @("secret", "set", $Name, "--repo", $Repository)) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Unable to start GitHub CLI."
  }
  $process.StandardInput.Write($Value)
  $process.StandardInput.Close()
  $errorOutput = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Unable to set GitHub secret $Name. $errorOutput"
  }
}

Set-GitHubSecret -Name "LAPIS_UPDATE_SSH_PRIVATE_KEY" -Value (Get-Content $privateKeyPath -Raw)
Set-GitHubSecret -Name "LAPIS_UPDATE_SSH_KNOWN_HOSTS" -Value "$HostName ssh-ed25519 $ExpectedEd25519HostKey"
Set-GitHubSecret -Name "LAPIS_UPDATE_SSH_HOST" -Value $HostName
Set-GitHubSecret -Name "LAPIS_UPDATE_SSH_USER" -Value $DeployUser

Write-Output "GitHub deployment secrets configured for $Repository."
Write-Output "Target: ${DeployUser}@${HostName}:/var/www/lapis-updates"
