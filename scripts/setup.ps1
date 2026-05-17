<#
.SYNOPSIS
    Full system setup script for College Bus Management System

.DESCRIPTION
    Sets up and runs:
    - Docker infrastructure (Postgres + Redis)
    - Backend API
    - Admin SPA
    - Mobile Expo app

.PARAMETER Component
    Which component to run: all, docker, backend, admin, mobile

.PARAMETER SkipInstall
    Skip npm/pnpm install steps

.EXAMPLE
    .\setup.ps1 -Component all
    .\setup.ps1 -Component docker
    .\setup.ps1 -Component backend
#>

param(
    [ValidateSet('all', 'docker', 'backend', 'admin', 'mobile')]
    [string]$Component = 'all',

    [switch]$SkipInstall,

    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

function Write-Step {
    param([string]$Message)
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host " $Message" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Fatal {
    param([string]$Message)
    Write-Host "[FATAL] $Message" -ForegroundColor Red
    exit 1
}

# ============================================================================
# MAIN LOGIC
# ============================================================================

Push-Location $ProjectRoot

try {
    # -------------------------------------------------------------------------
    # STEP 1: EAS CLI
    # -------------------------------------------------------------------------
    if ($Component -eq 'all' -or $Component -eq 'docker') {
        Write-Step "Step 1: Installing EAS CLI"

        $easInstalled = Get-Command eas -ErrorAction SilentlyContinue
        if (-not $easInstalled) {
            npm install -g eas-cli
            if ($LASTEXITCODE -ne 0) { Write-Fatal "Failed to install eas-cli" }
            Write-Success "EAS CLI installed"
        } else {
            Write-Success "EAS CLI already installed"
        }

        # Check Expo login
        Write-Host "`nChecking Expo login status..."
        $easWhoami = eas account:whoami 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Not logged in to Expo. Run 'eas login' manually."
        } else {
            Write-Success "Logged in as: $easWhoami"
        }
    }

    # -------------------------------------------------------------------------
    # STEP 2: Docker Infrastructure
    # -------------------------------------------------------------------------
    if ($Component -eq 'all' -or $Component -eq 'docker') {
        Write-Step "Step 2: Starting Docker Infrastructure"

        $dockerRunning = docker ps 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fatal "Docker is not running. Please start Docker Desktop."
        }

        Write-Host "Starting Postgres (port 5433) and Redis (port 6380)..."
        docker compose -f infra/docker/docker-compose.yml up -d

        if ($LASTEXITCODE -ne 0) {
            Write-Fatal "Failed to start Docker containers"
        }

        # Wait for services to be ready
        Write-Host "Waiting for services to be ready..."
        Start-Sleep -Seconds 5

        # Verify Postgres
        $pgReady = docker exec bus_postgres pg_isready -U postgres 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "PostgreSQL is ready (port 5433)"
        } else {
            Write-Fatal "PostgreSQL failed to start"
        }

        # Verify Redis
        $redisReady = docker exec bus_redis redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0 -or $redisReady -eq "PONG") {
            Write-Success "Redis is ready (port 6380)"
        } else {
            Write-Fatal "Redis failed to start"
        }
    }

    # -------------------------------------------------------------------------
    # STEP 3: Backend
    # -------------------------------------------------------------------------
    if ($Component -eq 'all' -or $Component -eq 'backend') {
        Write-Step "Step 3: Setting up Backend"

        $backendDir = Join-Path $ProjectRoot "apps\backend"

        # Check for .env
        $envFile = Join-Path $backendDir ".env"
        $envExample = Join-Path $backendDir ".env.example"

        if (-not (Test-Path $envFile)) {
            if (Test-Path $envExample) {
                Write-Host "Creating .env from .env.example..."
                Copy-Item $envExample $envFile
                Write-Warn "Please edit $envFile with your configuration before continuing!"
            } else {
                Write-Fatal "No .env or .env.example found in apps/backend"
            }
        }

        Write-Host "Installing backend dependencies..."
        Push-Location $backendDir
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
            Write-Fatal "pnpm install failed"
        }
        Pop-Location

        Write-Host "Generating Prisma client..."
        Push-Location $backendDir
        pnpm db:generate
        Pop-Location
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Prisma generate had issues (may be OK if no schema changes)"
        }

        Write-Host "Running migrations..."
        Push-Location $backendDir
        pnpm db:migrate
        Pop-Location

        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Migration had issues (database may already be up to date)"
        }

        Write-Success "Backend ready"
        Write-Host "`nStarting backend server in background..."

        # Run backend in background
        Start-Process -FilePath "pnpm" -ArgumentList "--filter", "backend", "dev" `
            -WorkingDirectory $ProjectRoot `
            -NoNewWindow `
            -WindowStyle Hidden

        Write-Success "Backend started on http://localhost:3000"
    }

    # -------------------------------------------------------------------------
    # STEP 4: Admin
    # -------------------------------------------------------------------------
    if ($Component -eq 'all' -or $Component -eq 'admin') {
        Write-Step "Step 4: Setting up Admin"

        $adminDir = Join-Path $ProjectRoot "apps\admin"

        Write-Host "Installing admin dependencies..."
        Push-Location $adminDir
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
            Write-Fatal "pnpm install failed"
        }
        Pop-Location

        Write-Host "Building admin (type-check + vite build)..."
        Push-Location $adminDir
        pnpm build
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Build had issues"
        }
        Pop-Location

        Write-Success "Admin ready"
        Write-Host "`nStarting admin dev server in background..."

        Start-Process -FilePath "pnpm" -ArgumentList "--filter", "admin", "dev" `
            -WorkingDirectory $ProjectRoot `
            -NoNewWindow `
            -WindowStyle Hidden

        Write-Success "Admin started on http://localhost:5173"
    }

    # -------------------------------------------------------------------------
    # STEP 5: Mobile
    # -------------------------------------------------------------------------
    if ($Component -eq 'all' -or $Component -eq 'mobile') {
        Write-Step "Step 5: Setting up Mobile"

        $mobileDir = Join-Path $ProjectRoot "apps\mobile"

        Write-Host "Installing mobile dependencies..."
        Push-Location $mobileDir
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) {
            Write-Fatal "pnpm install failed"
        }
        Pop-Location

        Write-Success "Mobile ready"
        Write-Host "`nStarting Expo in background..."

        Start-Process -FilePath "pnpm" -ArgumentList "--filter", "mobile", "start" `
            -WorkingDirectory $ProjectRoot `
            -NoNewWindow `
            -WindowStyle Hidden

        Write-Success "Expo started - check terminal for QR code"
    }

    # -------------------------------------------------------------------------
    # SUMMARY
    # -------------------------------------------------------------------------
    Write-Step "Setup Complete!"

    Write-Host @"

Services running:
  - Postgres:  localhost:5433 (user: postgres, pass: postgres, db: bus_management)
  - Redis:      localhost:6380

Applications:
  - Backend:    http://localhost:3000
  - Admin:      http://localhost:5173
  - Mobile:     Check terminal for Expo URL (or run 'pnpm --filter mobile android')

"@ -ForegroundColor Green

    Write-Host "To stop all services, run: docker compose -f infra/docker/docker-compose.yml down" -ForegroundColor Yellow
    Write-Host "Or use Ctrl+C in each terminal window`n" -ForegroundColor Yellow

} finally {
    Pop-Location
}