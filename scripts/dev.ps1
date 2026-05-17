<#
.SYNOPSIS
    Run development servers for College Bus System components

.DESCRIPTION
    Quick script to start individual or all dev servers

.PARAMETER Component
    Which to run: all, backend, admin, mobile

.EXAMPLE
    .\dev.ps1 -Component all
    .\dev.ps1 -Component backend
#>

param(
    [ValidateSet('all', 'backend', 'admin', 'mobile')]
    [string]$Component = 'all'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

Push-Location $ProjectRoot

try {
    switch ($Component) {
        'all' {
            Write-Step "Starting ALL services"

            Write-Host "Starting Docker infrastructure..."
            docker compose -f infra/docker/docker-compose.yml up -d

            Write-Host "`Starting backend..."
            Start-Process -FilePath "pnpm" -ArgumentList "--filter", "backend", "dev" -WorkingDirectory $ProjectRoot -NoNewWindow

            Write-Host "Starting admin..."
            Start-Process -FilePath "pnpm" -ArgumentList "--filter", "admin", "dev" -WorkingDirectory $ProjectRoot -NoNewWindow

            Write-Host "Starting mobile (Expo)..."
            Start-Process -FilePath "pnpm" -ArgumentList "--filter", "mobile", "start" -WorkingDirectory $ProjectRoot -NoNewWindow
        }

        'backend' {
            Write-Step "Starting Backend"
            pnpm --filter backend dev
        }

        'admin' {
            Write-Step "Starting Admin"
            pnpm --filter admin dev
        }

        'mobile' {
            Write-Step "Starting Mobile (Expo)"
            pnpm --filter mobile start
        }
    }

} finally {
    Pop-Location
}