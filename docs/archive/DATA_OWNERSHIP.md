# Data Ownership Registry (v3)

**The Law:** Before any code is written, every piece of state in the app has exactly one owner.
This is not a guideline. It is a constraint enforced by ESLint and CI. Violating this will cause CI failures.

```
OWNERSHIP REGISTRY

REACT QUERY owns:
  - attendance status, history, corrections
  - trip data (status, bus, driver, ETA)
  - student home response (all fields)
  - driver assignment and trip
  - QR token and expiry

ZUSTAND owns:
  - auth: user identity, token, deviceId, fcmToken
  - nothing else — if you're tempted to add trip data to Zustand, stop

LOCAL STATE owns:
  - form inputs
  - modal open/close
  - scan lock (scanned: boolean)
  - GPS readiness state
  - socket connection status

FIREBASE RTDB owns:
  - live bus position (lat, lon, speed, heading, lastUpdated)
  - GPS status string
  - nothing else is written to RTDB from mobile

ASYNCSTORAGE owns:
  - offline check-in queue (v3 schema — parallel flush)
  - GPS context for background task
  - language preference

VIOLATIONS — these are always bugs, not patterns:
  attendance status in Zustand → bug
  trip data in local state → bug
  bus position in React Query → bug (should be Firebase)
  user token in local state → bug (should be Zustand)
```
