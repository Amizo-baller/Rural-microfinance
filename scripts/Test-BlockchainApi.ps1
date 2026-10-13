param(
    [Parameter(Mandatory = $true)][Guid]$TransactionId,
    [string]$ApiBaseUrl = 'http://127.0.0.1:3000/api'
)
$ErrorActionPreference = 'Stop'
$identifier = Read-Host 'Administrator email or phone number'
$securePassword = Read-Host 'Password' -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $body = @{ identifier = $identifier; password = $password } | ConvertTo-Json
    $session = Invoke-RestMethod -Uri "$ApiBaseUrl/auth/login" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $password = $null
    $body = $null
}
try {
    $headers = @{ Authorization = "Bearer $($session.accessToken)" }
    $status = Invoke-RestMethod -Uri "$ApiBaseUrl/blockchain/status" -Headers $headers -TimeoutSec 30
    if (-not $status.configured) { throw 'Blockchain is not configured. Run the blockchain configure command and restart the API.' }
    $initial = Invoke-RestMethod -Uri "$ApiBaseUrl/blockchain/verify/$TransactionId" -Headers $headers -TimeoutSec 30
    if ($initial.verificationResult -eq 'NOT_VERIFIED') { throw 'The existing proof differs from the database record. It will not be overwritten.' }
    if ($initial.verificationResult -eq 'PENDING') {
        $record = Invoke-RestMethod -Uri "$ApiBaseUrl/financial-records/$TransactionId" -Headers $headers -TimeoutSec 30
        $proof = @{ reference = $initial.transactionReference; recordHash = $initial.databaseHash; transactionType = $record.type } | ConvertTo-Json
        $receipt = Invoke-RestMethod -Uri "$ApiBaseUrl/blockchain/proofs" -Method Post -ContentType 'application/json' -Headers $headers -Body $proof -TimeoutSec 180
        Write-Output "Proof transaction: $($receipt.transactionHash)"
    }
    $result = Invoke-RestMethod -Uri "$ApiBaseUrl/blockchain/verify/$TransactionId" -Headers $headers -TimeoutSec 30
    if ($result.verificationResult -ne 'VERIFIED') { throw 'The backend could not verify the financial record proof.' }
    Write-Output "PASS: $($result.transactionReference) is VERIFIED by the existing backend."
} finally {
    # Revoke this script's login session without changing the phone's session.
    if ($session.refreshToken) {
        try {
            $logout = @{ refreshToken = $session.refreshToken } | ConvertTo-Json
            Invoke-RestMethod -Uri "$ApiBaseUrl/auth/logout" -Method Post -Headers $headers -ContentType 'application/json' -Body $logout -TimeoutSec 15 | Out-Null
        } catch { Write-Warning 'Could not revoke the test login session; it will expire normally.' }
    }
    $session = $null
    $headers = $null
}
