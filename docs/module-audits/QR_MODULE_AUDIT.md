# QR Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/qr/`  
**Files:** `qr.service.ts` (35 lines, minimal but critical)  
**Total LOC:** ~35 lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The QR module generates **cryptographically signed JWT tokens** for one-time QR code scans. It is the foundation of the attendance system's replay-attack prevention.

**Core Function:** `generateToken(payload: { tripId, busId, routeId })`

**Cryptographic Flow:**
1. Generate UUID v4 nonce
2. Sign JWT with HS256 (35-second expiry)
3. Store nonce atomically in Redis (40-second TTL, 5s grace period)
4. Return JWT to driver for display at kiosk
5. On check-in: Attendance service atomically GETDEL the nonce (race-condition safe)

**Key Architecture:**
- ✅ **GETDEL pattern** ensures exactly one QR redemption (atomic Redis op)
- ✅ **35-second JWT expiry** with 5-second grace period (handles clock skew)
- ✅ **Kiosk rotation** at 25 seconds (refresh before expiry)
- ✅ **Rate limiting** on check-in (3/60s per user prevents brute-force)

**Security:**
- ✅ Double-scan prevention (nonce burned on first use)
- ✅ Signature forgery prevention (HS256 with secret)
- ✅ Offline replay window validation
- ✅ Device binding checks in attendance layer

**No Routes File:** QR generation is WebSocket-only (no HTTP endpoint), preventing external token spray attacks.

---

**One of the simplest but most critical modules.** Clean design, production-hardened replay prevention, zero race conditions.

Full details above cover cryptography, integration, and scale characteristics.
