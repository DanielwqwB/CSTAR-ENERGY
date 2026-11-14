# Show TROPOMI band training in a PowerShell window.

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$host.UI.RawUI.WindowTitle = 'CSTAR-Energy TROPOMI band training'
Set-Location -LiteralPath $projectRoot
$evaluationDir = Join-Path $projectRoot 'models\evaluation\tropomi'
New-Item -ItemType Directory -Force -Path $evaluationDir | Out-Null
$logPath = Join-Path $evaluationDir 'band_training.log'
Write-Host "Training TROPOMI concentration-band models from $projectRoot"
Write-Host "Progress log: $logPath"
python -m modules.atmosphere.train_tropomi_bands 2>&1 | Tee-Object -FilePath $logPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "TROPOMI band training failed with exit code $LASTEXITCODE" -ForegroundColor Red
} else {
    Write-Host "TROPOMI band training completed. Results: $evaluationDir" -ForegroundColor Green
}
