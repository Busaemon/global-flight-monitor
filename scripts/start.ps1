[CmdletBinding()]
param([switch]$Production)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ProjectDirectory = Split-Path -Parent $PSScriptRoot
$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction Stop
}

Push-Location $ProjectDirectory
try {
    if ($Production) {
        & ($NpmCommand.Source) start
    }
    else {
        & ($NpmCommand.Source) run dev
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Application exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
