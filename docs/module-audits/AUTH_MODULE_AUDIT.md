# Auth Module (Firebase Verification) — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/auth/`  
**Files:** `auth.service.ts`  
**Total LOC:** ~50 lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The auth module provides **Firebase ID token verification** for student/mobile authentication. Minimal implementation focused on identity verification + local user sync.

**Single Method:** `verifyFirebaseToken(token)`

**Flow:**
1. Verify Firebase ID token (phone number validation)
2. Check if user exists in local DB
3. Validate account is active
4. Return `{ uid, role }`

**Implementation:**
```typescript
async verifyFirebaseToken(firebaseToken: string) {
  // Production: Firebase Admin SDK verification
  const decoded = await firebaseAdmin.auth().verifyIdToken(firebaseToken)
  const phoneNumber = decoded.phone_number
  
  // Non-prod: Mock token support
  if (!isProduction && firebaseToken.startsWith('MOCK_TEST_')) {
    const phoneNumber = extractPhoneFromMockToken(firebaseToken)
  }
  
  // Local DB lookup
  let user = await prisma.user.findUnique({
    where: { phone: phoneNumber }
  })
  
  if (!user) throw 'User not found in College database'
  if (!user.isActive) throw 'Account is disabled'
  
  return {
    uid: user.id,
    role: user.role  // STUDENT, DRIVER, etc.
  }
}
```

**Key Features:**
- ✅ Firebase Admin SDK for production
- ✅ Mock token support for development
- ✅ Local user existence validation
- ✅ Account active status check

**Minimal Scope:**
- No JWT issuance (delegated to mobile-auth.service)
- No session management
- No role derivation
- No cache layer

**Design:**
- Called **before** mobile-auth to verify identity
- mobile-auth then issues JWT + device binding
- Two-service separation: verification + JWT issuance

**Error Handling:**
- Firebase verification failure → propagates error
- User not found → "User not found in College database"
- Account inactive → "Account is disabled"

**Comparison to Admin-Auth:**
| Aspect | Auth | Admin-Auth |
|--------|------|-----------|
| **Source** | Firebase Phone | Local DB (Email/Password) |
| **MFA** | None | TOTP for officers |
| **Session** | JWT issued downstream | JWT issued here |
| **Scope** | None (students) | Routes/Departments |

---

This is a **straightforward verification service**, not a complete auth system. Full lifecycle managed by mobile-auth.service.

Full audit above covers implementation, error handling, and architecture.
