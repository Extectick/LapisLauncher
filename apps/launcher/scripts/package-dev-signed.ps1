[CmdletBinding()]
param(
  [string]$CertificateSubject = "CN=Lapis Launcher Development",
  [int]$ValidYears = 3,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Import-Module PKI -ErrorAction Stop
$storePath = "Cert:\CurrentUser\My"
$minimumExpiration = (Get-Date).AddDays(30)

$codeSigningOid = "1.3.6.1.5.5.7.3.3"
$certificate = Get-ChildItem -Path $storePath |
  Where-Object {
    $_.Subject -eq $CertificateSubject -and
    $_.HasPrivateKey -and
    $_.NotAfter -gt $minimumExpiration -and
    $_.EnhancedKeyUsageList.ObjectId -contains $codeSigningOid
  } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $certificate) {
  $certificate = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $CertificateSubject `
    -FriendlyName "Lapis Launcher Development Code Signing" `
    -CertStoreLocation $storePath `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy NonExportable `
    -NotAfter (Get-Date).AddYears($ValidYears)
}

$workspaceDirectory = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$publicDirectory = Join-Path $workspaceDirectory ".local\certificates"
$publicCertificatePath = Join-Path $publicDirectory "LapisLauncherDevelopment.cer"
New-Item -ItemType Directory -Path $publicDirectory -Force | Out-Null
Export-Certificate -Cert $certificate -FilePath $publicCertificatePath -Force | Out-Null

# Trust is intentionally scoped to CurrentUser. It makes local smoke builds
# trusted without changing the machine-wide trust store or requiring elevation.
$alreadyTrustedRoot = Get-ChildItem Cert:\CurrentUser\Root |
  Where-Object Thumbprint -eq $certificate.Thumbprint |
  Select-Object -First 1
if (-not $alreadyTrustedRoot) {
  Import-Certificate `
    -FilePath $publicCertificatePath `
    -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
}

$alreadyTrustedPublisher = Get-ChildItem Cert:\CurrentUser\TrustedPublisher |
  Where-Object Thumbprint -eq $certificate.Thumbprint |
  Select-Object -First 1
if (-not $alreadyTrustedPublisher) {
  Import-Certificate `
    -FilePath $publicCertificatePath `
    -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
}

Write-Output "Development certificate: $($certificate.Subject)"
Write-Output "Thumbprint: $($certificate.Thumbprint)"
Write-Output "Expires: $($certificate.NotAfter.ToString('u'))"
Write-Output "Public certificate: $publicCertificatePath"

if ($SkipBuild) {
  return
}

$env:VELOPACK_SIGN_PARAMS = "/sha1 $($certificate.Thumbprint) /s My /fd SHA256 /tr http://timestamp.digicert.com /td SHA256"
$launcherVersion = (Get-Content (Join-Path $workspaceDirectory "apps\launcher\package.json") | ConvertFrom-Json).version
$buildTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$developmentOutput = Join-Path $workspaceDirectory ".local\velopack-dev\$launcherVersion-$buildTimestamp"
$env:VELOPACK_OUTPUT_DIR = $developmentOutput
Push-Location $workspaceDirectory
try {
  & pnpm package:win
  if ($LASTEXITCODE -ne 0) {
    throw "Signed Velopack build failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
  Remove-Item Env:\VELOPACK_SIGN_PARAMS -ErrorAction SilentlyContinue
  Remove-Item Env:\VELOPACK_OUTPUT_DIR -ErrorAction SilentlyContinue
}

$setup = Get-Item (Join-Path $developmentOutput "LapisLauncher-stable-Setup.exe")
$signature = Get-AuthenticodeSignature -LiteralPath $setup.FullName
if (
  -not $signature.SignerCertificate -or
  $signature.SignerCertificate.Thumbprint -ne $certificate.Thumbprint
) {
  throw "Velopack Setup was not signed by the development certificate."
}

Write-Output "Setup signature: $($signature.Status)"
Write-Output "Signed Setup: $($setup.FullName)"
