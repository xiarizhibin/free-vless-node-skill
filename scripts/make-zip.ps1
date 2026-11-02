# zip the deployable project (server.js + package.json at archive root)
param(
  [string]$Dir = "./project",
  [string]$Out = "./relay.zip"
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path $Dir)) { throw "dir not found: $Dir" }
if (Test-Path $Out) { Remove-Item $Out -Force }
$files = Get-ChildItem $Dir -File | Where-Object { $_.Name -in @("server.js", "package.json", "package-lock.json") } | ForEach-Object { $_.FullName }
if (-not $files) { throw "no server.js/package.json in $Dir" }
Compress-Archive -Path $files -DestinationPath $Out -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Out))
"$Out  ($((Get-Item $Out).Length) bytes)"
$zip.Entries | ForEach-Object { "  " + $_.FullName + "  " + $_.Length }
$zip.Dispose()
