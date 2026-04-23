# Runbook: Complete Morning Outage

## When to use this
- /v1/health returns 503
- Multiple students cannot check in
- It's 7-9:30am (morning window)

## Step 1: Immediate Assessment (< 2 minutes)

```bash
# Check health endpoint
curl https://bus-backend-xxx.run.app/v1/health
curl https://bus-backend-xxx.run.app/v1/ready

# Check recent errors
gcloud logging read 'resource.type="cloud_run_revision" severity>=ERROR' \
  --limit=50 --freshness=5m

# Check Cloud Run status
gcloud run services describe bus-backend --region asia-south1
```

## Step 2: Immediate Mitigation

### If recent deploy caused it:
```bash
# Rollback to previous version (takes 30-60 seconds)
gcloud run services update-traffic bus-backend \
  --to-revisions=PREVIOUS=100 \
  --region asia-south1
```

### If database issue:
- Check Cloud SQL in GCP Console
- Verify instance is RUNNING
- Check CPU/memory usage
- If needed, restart Cloud SQL instance

### If Redis down:
- Check-in falls back to PostgreSQL automatically
- Watch for rate limit errors (rate limiting disabled)
- Monitor check-in spam attempts

## Step 3: Communicate

Text transport officer immediately:
```
"Bus app is having issues. Please use paper attendance.
Investigating now. Will update in 10 minutes."
```

## Step 4: Verify Recovery

```bash
# Check health returns 200
curl https://bus-backend-xxx.run.app/v1/ready

# Test check-in manually
# Watch success rate >95%
```

## Step 5: Post-Mortem

Within 24 hours, document:
- What happened
- Root cause
- Time to detection
- Time to resolution
- Prevention steps

File in `docs/post-mortems/YYYY-MM-DD-outage.md`
