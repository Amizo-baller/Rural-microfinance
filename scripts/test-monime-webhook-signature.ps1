param(
  [Parameter(Mandatory = $true)]
  [string]$Endpoint
)

$ErrorActionPreference = 'Stop'
$uri = [uri]$Endpoint
if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath.TrimEnd('/') -notmatch '/api/webhooks/monime$' -or $uri.Query -or $uri.UserInfo) {
  throw 'Endpoint must be the public HTTPS API webhook URL ending in /api/webhooks/monime.'
}

$secureSecret = Read-Host -Prompt 'Enter the staging Monime webhook signing secret (input hidden)' -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $secureSecret.Dispose()
}
if ([string]::IsNullOrWhiteSpace($secret)) { throw 'Webhook secret is required.' }

function Send-SignedTest([string]$key, [string]$body, [string]$timestamp) {
  $hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($key))
  try {
    $digest = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("${timestamp}_$body"))
    $signature = [Convert]::ToBase64String($digest)
  } finally {
    $hmac.Dispose()
  }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Endpoint `
      -ContentType 'application/json' -Headers @{ 'Monime-Signature' = "t=$timestamp,v1=$signature" } `
      -Body $body -TimeoutSec 30
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw 'Webhook endpoint request failed; connection details were suppressed.'
  }
}

try {
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
  $testPayoutId = 'pyt-signature-check-' + [guid]::NewGuid().ToString('N')
  $event = @{
    event = @{ id = 'wke-signature-check-' + [guid]::NewGuid().ToString('N'); name = 'payout.completed'; timestamp = $timestamp }
    object = @{ id = $testPayoutId; type = 'payout' }
    data = @{ id = $testPayoutId }
  }
  $body = ConvertTo-Json -InputObject $event -Compress -Depth 5
  $validStatus = Send-SignedTest $secret $body $timestamp
  if ($validStatus -ne 200) { throw "Valid signature check returned HTTP $validStatus; expected HTTP 200." }

  $invalidStatus = Send-SignedTest ($secret + '-invalid') $body $timestamp
  if ($invalidStatus -ne 401) { throw "Invalid signature check returned HTTP $invalidStatus; expected HTTP 401." }
  Write-Output 'Webhook endpoint accepted the valid test signature and rejected the invalid one. The test payout ID matches no withdrawal and cannot create a payout.'
} finally {
  $secret = $null
  Remove-Variable secureSecret -ErrorAction SilentlyContinue
}
