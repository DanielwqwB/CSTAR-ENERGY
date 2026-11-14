# Run the TROPOMI experiment in a visible PowerShell terminal.

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$host.UI.RawUI.WindowTitle = 'CSTAR-Energy TROPOMI weather training (latest run)'
Set-Location -LiteralPath $projectRoot
$evaluationDir = Join-Path $projectRoot 'models\evaluation\tropomi'
New-Item -ItemType Directory -Force -Path $evaluationDir | Out-Null
$logPath = Join-Path $evaluationDir 'weather_training.log'
Write-Host "Running TROPOMI weather experiments from $projectRoot"
Write-Host "Progress log: $logPath"
python -m modules.atmosphere.train_tropomi_weather 2>&1 | Tee-Object -FilePath $logPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "Training failed with exit code $LASTEXITCODE" -ForegroundColor Red
} else {
    Write-Host "Training completed. Results: $evaluationDir" -ForegroundColor Green
}
