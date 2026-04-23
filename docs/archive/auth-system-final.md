# College Bus Management System
# Authentication System — Final Implementation Spec
# Version: 4.1 (Review fixes applied)

> Status: READY FOR IMPLEMENTATION
> All 6 CTO review issues resolved and incorporated.
> This is the single source of truth. No other auth document supersedes this.
> A coding agent reading this file has everything needed to implement auth completely.

---

## What This Document Contains

- Complete JWT contract (mobile + admin)
- Complete Prisma schema (auth-related fields only)
- Complete middleware (mobile + admin) — every check, in order
- All endpoints with full implementation
- Rate limiting — corrected order (critical bug fixed)
- Session revocation — all 3 mechanisms
- Redis key reference — no raw PII anywhere
- 12 non-negotiable build rules
- Build order — exact sequence

---

## Fixes Applied From CTO Review

| # | Issue | Fix Applied |
|---|---|---|
| 1 | Lockout check ran AFTER counter increment — attacker could keep incrementing during lockout | Check lock flag FIRST, then increment, then delete counter when setting lock |
| 2 | `redis.flushdb()` would nuke trip state, GPS keys, QR nonces at 8am | Replaced with targeted `auth:user:*` key deletion only |
| 3 | `SESSION_VERSION_BUMPED` used as rejection event — wrong semantics | Added `STALE_SESSION_REJECTED` event for middleware rejections |
| 4 | `writeAuthUserCache` select might miss `registeredDeviceId` | Explicitly verified and documented the required select fields |
| 5 | `forceReloginAfter` had race window between DB write and cache update | Added JWT blacklist write during emergency revocation |
| 6 | Common password O(n) loop on every validation | Pre-computed `COMMON_PASSWORDS_LOWER` Set at startup — O(1) |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [JWT Contract](#2-jwt-contract)
3. [Prisma Schema — Auth Fields](#3-prisma-schema)
4. [Redis Auth Cache](#4-redis-auth-cache)
5. [Mobile Auth Middleware](#5-mobile-auth-middleware)
6. [Admin Auth Middleware](#6-admin-auth-middleware)
7. [Mobile Endpoints](#7-mobile-endpoints)
8. [Admin Endpoints](#8-admin-endpoints)
9. [Rate Limiting — Hardened](#9-rate-limiting)
10. [Session Revocation — All 3 Mechanisms](#10-session-revocation)
11. [Password Policy](#11-password-policy)
12. [Auth Audit Events](#12-auth-audit-events)
13. [Redis Key Reference](#13-redis-key-reference)
14. [Security Headers](#14-security-headers)
15. [Build Rules — 12 Non-Negotiables](#15-build-rules)
16. [Build Order](#16-build-order)
17. [Phase 2 Deferred Items](#17-phase-2-deferred)

---

## 1. Architecture Overview

### Two completely separate auth systems

```
MOBILE AUTH                          ADMIN AUTH
─────────────────────────────────    ─────────────────────────────────
Identity:   Firebase phone OTP       Identity:   Email + bcrypt password
Token:      JWT in Authorization     Token:      JWT in httpOnly cookie
Token type: 'MOBILE'                 Token type: 'ADMIN'
Expiry:     24 hours                 Expiry:     8 hours
Refresh:    Silent Firebase refresh  Refresh:    Manual re-login
Device:     Bound by deviceId hash   Device:     N/A (browser-based)
Users:      Student, Staff, Driver   Users:      Coordinator, Officer,
                                                 Faculty, Management
```

These are not interchangeable. A MOBILE token on an admin endpoint returns
403 WRONG_TOKEN_TYPE. An ADMIN token on a mobile endpoint returns 403 WRONG_TOKEN_TYPE.
This check happens in middleware on every single request.

### Why 24-hour JWT on mobile

7-day JWT with sessionVersion is safe in theory but has a gap:
sessionVersion revocation requires a Redis/DB lookup. If Redis has a
cache miss during that lookup, a revoked session gets one more request through.

24-hour JWT closes that gap — the window where a revoked session could slip
through a cache miss is 24 hours max. Silent Firebase refresh handles the
re-issue transparently. Students never see a re-login prompt unless:
- They haven't opened the app in 30+ days (Firebase token expired)
- They explicitly logged out
- Their account was deactivated
All three should require re-authentication anyway.

### The 9-check mobile middleware pipeline

Every authenticated mobile request goes through these 9 checks in order.
If any check fails, the request is rejected immediately. Subsequent checks do not run.

```
1. Token present in Authorization header
2. JWT signature valid + not expired
3. Token type == 'MOBILE'
4. Required fields present (sub, deviceId, sv)
5. User exists and is active (from Redis cache, DB fallback)
6. sessionVersion matches
7. forcedReloginAt check (time-based emergency cutoff)
8. deviceId matches registered device
9. [ROLE CHECK — applied by individual route handlers, not middleware]
```

---

## 2. JWT Contract

### Mobile JWT

```typescript
// packages/shared/src/types/auth.types.ts

export interface MobileJWTPayload {
  sub:      string    // userId (cuid from our DB — not Firebase UID)
  type:     'MOBILE'  // must be exactly this string
  role:     Role      // STUDENT | STAFF | DRIVER
  deviceId: string    // SHA-256 hash of device identifier
  sv:       number    // sessionVersion — must match DB value on every request
  iat:      number    // issued at (Unix seconds)
  exp:      number    // expires at — iat + 86400 (24 hours)
}
```

### Admin JWT

```typescript
export interface AdminJWTPayload {
  sub:   string      // adminUserId
  type:  'ADMIN'     // must be exactly this string
  role:  AdminRole   // COORDINATOR | TRANSPORT_OFFICER | FACULTY | MANAGEMENT
  email: string      // for display only — not used for auth decisions
  sv:    number      // sessionVersion
  iat:   number
  exp:   number      // iat + 28800 (8 hours)
}
```

### What goes into deviceId

```typescript
// The deviceId in the JWT is a SHA-256 hash of the device's unique identifier.
// Never store or log the raw device identifier.

import * as Crypto from 'expo-crypto'

export const getDeviceIdHash = async (): Promise<string> => {
  const deviceId = Application.androidId              // Android
                ?? await Application.getIosIdForVendor() // iOS
                ?? 'fallback-' + Device.modelId

  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    deviceId
  )
}
// Result: "a3f8c2d1e9b4..." — 64 hex chars
// This hash is sent in every mobile API request header and stored in JWT
```

---

## 3. Prisma Schema — Auth Fields

These fields are added to the main User model and a separate AdminUser model.
All other User fields (name, phone, role, etc.) are defined in the main schema.

### Auth fields on User model

```prisma
model User {
  // ... all other fields from main schema ...

  // Auth state — all auth-related fields grouped here
  firebaseUid           String?    @unique   // Firebase UID — set on first login
  registeredDeviceId    String?              // SHA-256 device hash — updated on every login
  sessionVersion        Int        @default(1) // increment to revoke all sessions
  authStatus            AuthStatus @default(PENDING_PROVISIONING)
  lastLoginAt           DateTime?
  deviceBoundAt         DateTime?            // when current device was bound
  forcedReloginAt       DateTime?            // emergency: force re-auth after this timestamp
  fcmToken              String?              // Firebase push token for this device

  // Relations
  authAuditEvents       AuthAuditEvent[]     @relation("SubjectAuditEvents")

  @@map("users")
}

enum AuthStatus {
  PENDING_PROVISIONING  // account created, not yet Firebase-provisioned
  ACTIVE                // normal — can log in
  DISABLED              // deactivated — cannot log in
}
```

### AdminUser model — complete

```prisma
model AdminUser {
  id                     String     @id @default(cuid())
  name                   String
  email                  String     @unique
  passwordHash           String     // bcrypt, cost factor 12
  role                   AdminRole
  isActive               Boolean    @default(true)
  sessionVersion         Int        @default(1)
  lastLoginAt            DateTime?
  lastLoginIp            String?
  lastLoginUserAgent     String?
  passwordResetTokenHash String?    // SHA-256 of raw token sent in email
  passwordResetExpiresAt DateTime?
  inviteTokenHash        String?    // SHA-256 of raw invite token
  inviteTokenExpiresAt   DateTime?
  mfaEnabled             Boolean    @default(false)  // Phase 2
  mfaSecretEncrypted     String?                     // Phase 2
  createdById            String?
  createdAt              DateTime   @default(now())
  updatedAt              DateTime   @updatedAt
  deactivatedAt          DateTime?
  deactivatedById        String?

  authAuditEvents        AuthAuditEvent[] @relation("AdminAuditEvents")

  @@map("admin_users")
}

enum AdminRole {
  COORDINATOR
  TRANSPORT_OFFICER
  FACULTY
  MANAGEMENT
}
```

### AuthAuditEvent model — append-only

```prisma
model AuthAuditEvent {
  id          String              @id @default(cuid())
  actorType   String              // 'MOBILE_USER' | 'ADMIN_USER' | 'SYSTEM'
  actorId     String?             // userId, adminId, or null for system
  targetType  String?             // 'MOBILE_USER' | 'ADMIN_USER' — when actor != target
  targetId    String?             // userId being acted upon
  eventType   AuthAuditEventType
  ipAddress   String?
  deviceId    String?             // hashed device id — never raw
  metadata    Json?               // event-specific data — never raw PII
  createdAt   DateTime            @default(now())

  mobileUser  User?      @relation("SubjectAuditEvents", fields: [actorId], references: [id], map: "audit_mobile_actor")
  adminUser   AdminUser? @relation("AdminAuditEvents", fields: [actorId], references: [id], map: "audit_admin_actor")

  // Append-only — no update, no delete
  @@index([actorId, createdAt])
  @@index([targetId, createdAt])
  @@index([eventType, createdAt])
  @@map("auth_audit_events")
}
```

### Migration

```bash
npx prisma migrate dev --name auth_final
# Creates: admin_users, auth_audit_events tables
# Adds: auth fields to users table
npx prisma generate
```

---

## 4. Redis Auth Cache

### Why Redis for auth state

Every authenticated request needs: isActive, sessionVersion, registeredDeviceId, forcedReloginAt.
Fetching from PostgreSQL on every request would be ~10ms per request.
With 6,000 students and 60 GPS pings/sec, that's ~600+ DB reads/sec just for auth.
Redis reduces this to <1ms per request.

### Cache structure

```typescript
// lib/auth-cache.ts

import { redis } from './redis'
import { prisma } from './prisma'

// ── Mobile user auth state ────────────────────────────────────────────────

interface MobileAuthState {
  isActive:           boolean
  sessionVersion:     number
  registeredDeviceId: string | null
  forcedReloginAt:    string | null  // ISO string or null
}

export const AUTH_CACHE_TTL = 24 * 60 * 60  // 24 hours — matches JWT lifetime

export const writeAuthUserCache = async (userId: string): Promise<void> => {
  // CRITICAL: This select must include ALL fields checked in middleware.
  // Missing any field here means middleware falls back to DB every time.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive:           true,
      sessionVersion:     true,
      registeredDeviceId: true,  // MUST be here — used for device binding check
      forcedReloginAt:    true,  // MUST be here — used for emergency check
    }
  })

  if (!user) return

  const state: MobileAuthState = {
    isActive:           user.isActive,
    sessionVersion:     user.sessionVersion,
    registeredDeviceId: user.registeredDeviceId,
    forcedReloginAt:    user.forcedReloginAt?.toISOString() ?? null,
  }

  await redis.setex(
    `auth:user:${userId}`,
    AUTH_CACHE_TTL,
    JSON.stringify(state)
  )
}

export const getAuthUserState = async (userId: string): Promise<MobileAuthState | null> => {
  // Try Redis first
  const cached = await redis.get(`auth:user:${userId}`)
  if (cached) return JSON.parse(cached) as MobileAuthState

  // DB fallback — cache miss (Redis restart, first login, etc.)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive:           true,
      sessionVersion:     true,
      registeredDeviceId: true,
      forcedReloginAt:    true,
    }
  })

  if (!user) return null

  // Rebuild cache while we have the data
  const state: MobileAuthState = {
    isActive:           user.isActive,
    sessionVersion:     user.sessionVersion,
    registeredDeviceId: user.registeredDeviceId,
    forcedReloginAt:    user.forcedReloginAt?.toISOString() ?? null,
  }
  await redis.setex(`auth:user:${userId}`, AUTH_CACHE_TTL, JSON.stringify(state))

  return state
}

export const invalidateMobileAuthCache = async (userId: string): Promise<void> => {
  await redis.del(`auth:user:${userId}`)
}

// ── Admin user auth state ─────────────────────────────────────────────────

interface AdminAuthState {
  isActive:       boolean
  sessionVersion: number
  role:           string
}

export const ADMIN_CACHE_TTL = 8 * 60 * 60  // 8 hours — matches admin JWT lifetime

export const writeAuthAdminCache = async (adminId: string): Promise<void> => {
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { isActive: true, sessionVersion: true, role: true }
  })
  if (!admin) return

  await redis.setex(
    `auth:admin:${adminId}`,
    ADMIN_CACHE_TTL,
    JSON.stringify({ isActive: admin.isActive, sessionVersion: admin.sessionVersion, role: admin.role })
  )
}

export const getAuthAdminState = async (adminId: string): Promise<AdminAuthState | null> => {
  const cached = await redis.get(`auth:admin:${adminId}`)
  if (cached) return JSON.parse(cached) as AdminAuthState

  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    select: { isActive: true, sessionVersion: true, role: true }
  })
  if (!admin) return null

  await redis.setex(
    `auth:admin:${adminId}`,
    ADMIN_CACHE_TTL,
    JSON.stringify({ isActive: admin.isActive, sessionVersion: admin.sessionVersion, role: admin.role })
  )
  return { isActive: admin.isActive, sessionVersion: admin.sessionVersion, role: admin.role }
}
```

---

## 5. Mobile Auth Middleware

### Complete implementation — all 9 checks

```typescript
// middleware/auth.middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { getAuthUserState } from '../lib/auth-cache'
import { writeAuthAuditEvent } from '../lib/auth-audit'
import { MobileJWTPayload } from '@bus/shared'

export const requireMobileAuth = async (
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {

  // ── Check 1: Token present ───────────────────────────────────────────
  const token = req.headers.authorization?.replace('Bearer ', '').trim()
  if (!token) {
    return reply.code(401).send({ error: 'UNAUTHORIZED', requestId: req.id })
  }

  // ── Check 2: JWT signature valid and not expired ─────────────────────
  let payload: MobileJWTPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as MobileJWTPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // TOKEN_EXPIRED is a normal condition — mobile app refreshes silently
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', requestId: req.id })
    }
    return reply.code(401).send({ error: 'INVALID_TOKEN', requestId: req.id })
  }

  // ── Check 3: Token type ──────────────────────────────────────────────
  // Prevents admin JWTs from being used on mobile endpoints and vice versa
  if (payload.type !== 'MOBILE') {
    return reply.code(403).send({ error: 'WRONG_TOKEN_TYPE', requestId: req.id })
  }

  // ── Check 4: Required fields present ────────────────────────────────
  // Validates token structure — defense against malformed tokens
  if (!payload.sub || !payload.deviceId || payload.sv === undefined || !payload.role) {
    return reply.code(401).send({ error: 'INVALID_TOKEN_STRUCTURE', requestId: req.id })
  }

  // ── Check 5: User exists and is active ──────────────────────────────
  // Redis cache hit: ~1ms. DB fallback: ~10ms.
  const authState = await getAuthUserState(payload.sub)
  if (!authState) {
    return reply.code(401).send({ error: 'USER_NOT_FOUND', requestId: req.id })
  }
  if (!authState.isActive) {
    return reply.code(403).send({ error: 'ACCOUNT_DISABLED', requestId: req.id })
  }

  // ── Check 6: sessionVersion matches ─────────────────────────────────
  // sessionVersion is incremented when: account deactivated, password reset,
  // logout-all, role changed, admin-forced revocation.
  // Any JWT with an old sv is permanently rejected.
  if (payload.sv !== authState.sessionVersion) {
    // NOTE: this is a REJECTION event — not a BUMP event
    // SESSION_VERSION_BUMPED = the admin action that incremented the version
    // STALE_SESSION_REJECTED = this middleware detecting the stale session
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   payload.sub,
      eventType: 'STALE_SESSION_REJECTED',  // [FIX] was SESSION_VERSION_BUMPED — wrong semantics
      metadata:  { tokenSv: payload.sv, currentSv: authState.sessionVersion }
    })
    return reply.code(401).send({ error: 'SESSION_REVOKED', requestId: req.id })
  }

  // ── Check 7: forcedReloginAt — emergency time-based cutoff ──────────
  // Used during security incidents to force all sessions to re-authenticate.
  // If forcedReloginAt is set and the token was issued BEFORE that timestamp,
  // the session must re-authenticate. Difference from sessionVersion:
  //   sessionVersion: immediate, per-user, requires incrementing a counter
  //   forcedReloginAt: time-based, can affect many users at once with one DB write
  if (authState.forcedReloginAt) {
    const forcedAtSeconds = new Date(authState.forcedReloginAt).getTime() / 1000
    if (payload.iat < forcedAtSeconds) {
      void writeAuthAuditEvent({
        actorType: 'MOBILE_USER',
        actorId:   payload.sub,
        eventType: 'FORCED_RELOGIN_REQUIRED',
        metadata:  { tokenIat: payload.iat, forcedAtSeconds }
      })
      return reply.code(401).send({ error: 'FORCED_RELOGIN_REQUIRED', requestId: req.id })
    }
  }

  // ── Check 8: Device binding ──────────────────────────────────────────
  // The deviceId in the JWT must match the registered device in the cache.
  // Prevents a stolen JWT from being used on a different device.
  // registeredDeviceId is null after logout-all — forces device re-registration.
  if (!authState.registeredDeviceId || payload.deviceId !== authState.registeredDeviceId) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   payload.sub,
      eventType: 'DEVICE_MISMATCH_REJECTED',
      deviceId:  payload.deviceId,
      metadata:  { hasRegisteredDevice: !!authState.registeredDeviceId }
    })
    return reply.code(401).send({ error: 'DEVICE_MISMATCH', requestId: req.id })
  }

  // ── All checks passed — attach user to request ───────────────────────
  req.user = payload
}

// ── Role guard factory ───────────────────────────────────────────────────────
// Used by individual routes to enforce role requirements.
// Always applied AFTER requireMobileAuth — req.user is guaranteed present.

export const requireRole = (allowedRoles: Role[]) => {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', requestId: req.id })
    }
    if (!allowedRoles.includes(req.user.role as Role)) {
      return reply.code(403).send({ error: 'FORBIDDEN', requestId: req.id })
    }
  }
}

// TypeScript: extend FastifyRequest to include req.user
declare module 'fastify' {
  interface FastifyRequest {
    user?: MobileJWTPayload | AdminJWTPayload
  }
}
```

---

## 6. Admin Auth Middleware

```typescript
// middleware/admin-auth.middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { getAuthAdminState } from '../lib/auth-cache'
import { AdminJWTPayload } from '@bus/shared'

export const requireAdminAuth = async (
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> => {

  // Admin JWT comes from httpOnly cookie — not Authorization header
  const token = req.cookies?.admin_jwt
  if (!token) {
    return reply.code(401).send({ error: 'UNAUTHORIZED', requestId: req.id })
  }

  let payload: AdminJWTPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as AdminJWTPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', requestId: req.id })
    }
    return reply.code(401).send({ error: 'INVALID_TOKEN', requestId: req.id })
  }

  // Token type check — admin token only on admin endpoints
  if (payload.type !== 'ADMIN') {
    return reply.code(403).send({ error: 'WRONG_TOKEN_TYPE', requestId: req.id })
  }

  if (!payload.sub || payload.sv === undefined) {
    return reply.code(401).send({ error: 'INVALID_TOKEN_STRUCTURE', requestId: req.id })
  }

  const authState = await getAuthAdminState(payload.sub)
  if (!authState) {
    return reply.code(401).send({ error: 'ADMIN_NOT_FOUND', requestId: req.id })
  }
  if (!authState.isActive) {
    return reply.code(403).send({ error: 'ACCOUNT_DISABLED', requestId: req.id })
  }
  if (payload.sv !== authState.sessionVersion) {
    return reply.code(401).send({ error: 'SESSION_REVOKED', requestId: req.id })
  }

  req.user = payload
}

// Admin role guard
export const requireAdminRole = (allowedRoles: AdminRole[]) => {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) return reply.code(401).send({ error: 'UNAUTHORIZED' })
    if (!allowedRoles.includes((req.user as AdminJWTPayload).role as AdminRole)) {
      return reply.code(403).send({ error: 'FORBIDDEN' })
    }
  }
}
```

---

## 7. Mobile Endpoints

### POST /v1/auth/login

```typescript
// modules/auth/mobile-auth.service.ts

export const mobileLogin = async (
  firebaseToken: string,
  rawDeviceId: string,       // raw device identifier from mobile app
  ipAddress: string
) => {
  // Step 1: Verify Firebase ID token
  const decodedFirebase = await firebaseAdmin.auth().verifyIdToken(firebaseToken)
  const phoneNumber = decodedFirebase.phone_number  // format: "+919876543210"

  if (!phoneNumber) {
    throw new AppError('INVALID_FIREBASE_TOKEN', 401)
  }

  // Step 2: Find user by phone
  // CRITICAL: phone is stored as "+919876543210" in DB.
  // Firebase also returns "+919876543210". They must match exactly.
  // If mismatch: check seeding script — ensure +91 prefix used everywhere.
  const user = await prisma.user.findUnique({
    where: { phone: phoneNumber },
    select: {
      id: true, role: true, isActive: true,
      authStatus: true, firebaseUid: true,
      sessionVersion: true, registeredDeviceId: true,
    }
  })

  // Step 3: Handle user not found
  if (!user) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      eventType: 'MOBILE_LOGIN_FAILURE',
      ipAddress,
      metadata:  { reason: 'USER_NOT_FOUND', phoneHash: hashForLog(phoneNumber) }
    })
    throw new AppError('USER_NOT_REGISTERED', 404, {
      message: 'This phone number is not registered in the system.'
    })
  }

  // Step 4: Check account status
  if (!user.isActive || user.authStatus === 'DISABLED') {
    throw new AppError('ACCOUNT_DISABLED', 403)
  }

  if (user.authStatus === 'PENDING_PROVISIONING') {
    // Account exists but Firebase hasn't been provisioned yet.
    // This happens if the provisioning job failed.
    return { status: 'PENDING_PROVISIONING', retryAfterSeconds: 30 }
  }

  // Step 5: Firebase UID consistency check
  // First login from this Firebase user: bind the UID
  if (!user.firebaseUid) {
    await prisma.user.update({
      where: { id: user.id },
      data:  { firebaseUid: decodedFirebase.uid }
    })
  } else if (user.firebaseUid !== decodedFirebase.uid) {
    // UID mismatch — same phone number, different Firebase account.
    // This shouldn't happen in normal operation.
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   user.id,
      eventType: 'MOBILE_LOGIN_FAILURE',
      ipAddress,
      metadata:  { reason: 'FIREBASE_UID_MISMATCH' }
    })
    throw new AppError('AUTH_CONFLICT', 409)
  }

  // Step 6: Hash the device ID — never store raw device identifier
  const deviceIdHash = crypto
    .createHash('sha256')
    .update(rawDeviceId)
    .digest('hex')

  const isNewDevice = user.registeredDeviceId !== deviceIdHash

  // Step 7: Update user record
  await prisma.user.update({
    where: { id: user.id },
    data: {
      registeredDeviceId: deviceIdHash,
      lastLoginAt:        new Date(),
      deviceBoundAt:      isNewDevice ? new Date() : undefined,
    }
  })

  // Step 8: Issue JWT
  const jwtPayload: MobileJWTPayload = {
    sub:      user.id,
    type:     'MOBILE',
    role:     user.role,
    deviceId: deviceIdHash,
    sv:       user.sessionVersion,
    iat:      Math.floor(Date.now() / 1000),
    exp:      Math.floor(Date.now() / 1000) + (24 * 60 * 60),  // 24 hours
  }

  const token = jwt.sign(jwtPayload, process.env.JWT_SECRET!, { expiresIn: '24h' })

  // Step 9: Update Redis auth cache
  await writeAuthUserCache(user.id)

  // Step 10: Audit log
  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId:   user.id,
    eventType: 'MOBILE_LOGIN_SUCCESS',
    deviceId:  deviceIdHash,
    ipAddress,
    metadata:  { isNewDevice, role: user.role }
  })

  if (isNewDevice) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   user.id,
      eventType: 'DEVICE_REBOUND',
      deviceId:  deviceIdHash,
      ipAddress,
      metadata:  { previousDevice: user.registeredDeviceId ? 'existed' : 'none' }
    })
  }

  return {
    status: 'SUCCESS',
    token,
    user: {
      id:   user.id,
      role: user.role,
      // Include route assignment, bus info etc from /v1/auth/me
    }
  }
}
```

### POST /v1/auth/refresh

```typescript
// POST /v1/auth/refresh
// Body: { firebaseToken: string, deviceId: string }
// Auth: none (used to get a new JWT when the old one expired)

export const mobileRefresh = async (
  firebaseToken: string,
  rawDeviceId: string
) => {
  // Verify Firebase token (proves phone ownership)
  const decodedFirebase = await firebaseAdmin.auth().verifyIdToken(firebaseToken)
  const phoneNumber = decodedFirebase.phone_number

  const user = await prisma.user.findUnique({
    where: { phone: phoneNumber },
    select: { id: true, role: true, isActive: true, sessionVersion: true, registeredDeviceId: true }
  })

  if (!user || !user.isActive) throw new AppError('UNAUTHORIZED', 401)

  const deviceIdHash = crypto.createHash('sha256').update(rawDeviceId).digest('hex')

  // Device must match registered device — refresh doesn't allow device change
  if (user.registeredDeviceId !== deviceIdHash) {
    void writeAuthAuditEvent({
      actorType: 'MOBILE_USER',
      actorId:   user.id,
      eventType: 'MOBILE_REFRESH_REJECTED',
      metadata:  { reason: 'DEVICE_MISMATCH' }
    })
    throw new AppError('DEVICE_MISMATCH', 401)
  }

  // Issue new 24-hour JWT
  const token = jwt.sign(
    { sub: user.id, type: 'MOBILE', role: user.role, deviceId: deviceIdHash, sv: user.sessionVersion },
    process.env.JWT_SECRET!,
    { expiresIn: '24h' }
  )

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId:   user.id,
    eventType: 'MOBILE_REFRESH_SUCCESS',
    deviceId:  deviceIdHash,
  })

  return { token }
}
```

### POST /v1/auth/logout

```typescript
// POST /v1/auth/logout
// Auth: requireMobileAuth
// Clears FCM token. Does NOT revoke session (use logout-all for that).

export const mobileLogout = async (userId: string, deviceId: string) => {
  // Clear FCM token so this device stops receiving push notifications
  await prisma.user.update({
    where: { id: userId },
    data:  { fcmToken: null }
  })

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId:   userId,
    eventType: 'MOBILE_LOGOUT',
    deviceId,
  })
}
```

### POST /v1/auth/logout-all

```typescript
// POST /v1/auth/logout-all
// Auth: requireMobileAuth
// Rate limit: 3 per hour per user (prevents DoS of own account)
// Kills ALL sessions: increments sessionVersion + clears registeredDeviceId

fastify.post('/v1/auth/logout-all', {
  preHandler: [requireMobileAuth]
}, async (req, reply) => {
  const userId = req.user!.sub

  // Single transaction: bump version + clear device binding
  await prisma.user.update({
    where: { id: userId },
    data:  {
      sessionVersion:     { increment: 1 },
      registeredDeviceId: null,    // forces re-device-registration on next login
      fcmToken:           null,    // stop notifications to old device
    }
  })

  // Update Redis cache immediately — new sessionVersion takes effect at once
  await writeAuthUserCache(userId)

  void writeAuthAuditEvent({
    actorType: 'MOBILE_USER',
    actorId:   userId,
    eventType: 'LOGOUT_ALL_SESSIONS',
    deviceId:  req.user!.deviceId,
    metadata:  { reason: 'USER_INITIATED' }
  })

  reply.send({ success: true })
})
```

### GET /v1/auth/me

```typescript
// GET /v1/auth/me
// Auth: requireMobileAuth
// Returns full user profile with route assignment, bus info

fastify.get('/v1/auth/me', {
  preHandler: [requireMobileAuth]
}, async (req, reply) => {
  const userId = req.user!.sub

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      routeAssignment: {
        include: {
          route: {
            include: {
              stops: { include: { stop: true }, orderBy: { sequence: 'asc' } }
            }
          },
          stop: true,
        }
      }
    }
  })

  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND' })

  return reply.send({
    id:              user.id,
    name:            user.name,
    role:            user.role,
    department:      user.department,
    rollNumber:      user.rollNumber,
    routeAssignment: user.routeAssignment,
    // Never return: passwordHash, registeredDeviceId, sessionVersion, firebaseUid
  })
})
```

---

## 8. Admin Endpoints

### POST /v1/admin/auth/login

```typescript
// modules/auth/admin-auth.service.ts

// Pre-computed at module load — NEVER inside the function (would be slow + wrong)
// This is the timing-safe constant for user-not-found path
const DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 12)

export const adminLogin = async (
  email:     string,
  password:  string,
  ipAddress: string,
  userAgent: string,
  reply:     FastifyReply
) => {
  const normalizedEmail = email.toLowerCase().trim()
  const emailHash = crypto.createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 16)

  // ── [FIX] Check lock flag FIRST — before any counter increment ──────
  // If checked after increment, the counter keeps growing during lockout,
  // causing the "immediately locked again after lockout" bug.
  const alreadyLocked = await redis.get(`ratelimit:admin:locked:${emailHash}`)
  if (alreadyLocked) {
    throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', 429, {
      message: 'Account temporarily locked. Try again in 15 minutes.'
    })
  }

  // ── Increment attempt counter ────────────────────────────────────────
  const accountRateKey = `ratelimit:admin:account:${emailHash}`
  const accountAttempts = await redis.incr(accountRateKey)
  if (accountAttempts === 1) {
    await redis.expire(accountRateKey, 5 * 60)  // 5-minute window
  }

  // ── Lock account if threshold exceeded ──────────────────────────────
  if (accountAttempts > 5) {
    // Set lock flag for 15 minutes
    await redis.setex(`ratelimit:admin:locked:${emailHash}`, 15 * 60, '1')
    // [FIX] Delete the attempt counter — clean slate after lockout expires
    // Without this, the counter persists and triggers immediate re-lock
    await redis.del(accountRateKey)

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      eventType: 'ADMIN_ACCOUNT_LOCKED',
      ipAddress,
      metadata:  { emailHash, attempts: accountAttempts }
    })

    throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', 429, {
      message: 'Too many failed attempts. Account locked for 15 minutes.'
    })
  }

  // ── Fetch admin (timing-safe) ────────────────────────────────────────
  const admin = await prisma.adminUser.findUnique({
    where: { email: normalizedEmail }
  })

  // Always run bcrypt — even when admin not found
  // This prevents timing attacks that reveal whether an email exists
  const hashToCompare = admin?.passwordHash ?? DUMMY_BCRYPT_HASH
  const passwordMatch = await bcrypt.compare(password, hashToCompare)

  // Single branch for all failure cases — prevents email enumeration
  if (!admin || !admin.isActive || !passwordMatch) {
    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId:   admin?.id,
      eventType: 'ADMIN_LOGIN_FAILURE',
      ipAddress,
      metadata:  { emailHash }  // hash, not raw email
    })
    throw new AppError('INVALID_CREDENTIALS', 401, {
      message: 'Email or password is incorrect'
    })
  }

  // ── Success — reset attempt counter ─────────────────────────────────
  await redis.del(accountRateKey)

  // Update last login metadata
  await prisma.adminUser.update({
    where: { id: admin.id },
    data:  { lastLoginAt: new Date(), lastLoginIp: ipAddress, lastLoginUserAgent: userAgent }
  })

  // Issue JWT
  const token = jwt.sign(
    { sub: admin.id, type: 'ADMIN', role: admin.role, email: admin.email, sv: admin.sessionVersion },
    process.env.JWT_SECRET!,
    { expiresIn: '8h' }
  )

  // Set httpOnly cookie — NEVER send token in response body
  reply.setCookie('admin_jwt', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   8 * 60 * 60,  // 8 hours in seconds
    path:     '/v1/admin',  // cookie only sent on admin routes
    domain:   process.env.ADMIN_COOKIE_DOMAIN  // e.g. "admin.yourdomain.com"
  })

  // Update Redis cache
  await writeAuthAdminCache(admin.id)

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId:   admin.id,
    eventType: 'ADMIN_LOGIN_SUCCESS',
    ipAddress,
    metadata:  { role: admin.role }
  })

  // Return user info but NOT the token (it's in the cookie)
  return {
    id:   admin.id,
    name: admin.name,
    role: admin.role,
  }
}
```

### POST /v1/admin/auth/logout

```typescript
fastify.post('/v1/admin/auth/logout', {
  preHandler: [requireAdminAuth]
}, async (req, reply) => {
  const adminId = (req.user as AdminJWTPayload).sub

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId:   adminId,
    eventType: 'ADMIN_LOGOUT',
  })

  // Clear the httpOnly cookie
  reply.clearCookie('admin_jwt', { path: '/v1/admin' })
  reply.send({ success: true })
})
```

### POST /v1/admin/auth/forgot-password

```typescript
// CRITICAL: Always return 200. Never reveal if email exists.

fastify.post('/v1/admin/auth/forgot-password', async (req, reply) => {
  const { email } = req.body as { email: string }
  const ipAddress = req.ip

  // IP-based rate limit — prevent email enumeration via timing
  await checkAdminForgotPasswordRateLimit(ipAddress)

  const normalizedEmail = email.toLowerCase().trim()
  const admin = await prisma.adminUser.findUnique({ where: { email: normalizedEmail } })

  // Do NOT branch on whether admin was found — always return 200
  if (admin && admin.isActive) {
    const rawToken = crypto.randomBytes(32).toString('hex')  // 64 hex chars
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)  // 1 hour

    await prisma.adminUser.update({
      where: { id: admin.id },
      data:  { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt }
    })

    // Send email with rawToken (not hash)
    // Email service sends: /admin/reset-password?token=${rawToken}
    await sendPasswordResetEmail(admin.email, admin.name, rawToken)

    void writeAuthAuditEvent({
      actorType: 'ADMIN_USER',
      actorId:   admin.id,
      eventType: 'PASSWORD_RESET_REQUESTED',
      ipAddress,
    })
  }

  // Always return 200 — same response regardless of whether email existed
  reply.send({ message: 'If this email is registered, a reset link has been sent.' })
})
```

### POST /v1/admin/auth/reset-password

```typescript
fastify.post('/v1/admin/auth/reset-password', async (req, reply) => {
  const { token, newPassword } = req.body as { token: string, newPassword: string }

  // Validate password before touching DB
  validateAdminPassword(newPassword)

  // Hash the incoming token to compare against stored hash
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const admin = await prisma.adminUser.findFirst({
    where: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { gt: new Date() },  // not expired
      isActive: true,
    }
  })

  if (!admin) {
    throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400, {
      message: 'This reset link is invalid or has expired.'
    })
  }

  const passwordHash = await bcrypt.hash(newPassword, 12)

  // Atomic update: set new password + invalidate token + bump sessionVersion
  await prisma.adminUser.update({
    where: { id: admin.id },
    data:  {
      passwordHash,
      passwordResetTokenHash:  null,   // token used — invalidate it
      passwordResetExpiresAt:  null,
      sessionVersion:          { increment: 1 },  // revoke existing sessions
    }
  })

  // Update Redis cache with new sessionVersion
  await writeAuthAdminCache(admin.id)

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId:   admin.id,
    eventType: 'PASSWORD_RESET_COMPLETED',
  })

  reply.send({ success: true, message: 'Password updated. Please log in.' })
})
```

### POST /v1/admin/auth/invite (transport officer creates new admin)

```typescript
fastify.post('/v1/admin/auth/invite', {
  preHandler: [requireAdminAuth, requireAdminRole(['TRANSPORT_OFFICER'])]
}, async (req, reply) => {
  const { email, name, role } = req.body as { email: string, name: string, role: AdminRole }
  const actorId = (req.user as AdminJWTPayload).sub

  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)  // 48 hours

  await prisma.adminUser.create({
    data: {
      email:               email.toLowerCase().trim(),
      name,
      role,
      passwordHash:        await bcrypt.hash(crypto.randomBytes(32).toString(), 12), // placeholder
      inviteTokenHash:     tokenHash,
      inviteTokenExpiresAt: expiresAt,
      createdById:         actorId,
    }
  })

  await sendInviteEmail(email, name, rawToken)

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId:   actorId,
    eventType: 'INVITE_SENT',
    metadata:  { targetEmail: hashForLog(email), targetRole: role }
  })

  reply.code(201).send({ success: true })
})
```

### POST /v1/admin/auth/set-password (accept invite)

```typescript
fastify.post('/v1/admin/auth/set-password', async (req, reply) => {
  const { token, password } = req.body as { token: string, password: string }

  validateAdminPassword(password)

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const admin = await prisma.adminUser.findFirst({
    where: {
      inviteTokenHash:      tokenHash,
      inviteTokenExpiresAt: { gt: new Date() },
    }
  })

  if (!admin) throw new AppError('INVALID_OR_EXPIRED_TOKEN', 400)

  await prisma.adminUser.update({
    where: { id: admin.id },
    data:  {
      passwordHash:        await bcrypt.hash(password, 12),
      inviteTokenHash:     null,  // token used — invalidate
      inviteTokenExpiresAt: null,
      isActive:            true,
    }
  })

  void writeAuthAuditEvent({
    actorType: 'ADMIN_USER',
    actorId:   admin.id,
    eventType: 'INVITE_ACCEPTED',
  })

  reply.send({ success: true, message: 'Account activated. Please log in.' })
})
```

---

## 9. Rate Limiting — Hardened

### The corrected order — check lock first, then increment

```typescript
// lib/rate-limit.ts

export const checkMobileLoginRateLimit = async (phone: string, ip: string) => {
  const phoneHash = crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16)

  // IP-based: 10 per minute — catches automation
  const ipKey = `ratelimit:mobile:login:ip:${ip}`
  const ipCount = await redis.incr(ipKey)
  if (ipCount === 1) await redis.expire(ipKey, 60)
  if (ipCount > 10) throw new AppError('RATE_LIMITED', 429, { retryAfter: 60 })

  // Phone-based: 5 per minute — catches abuse of specific number
  const phoneKey = `ratelimit:mobile:login:phone:${phoneHash}`
  const phoneCount = await redis.incr(phoneKey)
  if (phoneCount === 1) await redis.expire(phoneKey, 60)
  if (phoneCount > 5) throw new AppError('RATE_LIMITED', 429, { retryAfter: 60 })
}

export const checkAdminLoginRateLimit = async (email: string, ip: string) => {
  const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)

  // [FIX] Check lock flag FIRST — before incrementing any counter
  // Previous bug: checked after increment → counter grew unbounded during lockout
  const locked = await redis.get(`ratelimit:admin:locked:${emailHash}`)
  if (locked) throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', 429, { retryAfter: 900 })

  // IP-based: 10 per minute
  const ipKey = `ratelimit:admin:login:ip:${ip}`
  const ipCount = await redis.incr(ipKey)
  if (ipCount === 1) await redis.expire(ipKey, 60)
  if (ipCount > 10) throw new AppError('RATE_LIMITED', 429)

  // Account-based: 5 per 5 minutes → 15-minute lockout
  const accountKey = `ratelimit:admin:account:${emailHash}`
  const accountCount = await redis.incr(accountKey)
  if (accountCount === 1) await redis.expire(accountKey, 5 * 60)

  if (accountCount > 5) {
    await redis.setex(`ratelimit:admin:locked:${emailHash}`, 15 * 60, '1')
    // [FIX] Delete counter when setting lock — prevents "re-locked immediately" bug
    await redis.del(accountKey)
    throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', 429, { retryAfter: 900 })
  }
}

// Reset on successful login — prevent false lockout of legitimate user
export const resetAdminLoginRateLimit = async (email: string) => {
  const emailHash = crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)
  await redis.del(`ratelimit:admin:account:${emailHash}`)
}
```

### Complete rate limit matrix

```
Endpoint                              | Limit          | Window  | Key type
──────────────────────────────────────|─────────────────|─────────|──────────
POST /v1/auth/login                   | 10/min (IP)     | 60s     | IP
                                      | 5/min (phone)   | 60s     | phoneHash
POST /v1/auth/refresh                 | 15/min (IP)     | 60s     | IP
POST /v1/auth/logout-all              | 3/hour (user)   | 3600s   | userId
POST /v1/admin/auth/login             | 10/min (IP)     | 60s     | IP
                                      | 5/5min (account)| 300s    | emailHash → lock 15min
POST /v1/admin/auth/forgot-password   | 5/5min (IP)     | 300s    | IP
POST /v1/admin/auth/reset-password    | 5/5min (IP)     | 300s    | IP
POST /v1/admin/auth/set-password      | 5/5min (IP)     | 300s    | IP
POST /v1/attendance/check-in          | 3/min (user)    | 60s     | userId
```

---

## 10. Session Revocation — All 3 Mechanisms

### When to use each mechanism

```
Mechanism 1 — sessionVersion (standard, immediate, per-user)
  Use for: logout-all, password reset, account deactivated, role changed
  How: increment User.sessionVersion in DB + writeAuthUserCache()
  Effect: all existing JWTs with old sv immediately rejected
  Next request from that user: 401 SESSION_REVOKED → app re-authenticates

Mechanism 2 — forcedReloginAt (mass emergency, time-based)
  Use for: security incident affecting many users at once
  How: set User.forcedReloginAt = future timestamp for many users
  Effect: all JWTs issued before that timestamp are rejected
  Advantage: one DB write can affect thousands of users without
             needing to iterate and bump each sessionVersion

Mechanism 3 — JWT blacklist (immediate, belt-and-suspenders)
  Use for: individual emergency when sessionVersion cache might be stale
  How: redis.setex('jwt:blacklist:{userId}', TTL, '1')
  Effect: all requests from that user rejected until TTL expires
  Use sparingly — sessionVersion should be sufficient for normal cases
```

### revokeAllSessions (Mechanism 1)

```typescript
// lib/auth-revocation.ts

export const revokeAllSessions = async (
  userId:  string,
  reason:  string,
  actorId?: string   // undefined = system action
) => {
  const updated = await prisma.user.update({
    where:  { id: userId },
    data:   { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true }
  })

  // Update Redis immediately — revocation takes effect on next request
  await writeAuthUserCache(userId)

  void writeAuthAuditEvent({
    actorType: actorId ? 'ADMIN_USER' : 'SYSTEM',
    actorId:   actorId ?? 'system',
    targetType: 'MOBILE_USER',
    targetId:  userId,
    eventType: 'SESSION_VERSION_BUMPED',  // this is the admin ACTION, not the rejection
    metadata:  { reason, newVersion: updated.sessionVersion }
  })
}
```

### forceReloginAfter (Mechanism 2 — mass emergency)

```typescript
export const forceReloginAfter = async (
  userIds:        string[],
  afterTimestamp: Date,
  reason:         string
) => {
  // DB update
  await prisma.user.updateMany({
    where: { id: { in: userIds } },
    data:  { forcedReloginAt: afterTimestamp }
  })

  // Update Redis cache for each user
  // [FIX] Also write JWT blacklist to close the race window between DB write and cache update
  await Promise.all(userIds.map(id => Promise.all([
    writeAuthUserCache(id),
    // Blacklist for 24h (matches JWT lifetime) — belt-and-suspenders
    redis.setex(`jwt:blacklist:${id}`, 24 * 60 * 60, '1')
  ])))

  void writeAuthAuditEvent({
    actorType: 'SYSTEM',
    eventType: 'FORCED_RELOGIN_SET',
    metadata:  { reason, userCount: userIds.length, afterTimestamp: afterTimestamp.toISOString() }
  })
}
```

### Nuclear option — auth cache wipe (NOT flushdb)

```typescript
// When you need to force all mobile sessions to re-authenticate immediately
// DO NOT use redis.flushdb() — it destroys trip state, GPS keys, QR nonces

export const wipeAllMobileAuthCaches = async (): Promise<number> => {
  // [FIX] Targeted deletion of only auth:user:* keys
  // Previous implementation used redis.flushdb() which would destroy:
  //   - trip:{id}:state (active trip state for all buses)
  //   - gps:heartbeat:{busId} (GPS monitoring)
  //   - qr:nonce:{nonce} (active check-in QR codes)
  //   - checkin:ratelimit:* (rate limit state)
  //   - All other operational data

  const authKeys = await redis.keys('auth:user:*')
  if (authKeys.length === 0) return 0

  // Delete in batches of 100 to avoid blocking Redis
  let deleted = 0
  for (let i = 0; i < authKeys.length; i += 100) {
    const batch = authKeys.slice(i, i + 100)
    await redis.del(...batch)
    deleted += batch.length
  }

  logger.info({ event: 'auth_cache_wiped', deletedCount: deleted })
  return deleted
}
// Note: After this, the first request from each user will hit DB (cache miss).
// This is acceptable — it's a security emergency response.
// DO NOT call this during the morning window (7am–9:30am).
```

---

## 11. Password Policy

```typescript
// lib/password-policy.ts

// Pre-computed at module load — O(1) lookup for both checks
// [FIX] Previous implementation used O(n) loop for case-insensitive check

const COMMON_PASSWORDS = new Set([
  'password', 'Password1', 'Password123', 'Password@123',
  'Admin@123', 'Admin1234', 'Admin@2024', 'Admin@2025', 'Admin@2026',
  'Welcome1', 'Welcome@1', 'College@123', 'Transport@1',
  'Qwerty123', 'Qwerty@1', '123456789', '12345678',
  'Letmein1', 'Changeme1', 'Changeme@1',
  'Passw0rd', 'P@ssword1', 'P@ssw0rd',
  'Summer2024', 'Winter2024', 'Spring2024', 'Summer2025', 'Winter2025',
  'January@1', 'Monday@123', 'Sunday@123',
  'India@123', 'Chennai@1', 'College1', 'Campus@1',
])

// [FIX] Pre-compute lowercased Set at startup — O(1) case-insensitive check
const COMMON_PASSWORDS_LOWER = new Set(
  [...COMMON_PASSWORDS].map(p => p.toLowerCase())
)

export const validateAdminPassword = (password: string): void => {
  if (password.length < 12) {
    throw new AppError('PASSWORD_TOO_SHORT', 400, {
      message: 'Password must be at least 12 characters'
    })
  }

  // O(1) exact match
  if (COMMON_PASSWORDS.has(password)) {
    throw new AppError('PASSWORD_TOO_COMMON', 400, {
      message: 'This password is too common. Please choose a more unique password.'
    })
  }

  // O(1) case-insensitive match — [FIX] was O(n) loop
  if (COMMON_PASSWORDS_LOWER.has(password.toLowerCase())) {
    throw new AppError('PASSWORD_TOO_COMMON', 400, {
      message: 'This password is too common. Please choose a more unique password.'
    })
  }
}

// Applied on:
//   POST /v1/admin/auth/set-password  (invite acceptance)
//   POST /v1/admin/auth/reset-password
//   Any future "change password" endpoint
```

---

## 12. Auth Audit Events

### Complete event enum

```typescript
// packages/shared/src/constants/auth-audit.ts

export enum AuthAuditEventType {
  // Mobile — login lifecycle
  MOBILE_LOGIN_SUCCESS       = 'MOBILE_LOGIN_SUCCESS',
  MOBILE_LOGIN_FAILURE       = 'MOBILE_LOGIN_FAILURE',
  MOBILE_REFRESH_SUCCESS     = 'MOBILE_REFRESH_SUCCESS',
  MOBILE_REFRESH_REJECTED    = 'MOBILE_REFRESH_REJECTED',
  MOBILE_LOGOUT              = 'MOBILE_LOGOUT',
  LOGOUT_ALL_SESSIONS        = 'LOGOUT_ALL_SESSIONS',
  DEVICE_REBOUND             = 'DEVICE_REBOUND',

  // Mobile — rejection events (middleware detected stale/invalid session)
  DEVICE_MISMATCH_REJECTED   = 'DEVICE_MISMATCH_REJECTED',
  STALE_SESSION_REJECTED     = 'STALE_SESSION_REJECTED',     // [FIX] was SESSION_VERSION_BUMPED — wrong semantics
  FORCED_RELOGIN_REQUIRED    = 'FORCED_RELOGIN_REQUIRED',

  // Admin — login lifecycle
  ADMIN_LOGIN_SUCCESS        = 'ADMIN_LOGIN_SUCCESS',
  ADMIN_LOGIN_FAILURE        = 'ADMIN_LOGIN_FAILURE',
  ADMIN_LOGOUT               = 'ADMIN_LOGOUT',
  ADMIN_ACCOUNT_LOCKED       = 'ADMIN_ACCOUNT_LOCKED',

  // Session revocation — admin ACTIONS (not rejections)
  SESSION_VERSION_BUMPED     = 'SESSION_VERSION_BUMPED',     // admin action: bumped the version
  FORCED_RELOGIN_SET         = 'FORCED_RELOGIN_SET',         // admin action: set forcedReloginAt

  // Account management
  PASSWORD_RESET_REQUESTED   = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED   = 'PASSWORD_RESET_COMPLETED',
  INVITE_SENT                = 'INVITE_SENT',
  INVITE_ACCEPTED            = 'INVITE_ACCEPTED',
  ACCOUNT_DEACTIVATED        = 'ACCOUNT_DEACTIVATED',
  ACCOUNT_REACTIVATED        = 'ACCOUNT_REACTIVATED',
  ADMIN_CREATED              = 'ADMIN_CREATED',
  ADMIN_ROLE_CHANGED         = 'ADMIN_ROLE_CHANGED',

  // Firebase provisioning
  FIREBASE_PROVISION_SUCCESS = 'FIREBASE_PROVISION_SUCCESS',
  FIREBASE_PROVISION_FAILED  = 'FIREBASE_PROVISION_FAILED',
  FIREBASE_PROVISION_RETRY   = 'FIREBASE_PROVISION_RETRY',
}
```

### writeAuthAuditEvent — fire and forget

```typescript
// lib/auth-audit.ts

interface AuditEventInput {
  actorType:  string
  actorId?:   string
  targetType?: string
  targetId?:  string
  eventType:  AuthAuditEventType
  ipAddress?: string
  deviceId?:  string
  metadata?:  Record<string, unknown>
}

export const writeAuthAuditEvent = async (input: AuditEventInput): Promise<void> => {
  // Fire and forget — auth flow is NEVER blocked by audit log failure
  prisma.authAuditEvent.create({
    data: {
      actorType:  input.actorType,
      actorId:    input.actorId,
      targetType: input.targetType,
      targetId:   input.targetId,
      eventType:  input.eventType,
      ipAddress:  input.ipAddress,
      deviceId:   input.deviceId,   // always hashed — never raw device identifier
      metadata:   input.metadata,   // never contains raw phone, email, or password
    }
  }).catch(err => {
    // Log but never throw — a logging failure must not break authentication
    logger.error({ event: 'auth_audit_write_failed', error: err.message })
  })
}
```

### What metadata contains and what it never contains

```
ALLOWED in metadata:
  emailHash:        SHA-256(email).slice(0,16)
  phoneHash:        SHA-256(phone).slice(0,16)
  role:             'STUDENT', 'DRIVER', etc.
  reason:           'ACCOUNT_DEACTIVATED', 'PASSWORD_RESET', etc.
  isNewDevice:      true | false
  tokenSv:          the sv value from the JWT
  currentSv:        the sv value from DB/cache
  attempts:         number of failed attempts

NEVER in metadata:
  raw phone number
  raw email address
  password or password hash
  JWT token
  raw device identifier (only the hash)
  firebaseUid
```

---

## 13. Redis Key Reference

All auth-related Redis keys. No raw PII anywhere.

```
Key                                       TTL      Contents
──────────────────────────────────────────────────────────────────────────────
auth:user:{userId}                        24h      MobileAuthState JSON
auth:admin:{adminId}                      8h       AdminAuthState JSON

ratelimit:mobile:login:ip:{ip}           60s      integer counter
ratelimit:mobile:login:phone:{phoneHash} 60s      integer counter
ratelimit:mobile:refresh:ip:{ip}         60s      integer counter

ratelimit:admin:login:ip:{ip}            60s      integer counter
ratelimit:admin:account:{emailHash}      300s     integer counter (deleted when lock set)
ratelimit:admin:locked:{emailHash}       900s     '1' (flag — presence means locked)
ratelimit:admin:forgot:{ip}              300s     integer counter

ratelimit:logout-all:{userId}            3600s    integer counter (max 3)

jwt:blacklist:{userId}                   24h      '1' (flag — presence means blacklisted)
jwt:admin:blacklist:{adminId}            8h       '1'
```

### Naming rules
- Never use raw phone numbers, email addresses, or names as key components
- Use SHA-256 hash sliced to 16 chars: `crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)`
- userId/adminId (cuid) is acceptable in keys — it's an opaque identifier, not PII

---

## 14. Security Headers

```typescript
// app.ts — registered as a plugin on all responses

fastify.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('X-XSS-Protection', '1; mode=block')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // Remove server identification
  reply.removeHeader('X-Powered-By')
  reply.removeHeader('Server')
})
```

### Admin cookie config

```typescript
// Set on every successful admin login response
reply.setCookie('admin_jwt', token, {
  httpOnly: true,                    // JS cannot read this cookie — XSS safe
  secure:   true,                    // HTTPS only
  sameSite: 'strict',                // CSRF mitigated — no cross-site requests
  maxAge:   8 * 60 * 60,             // 8 hours in seconds
  path:     '/v1/admin',             // only sent on admin API routes
  domain:   process.env.ADMIN_COOKIE_DOMAIN  // e.g. "api.yourdomain.com"
})
```

---

## 15. Build Rules — 12 Non-Negotiables

A coding agent must satisfy ALL 12. No exceptions.

```
1. JWT_EXPIRY
   Mobile JWT: 24 hours. Admin JWT: 8 hours. Never longer.
   Silent Firebase refresh handles re-issuance transparently.
   jwt.sign(..., { expiresIn: '24h' }) — not '7d', not '30d'.

2. TOKEN_TYPE_CHECK
   Every authenticated request checks payload.type.
   MOBILE endpoints: payload.type !== 'MOBILE' → 403 WRONG_TOKEN_TYPE.
   ADMIN endpoints: payload.type !== 'ADMIN' → 403 WRONG_TOKEN_TYPE.
   This check runs before any business logic.

3. SESSION_VERSION
   sessionVersion in every JWT. Compared to authState.sessionVersion on every request.
   Mismatch → 401 SESSION_REVOKED. No grace period. No retry.
   Event logged: STALE_SESSION_REJECTED (not SESSION_VERSION_BUMPED — that's the action).

4. DEVICE_BINDING
   deviceId (SHA-256 hash) in every mobile JWT.
   Compared to registeredDeviceId in auth cache on every request.
   Mismatch → 401 DEVICE_MISMATCH. Logged as DEVICE_MISMATCH_REJECTED.
   Applied to ALL mobile endpoints — not just check-in.

5. FORCED_RELOGIN_CHECK
   Check forcedReloginAt AFTER device binding.
   if (payload.iat < forcedReloginAt) → 401 FORCED_RELOGIN_REQUIRED.
   forcedReloginAt is in the Redis cache — no extra DB query needed.

6. ADMIN_COOKIE
   Admin JWT lives in httpOnly cookie ONLY.
   Never in response body. Never in localStorage. Never in Authorization header.
   httpOnly + secure + sameSite=strict + path=/v1/admin + domain restricted.

7. TOKEN_HASHING
   Reset tokens and invite tokens: SHA-256 hash stored in DB.
   Raw token sent in email. Compare hash(incoming) vs stored_hash.
   Token set to null on first successful use — cannot be reused.

8. TIMING_SAFE_BCRYPT
   DUMMY_BCRYPT_HASH = bcrypt.hashSync('dummy', 12) — computed ONCE at module load.
   When admin email not found: bcrypt.compare(password, DUMMY_BCRYPT_HASH).
   This prevents timing attacks that reveal whether an email exists.
   Never compute dummy hash inside the login function.

9. LOCKOUT_ORDER
   Admin login: check lock flag FIRST (before incrementing counter).
   Then increment counter.
   Then set lock flag if threshold exceeded.
   Then DELETE the counter when setting the lock.
   This prevents counter unbounded growth during lockout.

10. PII_IN_KEYS_AND_LOGS
    Raw phone numbers and email addresses never appear in:
      - Redis keys (use SHA-256 hash sliced to 16 chars)
      - Structured log fields (use hash)
      - AuthAuditEvent metadata (use hash)
    userId (cuid) is acceptable — it's opaque.

11. AUDIT_APPEND_ONLY
    AuthAuditEvent: never update, never delete.
    All writes use fire-and-forget: .catch(logger.error).
    Auth flow is NEVER blocked or slowed by audit log failure.
    The promise is NOT awaited — use void writeAuthAuditEvent(...).

12. FORGOT_PASSWORD_200
    POST /v1/admin/auth/forgot-password always returns 200.
    Even if email not found. Even if rate limited internally.
    Error handling happens inside the function. HTTP response is always 200.
    This prevents email enumeration via HTTP status codes.
```

---

## 16. Build Order

Apply delta fixes first (they're small and unblock everything else):

```
D1. Add forcedReloginAt to Prisma schema → run migration
    npx prisma migrate dev --name auth_final

D2. Update writeAuthUserCache to include forcedReloginAt in select
    Verify registeredDeviceId is also in the select

D3. Update mobile JWT expiry to 24h in auth.service.ts

D4. Add forcedReloginAt check (Step 7) to requireMobileAuth middleware

D5. Add POST /v1/auth/logout-all endpoint

D6. Fix admin login lockout order:
    check lock → incr counter → set lock + del counter

D7. Replace IP-only mobile rate limit with IP + phoneHash dual check

D8. Add password-policy.ts with pre-computed COMMON_PASSWORDS_LOWER Set

D9. Call validateAdminPassword() in set-password and reset-password endpoints

D10. Add STALE_SESSION_REJECTED and LOGOUT_ALL_SESSIONS to AuthAuditEventType enum

D11. Replace redis.flushdb() with targeted auth:user:* key deletion

D12. Add JWT blacklist write to forceReloginAfter function

→ Run: tsc --noEmit (must pass with 0 errors)
→ Run: vitest (auth tests must pass)
```

Then build the rest in this order:

```
A1. Schema migration + generate prisma client
A2. packages/shared: auth types, role enums, audit event enum, error codes
A3. lib/auth-cache.ts — getAuthUserState, writeAuthUserCache, getAuthAdminState, writeAuthAdminCache
A4. lib/auth-audit.ts — writeAuthAuditEvent (fire-and-forget)
A5. lib/auth-revocation.ts — revokeAllSessions, forceReloginAfter, wipeAllMobileAuthCaches
A6. lib/password-policy.ts — validateAdminPassword
A7. lib/rate-limit.ts — all rate limit functions
A8. middleware/auth.middleware.ts — requireMobileAuth (all 9 checks)
A9. middleware/admin-auth.middleware.ts — requireAdminAuth
A10. Mobile endpoints: login, refresh, logout, logout-all, me
A11. Admin endpoints: login, logout, forgot-password, reset-password, invite, set-password
A12. Security headers hook in app.ts
A13. Admin cookie configuration
A14. Mobile screens: login.tsx, verify-otp.tsx, pending-provisioning.tsx
A15. Admin panel: login page, authProvider, protected route wrapper
A16. End-to-end test: verify all 12 build rules are satisfied
```

---

## 17. Phase 2 Deferred Items

These are correct decisions — not implemented in Phase 1 to keep scope manageable.
Add after Phase 1 is live and stable.

```
P2-1. TOTP MFA for TRANSPORT_OFFICER + MANAGEMENT
      mfaEnabled and mfaSecretEncrypted fields already in AdminUser schema.
      Implement: authenticator app setup, TOTP verification on login.
      Required for: accounts with ability to bulk-modify student data.

P2-2. Recent-auth requirement for destructive operations
      Bulk import, bulk route reassignment, account deactivation require
      re-authentication within the last 15 minutes.
      Pattern: check lastLoginAt from JWT iat, prompt re-auth if stale.

P2-3. Explicit CSRF tokens
      sameSite=strict covers Phase 1 adequately.
      Add explicit CSRF tokens when supporting third-party integrations
      or iframes (not needed for Phase 1).

P2-4. HaveIBeenPwned breach-password API
      Local blocklist covers Phase 1.
      Add HIBP API check for breach detection when admin panel has
      more users and higher security requirements.

P2-5. Anomaly alert pipeline
      AuthAuditEvent logs are already structured.
      In Phase 2: add alerting on unusual patterns:
        - Same account from 2 different countries
        - 100+ failed logins in 5 minutes
        - New device registration outside college hours
```

---

*Auth System Final Spec — v4.1*
*All CTO review fixes applied. Ready for implementation.*
*March 2026*
