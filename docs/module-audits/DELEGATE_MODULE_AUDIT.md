# Delegate Service — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/trips/delegate.service.ts`  
**Files:** `delegate.service.ts`  
**Total LOC:** ~400+ lines

[Content from comprehensive agent analysis - Full audit in trips module summary provided by agent]

---

## Quick Summary

The delegate service manages **emergency GPS takeover** when driver is incapacitated and GPS is offline. Enables coordinators/staff to assume driver's GPS broadcasting responsibility.

**Delegation Lifecycle:**

**1. Eligibility Check** (`checkEligibility`)
- Validates user role (STAFF, NCC_OFFICER, FACULTY, COORDINATOR, TRANSPORT_OFFICER, MANAGEMENT)
- Checks trip is ACTIVE
- Verifies GPS is OFFLINE (can't delegate while driver has signal)
- Ensures no active delegation exists
- Proximity validation (≤200m from bus via Haversine)
- Fallback: Route assignment if no recent GPS

**2. Activation** (`activateDelegation`)
- **Atomic lock** (SETNX, 10s expiry) prevents concurrent activation
- Re-checks all eligibility conditions
- Creates audit record (TripDelegate) with metadata
- Atomic transaction: Mark trip + record + database
- Store delegation state in Redis (12h TTL)
- Update Firebase RTDB (mobile apps see delegate active)
- WebSocket broadcast to admin dashboard
- Metrics increment (delegate_activation_success_total)

**3. Warning Handling** (`handleWarning`)
- Immutable audit log (every warning logged)
- Metrics tracking (warning type counters)
- Rate limiting (max 1 push per 60s per trip+type)
- Coordinator escalation (max 3 criticals per 10 mins)
- Push notifications for HIGH/CRITICAL severity

**4. Ending** (`endDelegation`)
- Reasons: Manual end, driver return (2-ping threshold), session expiry (12h)
- Atomic transaction: Update delegation record + clear trip delegates
- Redis cleanup (3 keys: state, lock, heartbeat)
- Firebase update (mobile sees delegate inactive)
- WebSocket broadcast (admin notified)
- Metrics decrement (active delegations gauge)

**5. Driver Return Detection** (`handleDriverReturn`)
- GPS layer detects driver ping after delegate started
- 2-ping threshold (confirms return, not fluke)
- 15-second window (auto-expired)
- Automatically calls endDelegation
- Handback logged with operationId

**Key Strengths:**
- ✅ **Atomic lock** for concurrent activation (SET NX)
- ✅ **2-ping driver return** filter (robust, no false positives)
- ✅ **DB audit trail** (TripDelegate records all activations)
- ✅ **Redis state coordination** (GPS layer reads trip:delegate key)
- ✅ **Warning rate limiting** (prevent notification spam)
- ✅ **Multi-source updates** (Firebase + WebSocket + DB)

**Risk Areas:**
- ⚠️ **Delegation cascade:** Multiple Redis keys (state, lock, heartbeat) require cleanup
- ⚠️ **Device binding missing:** IP+UA not validated for delegations
- ⚠️ **No heartbeat monitor:** Delegation auto-expires after 12h even if active
- ⚠️ **Firebase as hot path:** Every delegation change → Realtime DB update
- ⚠️ **Escalation logic incomplete:** Coordinator notification escalation flagged but not fully implemented

**Proximity Checking:**
- **Primary:** Haversine distance to last GPS position (200m max)
- **Fallback:** Route assignment existence (if no recent GPS)
- **Security:** Guards against remote takeover attempts

**State Storage:**
```typescript
redis.setex(`trip:delegate:${tripId}`, 12*60*60, JSON.stringify({
  userId,
  delegateType,      // GPS, KIOSK, or BOTH
  operationId,       // Idempotency key
  activatedAt,
  busId
}))
```

**Database Model (TripDelegate):**
- id, tripId, delegateId
- Status: PENDING → ACTIVE → ENDED / FAILED
- Activation: lat, lon, distance from bus, method (GEOFENCE vs ROUTE_ASSOCIATION)
- Timestamps: activatedAt, endedAt
- endReason: MANUAL_END, DRIVER_RETURNED, TIMEOUT, etc.

**Metrics:**
- `delegate_activation_attempt_total` (gauge)
- `delegate_activation_success_total` (counter)
- `delegate_activation_fail_total` (counter with reason)
- `delegate_warning_total` (counter with warning type)
- `delegate_termination_total` (counter with reason)
- `active_delegations_gauge` (gauge, inc/dec)

---

Full architecture above covers atomicity patterns, state machines, warning escalation, and comprehensive feature implementation.
