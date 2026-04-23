# Admin-Auth Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/auth/`  
**Files:** `admin-auth.service.ts`, `admin-auth.routes.ts`, `admin-auth.middleware.ts`  
**Total LOC:** ~800+ lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The admin-auth module manages **secure staff authentication** for transport officers, coordinators, faculty, and management. Uses **custom local authentication** (NOT Firebase), bcrypt password hashing, TOTP-based MFA, and JWT sessions.

**Key Flows:**

**1. Invitation → Set Password**
- Transport officer invites admin (email)
- 48-hour invite token (SHA-256 hashed)
- Invitee sets password (≥12 chars, not in common list)

**2. Login → MFA Challenge → Verify**
- Email + password (timing-safe bcrypt comparison)
- If MFA enabled: Generate 5-minute challenge (device-bound)
- Enter TOTP code (6 digits, 30-second window, ±1 period tolerance)
- Issue JWT + set HTTP-only cookies

**3. Joint Session Management**
- JWT = 8-hour lifetime (expiry + cv expiry)
- Redis cache (8-hour TTL) with sessionVersion for revocation
- CSRF protection (double-submit cookies, timing-safe comparison)

**MFA Architecture:**
- **Secret:** AES-256-GCM encrypted in DB
- **Enforcement:** TRANSPORT_OFFICER + MANAGEMENT roles **require** MFA
- **Challenge:** IP + User-Agent binding (device fingerprint)
- **Rate Limit:** 5 attempts per 60s per challenge token

**Authentication Flow:**

```
Invite → Set Password → Login → Password Check
  ↓                              ↓
                        MFA Required?
                        ├─ NO → Issue JWT
                        └─ YES → MFA Challenge
                                 ↓
                          Enter TOTP Code
                                 ↓
                          Verify Code → Issue JWT
```

**Cache Architecture:**
| Key | TTL | Store | Use |
|-----|-----|-------|-----|
| `auth:admin:{adminId}` | 8h | Redis | Session state (role, sv, MFA status) |
| `auth:admin:mfa:challenge:{token}` | 5min | Redis | MFA challenge with device binding |

**Security Features:**
- ✅ Timing-safe password comparison (dummy hash for non-existent users)
- ✅ CSRF protection (double-submit cookies)
- ✅ HTTP-only JWT cookies (XSS resistant)
- ✅ Device binding (MFA IP+UA validation)
- ✅ Session revocation via sessionVersion
- ✅ Password reset revokes all sessions
- ✅ Rate limiting (login 10/60s per IP, MFA 5/60s per challenge)

**Role-Based Access:**
- TRANSPORT_OFFICER / MANAGEMENT: Full access, MFA **required**
- COORDINATOR: Route-scoped, MFA optional
- FACULTY: Department-scoped, MFA optional

**Scope Control:**
- COORDINATOR: AdminScope.routeIds (which routes they manage)
- FACULTY: AdminScope.department (which department they advise)
- Officer/Management: Unrestricted (all routes/departments)

**Key Strengths:**
- ✅ Invitation-based provisioning (no self-signup)
- ✅ Multi-factor authentication for high-privilege roles
- ✅ Stateless JWT with cache validation
- ✅ Device-bound MFA challenges
- ✅ Audit logging (PII-safe via hashing)

**Design Gaps:**
- ⚠️ No Firebase integration (intentional, but different from mobile auth)
- ⚠️ CSRF token not refreshed on MFA (could be stale)
- ⚠️ No rate limit on invite endpoint (spam risk)
- ⚠️ Challenge device binding optional (can override in test)

**Audit Events Logged:**
- ADMIN_LOGIN_SUCCESS (with MFA status)
- ADMIN_LOGIN_FAILURE (stage: password / mfa)
- PASSWORD_RESET_*
- INVITE_SENT / INVITE_ACCEPTED
- MFA_ENABLED / MFA_DISABLED

---

Full audit above covers invitation flow (48h tokens), MFA setup/verify, session management, CSRF, cache strategy, error handling, and scope enforcement.
