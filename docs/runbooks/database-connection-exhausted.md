# Runbook: Database Connection Exhausted

## Symptoms
- Error: "connection limit exceeded" or "too many connections"
- Check-ins failing with DB_ERROR
- Cloud SQL showing max connections

## Root Cause
Cloud Run scales horizontally > PostgreSQL max_connections (default 100)

## Immediate Fix

Reduce Cloud Run max instances:
```bash
gcloud run services update bus-backend \
  --max-instances=5 \
  --region=asia-south1
```

## Connection Math

```
Prisma default pool: 5 connections per instance
Max instances: 10
Total: 50 connections (safe for Cloud SQL default 100)

If you need more instances:
→ Reduce Prisma connection limit
→ Or upgrade Cloud SQL tier
```

## Prevention

Set in Cloud Run service:
```bash
gcloud run services update bus-backend \
  --max-instances=10 \
  --region=asia-south1 \
  --concurrency=80
```

Prisma configuration (already in schema):
```prisma
generator client {
  provider = "prisma-client-js"
}
```

## Verification

```bash
# Check active connections in Cloud SQL
# GCP Console → SQL → bus-mgmt-db → Connections tab

# Should be < 50 after fix
```
