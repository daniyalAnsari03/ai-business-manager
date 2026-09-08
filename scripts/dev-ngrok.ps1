# dev-ngrok.ps1 -- Start an ngrok tunnel for Meta OAuth development.
#
# Instagram Business Login requires HTTPS redirect URIs. This script:
#   1. Checks ngrok is installed
#   2. Starts a tunnel to localhost:3001
#   3. Reads the public HTTPS URL from the ngrok API
#   4. Updates META_OAUTH_REDIRECT_URL in .env.local
#   5. Prints what to register in Meta App Dashboard
#
# Usage:
#   pwsh scripts/dev-ngrok.ps1
#   npm run dev:ngrok
#
# After running, also start the dev server in a separate terminal:
#   npm run dev

$ErrorActionPreference = "Stop"
$PORT = 3001
$ENV_FILE = Join-Path $PSScriptRoot "..\.env.local"
$NGROK_API = "http://127.0.0.1:4040/api/tunnels"

# --- Check ngrok ---
$ngrok = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrok) {
    Write-Host ""
    Write-Host "  ngrok is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install it:" -ForegroundColor Yellow
    Write-Host "    winget install ngrok.ngrok" -ForegroundColor White
    Write-Host "    # or: choco install ngrok" -ForegroundColor DarkGray
    Write-Host "    # or: scoop install ngrok" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Then sign up at https://dashboard.ngrok.com and run:" -ForegroundColor Yellow
    Write-Host "    ngrok config add-authtoken YOUR_TOKEN" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""
Write-Host "  Starting ngrok tunnel to localhost:$PORT ..." -ForegroundColor Cyan

# Start ngrok in background
$ngrokProcess = Start-Process -FilePath "ngrok" -ArgumentList "http $PORT --log=stdout" -PassThru -WindowStyle Minimized

# Wait for ngrok API to become available
$maxWait = 15
$waited = 0
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
    try {
        $null = Invoke-RestMethod -Uri $NGROK_API -TimeoutSec 2
        break
    } catch {
        # ngrok not ready yet
    }
}

# Read the public URL from ngrok API
try {
    $tunnels = Invoke-RestMethod -Uri $NGROK_API
    $httpsTunnel = $tunnels.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1
    if (-not $httpsTunnel) {
        throw "No HTTPS tunnel found"
    }
    $publicUrl = $httpsTunnel.public_url
} catch {
    Write-Host ""
    Write-Host "  Could not read ngrok tunnel URL." -ForegroundColor Red
    Write-Host "  Check the ngrok window for the public URL manually." -ForegroundColor Yellow
    Write-Host ""
    Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

$callbackUrl = "$publicUrl/api/marketing/oauth/callback"

# Update .env.local
if (Test-Path $ENV_FILE) {
    $content = Get-Content $ENV_FILE -Raw
    $pattern = '(?m)^META_OAUTH_REDIRECT_URL=.*$'
    $replacement = "META_OAUTH_REDIRECT_URL=$publicUrl"
    if ($content -match $pattern) {
        $content = $content -replace $pattern, $replacement
    } else {
        $content = $content.TrimEnd() + "`nMETA_OAUTH_REDIRECT_URL=$publicUrl`n"
    }
    Set-Content -Path $ENV_FILE -Value $content -NoNewline
    Write-Host "  Updated META_OAUTH_REDIRECT_URL in .env.local" -ForegroundColor Green
} else {
    Write-Host "  .env.local not found -- set META_OAUTH_REDIRECT_URL=$publicUrl manually" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   ngrok tunnel active: $publicUrl" -ForegroundColor White
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Register this redirect URI in Meta App Dashboard:" -ForegroundColor Yellow
Write-Host ""
Write-Host "    Instagram -> Business login settings -> OAuth redirect URIs:" -ForegroundColor White
Write-Host "    $callbackUrl" -ForegroundColor Green
Write-Host ""
Write-Host "    Facebook Login -> Valid OAuth Redirect URIs:" -ForegroundColor White
Write-Host "    $callbackUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Then restart the dev server:" -ForegroundColor Yellow
Write-Host "    npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C in the ngrok window to stop the tunnel." -ForegroundColor DarkGray
Write-Host ""

# Keep script alive so the ngrok process stays running
Write-Host "  ngrok is running in the background. Press Ctrl+C here to stop." -ForegroundColor DarkGray
try {
    while ($true) { Start-Sleep -Seconds 60 }
} finally {
    Write-Host ""
    Write-Host "  Stopping ngrok..." -ForegroundColor Yellow
    Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "  Done." -ForegroundColor Green
    Write-Host ""
}
