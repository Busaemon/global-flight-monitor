[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction Stop
}

Push-Location $ProjectDirectory
try {
    & ($NpmCommand.Source) run setup
    if ($LASTEXITCODE -ne 0) {
        throw "Setup failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
