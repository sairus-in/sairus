# Runbook: Redis Restart/Failure

## Symptoms
- Redis errors in logs
- Rate limiting not working
- Dashboard stats showing 0 or stale data

## Impact Assessment

**Critical functions affected:**
- QR nonce burning (falls back to DB - slower)
- Rate limiting (disabled - watch for spam)
- Dashboard stats (stale data)
- Socket.io pub/sub (affects multi-instance)

**Not affected:**
- Core check-in (has PostgreSQL fallback)
- Attendance records (stored in PostgreSQL)
- User authentication (JWT-based)

## Immediate Actions

### If using Upstash (managed Redis):
1. Check Upstash Console for outages
2. If regional outage: wait for recovery
3. If persistent: consider failover to secondary Redis

### If using Cloud Memorystore:
1. Check GCP Console → Memorystore
2. Verify instance status
3. Restart if needed (causes brief interruption)

### If using Docker Redis (local only):
```bash
docker restart bus_redis
```

## Recovery Verification

```bash
# Test Redis connection
redis-cli -u $REDIS_URL ping
# Should return: PONG

# Check dashboard stats reinitializing
redis-cli HGETALL dashboard:stats
```

## Dashboard Stats Recovery

If Redis was cleared, run reconciliation:
```bash
# This job recalculates all stats from PostgreSQL
gcloud run jobs execute reconcile-redis \
  --region asia-south1 \
  --wait
```

## Prevention

- Use managed Redis (Upstash) with automatic failover
- Set up Redis memory alerts (>80%)
- Monitor Redis connection count
