param([switch]$Final, [switch]$System)
$ErrorActionPreference = 'Stop'
$milkyDirectory = $PSScriptRoot
$milkyUrl = 'http://127.0.0.1:8787'
$milkyReady = $false
try {
    $milkyPage = Invoke-WebRequest -Uri $milkyUrl -UseBasicParsing -TimeoutSec 2
    $milkyReady = $milkyPage.Content -like '*milky-canvas*'
} catch {}
if (-not $milkyReady) {
    $milkyNode = (Get-Command node -ErrorAction Stop).Source
    $milkyServer = Join-Path $milkyDirectory 'server.mjs'
    Start-Process -FilePath $milkyNode -ArgumentList @(('"' + $milkyServer + '"')) -WorkingDirectory $milkyDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $milkyDirectory 'server.log') -RedirectStandardError (Join-Path $milkyDirectory 'server-error.log')
    for ($milkyAttempt = 0; $milkyAttempt -lt 20; $milkyAttempt++) {
        Start-Sleep -Milliseconds 200
        try {
            $milkyPage = Invoke-WebRequest -Uri $milkyUrl -UseBasicParsing -TimeoutSec 1
            if ($milkyPage.Content -like '*milky-canvas*') { $milkyReady = $true; break }
        } catch {}
    }
}
if (-not $milkyReady) { throw 'No se pudo iniciar Milky en el puerto 8787. Revisá server-error.log.' }
$milkyChrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$milkyView = if ($System) { '/system.html?mode=show' } elseif ($Final) { '/?preset=final' } else { '/?gallery=1' }
if (Test-Path -LiteralPath $milkyChrome) {
    Start-Process -FilePath $milkyChrome -ArgumentList ($milkyUrl + $milkyView)
} else {
    Start-Process ($milkyUrl + $milkyView)
}
