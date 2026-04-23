# Runbook: Check-in Failures

## Symptoms
- Students reporting "check-in failed" errors
- Sentry showing `checkin_attempt` with `result: FAIL` at high rate
- check_success_rate < 90%

## Step 1: Identify which check is failing

Search logs:
```bash
gcloud logging read 'jsonPayload.event="checkin_attempt" jsonPayload.result="FAIL"' --limit=20
```

Look at `failReason` field:
- `QR_EXPIRED` → QR TTL too short or clock skew
- `QR_ALREADY_USED` → Double-scan (usually fine)
- `TRIP_NOT_ACTIVE` → Trip not started or already ended
- `ROUTE_MISMATCH` → Student on wrong bus
- `TOO_FAR` → Geofence rejection (expected if students far from bus)
- `ALREADY_CHECKED_IN` → Idempotency (fine)
- `DB_ERROR` → Database problem (serious)
- `REDIS_ERROR` → Redis problem (serious)

## Step 2: DB_ERROR path

Check Cloud SQL health: GCP Console → SQL → bus-mgmt-db → Overview
Check connection count: should be < 50

If connection count is maxed: Cloud Run has too many instances open
```bash
gcloud run services update bus-backend --max-instances=5 --region=asia-south1
```

## Step 3: QR_EXPIRED at high rate

Check system time on Cloud Run instances
Check `REDIS_QR_TTL_SECONDS` in constants — should be 120
If students are far from bus stops, geofence check passes but QR scan is slow

## Step 4: If nothing obvious — rollback

```bash
gcloud run services update-traffic bus-backend \
  --to-revisions=PREVIOUS=100 --region=asia-south1
```

## Verification

After fix/rollback:
1. Test check-in manually with test student account
2. Watch check-in success rate return to >95%
3. Notify transport office
