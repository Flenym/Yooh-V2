param(
  [switch]$NoClean,
  [switch]$IncludeConfig
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$venvPath = Join-Path $projectRoot ".venv-desktop"
if (-not (Test-Path $venvPath)) {
  python -m venv $venvPath
}

$python = Join-Path $venvPath "Scripts\python.exe"

& $python -m pip install --upgrade pip
& $python -m pip install -r (Join-Path $projectRoot "desktop_native\requirements.txt")
& $python -m pip install pyinstaller
& $python (Join-Path $projectRoot "desktop_native\make_icon.py")

if (-not $NoClean) {
  Remove-Item -Recurse -Force (Join-Path $projectRoot "build") -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force (Join-Path $projectRoot "dist") -ErrorAction SilentlyContinue
}

$iconPath = Join-Path $projectRoot "desktop_native\assets\yooh.ico"
$mainScript = Join-Path $projectRoot "desktop_native\yooh_desktop.py"
$addIconData = (Join-Path $projectRoot "src\client\icons\icon-192.png") + ";icons"

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --windowed `
  --onefile `
  --name "Yooh" `
  --icon $iconPath `
  --add-data $addIconData `
  $mainScript

if ($IncludeConfig) {
  $targetConfig = Join-Path $projectRoot "dist\yooh-desktop-config.json"
  Copy-Item (Join-Path $projectRoot "desktop_native\config.example.json") $targetConfig -Force
}

Write-Host ""
Write-Host "Build complete:"
Write-Host "  EXE:    $(Join-Path $projectRoot 'dist\Yooh.exe')"
if ($IncludeConfig) {
  Write-Host "  Config: $(Join-Path $projectRoot 'dist\yooh-desktop-config.json')"
} else {
  Write-Host "  Config: not generated (Yooh.exe has built-in defaults)"
}
