# Runbook: Daily Trips Job Failed

## Criticality
**HIGH** — If this job fails, no trips are created for the day.
Students cannot check in.

## Symptoms
- Log shows: `event: "job_failed"` with `job: "create-daily-trips"`
- Morning arrives and no trips are ACTIVE
- Students see "No active trip" in app

## Immediate Fix (Manual Run)

```bash
# Trigger job manually via Cloud Run Jobs
gcloud run jobs execute create-daily-trips \
  --region asia-south1 \
  --wait

# Or via API endpoint (if implemented)
curl -X POST https://bus-backend-xxx.run.app/v1/jobs/create-daily-trips \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Verify Trips Created

```bash
# Check database
psql $DATABASE_URL -c "SELECT COUNT(*) FROM trips WHERE date = CURRENT_DATE;"

# Should return ~180 (number of buses)
```

## Check-In Verification

After creating trips:
1. Test check-in with student account
2. Verify trip shows as ACTIVE in admin panel
3. Monitor for check-in success rate >95%

## Root Cause Analysis

Common causes:
1. **Database connection issue** → Check Cloud SQL
2. **Job timeout** → Check if many buses added
3. **Code error** → Check Sentry for new error

## Prevention

- Job runs at 11:00 PM daily (Cloud Scheduler)
- Set alert: `job_failed` event triggers SMS
- Morning dashboard: verify trip count matches bus count
