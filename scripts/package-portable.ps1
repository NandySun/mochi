# Mochi Portable Release Packager
# Usage: .\scripts\package-portable.ps1
#
# Prerequisites: Run `pnpm tauri build` first (produces src-tauri/target/release/mochi.exe)
# Output: releases/mochi-v{version}-portable.zip with .portable marker

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $projectRoot "src-tauri\target\release"
$libDir = Join-Path $projectRoot "src-tauri\lib"
$releasesDir = Join-Path $projectRoot "releases"

# Read version from package.json
$packageJson = Get-Content (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$version = $packageJson.version
$zipName = "mochi-v$version-portable.zip"
$zipPath = Join-Path $releasesDir $zipName

# Verify build exists
if (-not (Test-Path (Join-Path $releaseDir "mochi.exe"))) {
    Write-Error "mochi.exe not found. Run 'pnpm tauri build' first."
    exit 1
}

# Create temp staging directory
$stagingDir = Join-Path $env:TEMP "mochi-portable-staging"
Remove-Item -Recurse -Force $stagingDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

Write-Host "Collecting files..." -ForegroundColor Cyan

# Copy required files
Copy-Item (Join-Path $releaseDir "mochi.exe") $stagingDir
Copy-Item (Join-Path $releaseDir "WebView2Loader.dll") $stagingDir -ErrorAction SilentlyContinue
Copy-Item (Join-Path $libDir "libmpv-2.dll") $stagingDir
Copy-Item (Join-Path $libDir "libmpv-wrapper.dll") $stagingDir

# Create .portable marker for portable mode (data alongside exe)
New-Item -ItemType File -Path (Join-Path $stagingDir ".portable") -Force | Out-Null

Write-Host ""
Write-Host "Contents:" -ForegroundColor Cyan
Get-ChildItem $stagingDir | ForEach-Object {
    $size = if ($_.Length -gt 1MB) { "$([math]::Round($_.Length/1MB,1)) MB" } elseif ($_.Length -gt 1KB) { "$([math]::Round($_.Length/1KB,1)) KB" } else { "$($_.Length) B" }
    Write-Host "  $($_.Name)  ($size)"
}

# Create zip
Write-Host ""
Write-Host "Creating $zipName ..." -ForegroundColor Cyan
Remove-Item $zipPath -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $zipPath)

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "Done: $zipPath ($zipSize MB)" -ForegroundColor Green

# Cleanup
Remove-Item -Recurse -Force $stagingDir -ErrorAction SilentlyContinue

# List both deliverables for this version
Write-Host ""
Write-Host "Release deliverables for v${version}:" -ForegroundColor Yellow
if (Test-Path $zipPath) {
    Write-Host "  Portable: releases/$zipName ($zipSize MB)"
}
$nsisPath = Join-Path $releaseDir "bundle\nsis\Mochi_$($version)_x64-setup.exe"
if (Test-Path $nsisPath) {
    $nsisSize = [math]::Round((Get-Item $nsisPath).Length / 1MB, 1)
    Write-Host "  Installer: target/release/bundle/nsis/Mochi_$($version)_x64-setup.exe ($nsisSize MB)"
}
