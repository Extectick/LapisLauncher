[CmdletBinding()]
param(
  [string]$Repository = "Extectick/LapisLauncher",
  [string]$CertificateSubject = "CN=Lapis Launcher CI Development",
  [int]$ValidYears = 3
)

$ErrorActionPreference = "Stop"
Import-Module PKI -ErrorAction Stop

if ($Repository -notmatch "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$") {
  throw "Invalid GitHub repository name."
}

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI is not authenticated. Run gh auth login first."
}

$workspaceDirectory = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$certificateDirectory = Join-Path $workspaceDirectory ".local\certificates"
$pfxPath = Join-Path $certificateDirectory "LapisLauncherCI.pfx"
$publicCertificatePath = Join-Path $certificateDirectory "LapisLauncherCI.cer"
$protectedPasswordPath = Join-Path $certificateDirectory "LapisLauncherCI.password.dpapi"
New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null

$codeSigningOid = "1.3.6.1.5.5.7.3.3"
$certificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object {
    $_.Subject -eq $CertificateSubject -and
    $_.HasPrivateKey -and
    $_.NotAfter -gt (Get-Date).AddDays(30) -and
    $_.EnhancedKeyUsageList.ObjectId -contains $codeSigningOid
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

$plainPassword = $null
if (
  $certificate -and
  (Test-Path -LiteralPath $pfxPath) -and
  (Test-Path -LiteralPath $protectedPasswordPath)
) {
  $securePassword = Get-Content -LiteralPath $protectedPasswordPath -Raw |
    ConvertTo-SecureString
  $plainPassword = [Net.NetworkCredential]::new("", $securePassword).Password
} else {
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $CertificateSubject `
    -FriendlyName "Lapis Launcher CI Development Code Signing" `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears($ValidYears)

  $passwordBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
  $plainPassword = [Convert]::ToBase64String($passwordBytes)
  $securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
  Export-PfxCertificate `
    -Cert $certificate `
    -FilePath $pfxPath `
    -Password $securePassword `
    -CryptoAlgorithmOption AES256_SHA256 `
    -Force | Out-Null
  $securePassword |
    ConvertFrom-SecureString |
    Set-Content -LiteralPath $protectedPasswordPath -NoNewline
}

Export-Certificate `
  -Cert $certificate `
  -FilePath $publicCertificatePath `
  -Force | Out-Null

function Set-GitHubSecret {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [string]$Value
  )

  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = "gh"
  $startInfo.ArgumentList.Add("secret")
  $startInfo.ArgumentList.Add("set")
  $startInfo.ArgumentList.Add($Name)
  $startInfo.ArgumentList.Add("--repo")
  $startInfo.ArgumentList.Add($Repository)
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

$pfxBase64 = [Convert]::ToBase64String(
  [IO.File]::ReadAllBytes($pfxPath)
)
Set-GitHubSecret -Name "WINDOWS_CODE_SIGNING_PFX_BASE64" -Value $pfxBase64
Set-GitHubSecret -Name "WINDOWS_CODE_SIGNING_PFX_PASSWORD" -Value $plainPassword
Set-GitHubSecret -Name "WINDOWS_CODE_SIGNING_THUMBPRINT" -Value $certificate.Thumbprint

$plainPassword = $null
$pfxBase64 = $null

Write-Output "GitHub signing secrets configured for $Repository."
Write-Output "Certificate: $($certificate.Subject)"
Write-Output "Thumbprint: $($certificate.Thumbprint)"
Write-Output "Expires: $($certificate.NotAfter.ToString('u'))"
Write-Output "Encrypted local backup: $pfxPath"
