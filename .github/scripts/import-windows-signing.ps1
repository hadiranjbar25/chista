$ErrorActionPreference = 'Stop'
if (!$env:WINDOWS_CERTIFICATE -or !$env:WINDOWS_CERTIFICATE_PASSWORD) { throw 'Windows signing secrets are required for installer releases.' }
$pfxPath = Join-Path $env:RUNNER_TEMP 'chista-signing.pfx'
try {
  [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
  $password = ConvertTo-SecureString $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
  $certificate = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $password
  $thumbprint = ($certificate | Where-Object { $_.HasPrivateKey } | Select-Object -First 1).Thumbprint
  if (!$thumbprint) { throw 'No signing private key was imported.' }
  $config = @{ bundle = @{ windows = @{ certificateThumbprint = $thumbprint; digestAlgorithm = 'sha256'; timestampUrl = 'http://timestamp.digicert.com' } } }
  $config | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $env:RUNNER_TEMP 'chista-signing.json')
  "CHISTA_SIGNING_THUMBPRINT=$thumbprint" | Out-File -FilePath $env:GITHUB_ENV -Append
} finally { Remove-Item -Path $pfxPath -Force -ErrorAction SilentlyContinue }
