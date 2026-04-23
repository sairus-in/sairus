# Runbook: GPS Mass Offline

## Symptoms
- Dashboard shows >10 buses GPS offline
- Alert fires: `gps_offline_count > 10`
- Students can't see live bus locations

## Assessment

### Check which buses are offline
```bash
gcloud logging read 'jsonPayload.event="gps_offline"' --limit=20
```

### Check Firebase Realtime DB
- Open Firebase Console → Realtime Database → /buses
- Look for stale timestamps (>5 minutes old)

## Possible Causes

### 1. Firebase RTDB Issue
- Check Firebase status page
- If Firebase down: GPS falls back to last known position
- All buses will appear "offline" but last positions shown

### 2. Driver App Issue
- Many drivers may have closed app or lost connectivity
- Not a backend problem — driver app needs restart
- Contact transport office to message drivers

### 3. Backend GPS Processor Down
```bash
# Check if GPS processor running
gcloud logging read 'jsonPayload.event="gps_ping_received"' --limit=10

# If no recent pings, check Cloud Run
gcloud run services describe bus-backend --region asia-south1
```

## Mitigation

### If Firebase is down:
- System degrades gracefully to "last known position"
- No action needed — wait for Firebase recovery
- Monitor Sentry for increased errors

### If driver apps offline:
- Contact transport office via phone/WhatsApp
- Ask them to message drivers to reopen apps
- Update student app to show "last seen X minutes ago"

### If backend issue:
- Check Cloud Run instance health
- Restart if needed: `gcloud run services update bus-backend --region asia-south1`

## Verification

Monitor for:
- GPS offline count returning to <5
- Fresh timestamps in Firebase RTDB
- Student app showing live positions
