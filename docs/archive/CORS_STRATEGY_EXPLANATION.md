# CORS Strategy in College Bus Management System

## What is CORS?

**CORS** = **Cross-Origin Resource Sharing**

It's a security mechanism that controls which websites can access your API.

```
Without CORS:
Browser Origin A → API on Origin B
❌ BLOCKED by browser security policy

With CORS headers:
Browser checks: Does Origin B allow Origin A?
API says: "Yes, I allow localhost:5173"
✅ Request allowed
```

---

## Your CORS Configuration

### How It Works

Your backend implements **whitelist-based CORS**:

```typescript
// apps/backend/src/app.ts

app.register(cors, {
  credentials: true,  // ← Allow cookies to be sent
  allowedHeaders: [
    'Content-Type',
    'X-CSRF-Token',
    'Authorization',
    'Idempotency-Key',
    'X-Device-Id'
  ],
  exposedHeaders: [
    'X-Request-Id',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Idempotency-Replay'
  ],
  origin: (origin, callback) => {
    // Custom logic to check if origin is allowed
    if (!origin) {
      if (isProduction) {
        callback(new Error('Origin header is required in production'), false);
      } else {
        callback(null, true); // Allow curl/Postman in dev
      }
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);  // ✅ Allow
      return;
    }

    callback(new Error('Origin not allowed by CORS'), false);  // ❌ Block
  },
});
```

---

## Configuration Breakdown

### 1. credentials: true

```typescript
credentials: true
```

**What it does:**
- Tells browser it's OK to send cookies with cross-origin requests
- Allows `withCredentials: true` on frontend axios client

**Why it's important:**
```typescript
// Frontend code:
const axiosClient = axios.create({
  baseURL: 'http://localhost:3000',
  withCredentials: true  // ← Requires credentials: true on backend
});

// When true:
// - Browser sends: Cookie: admin_jwt=...
// - Backend receives cookies
// - Auth works!

// When false:
// - Browser blocks cookies on cross-origin
// - Backend doesn't receive auth token
// - All requests return 401
```

**Security Implication:**
```
When credentials: true, you MUST also:
✅ Specify explicit origins (not *)
✅ Verify Origin header
✅ Set sameSite on cookies
✅ Use HTTPS in production

If you set credentials: true + origin: '*':
❌ SECURITY HOLE! Any website can steal credentials
```

---

### 2. allowedHeaders

```typescript
allowedHeaders: [
  'Content-Type',        // Standard JSON requests
  'X-CSRF-Token',        // CSRF protection token
  'Authorization',       // Bearer tokens (if using)
  'Idempotency-Key',     // Idempotent request tracking
  'X-Device-Id'          // Mobile device identification
]
```

**What it does:**
- Whitelist of headers frontend is allowed to send
- Browser checks preflight request response

**CORS Preflight Flow:**

```
Frontend wants to POST with custom headers:
POST /v1/admin/auth/login
Headers: X-CSRF-Token: abc123

Browser checks: Can I send X-CSRF-Token header?

Browser sends PREFLIGHT request:
OPTIONS /v1/admin/auth/login
Access-Control-Request-Headers: X-CSRF-Token

Backend responds:
Access-Control-Allow-Headers: 
  Content-Type, X-CSRF-Token, Authorization, ...

Browser checks: X-CSRF-Token in response? Yes!
✅ Proceed with actual POST request

If X-CSRF-Token NOT in allowed:
❌ Preflight fails, actual request never sent
```

**Your Headers Explained:**

| Header | Purpose | Origin |
|--------|---------|--------|
| `Content-Type` | Standard CORS requirement | Browser auto-includes |
| `X-CSRF-Token` | CSRF protection | Your auth system |
| `Authorization` | Bearer token auth | OAuth/JWT alternative |
| `Idempotency-Key` | Prevent duplicate requests | Your retry logic |
| `X-Device-Id` | Identify mobile devices | Mobile app tracking |

---

### 3. exposedHeaders

```typescript
exposedHeaders: [
  'X-Request-Id',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Idempotency-Replay'
]
```

**What it does:**
- Frontend is allowed to read these response headers
- By default, frontend can only read: Content-Type, Content-Length, Cache-Control, Content-Language
- You must explicitly allow others

**Example:**

```typescript
// Backend sends response:
200 OK
Headers:
  X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
  X-RateLimit-Limit: 1000
  X-RateLimit-Remaining: 999
  X-RateLimit-Reset: 1775395200

// Frontend code:
const response = await fetch('/v1/users');
const requestId = response.headers.get('X-Request-Id');  // ← Works
const limit = response.headers.get('X-RateLimit-Limit'); // ← Works

// If X-RateLimit-Limit NOT in exposedHeaders:
const limit = response.headers.get('X-RateLimit-Limit'); // null
// ❌ Browser blocks access
```

**Your Exposed Headers:**

| Header | Use Case |
|--------|----------|
| `X-Request-Id` | Correlate frontend logs with backend logs |
| `X-RateLimit-Limit` | Show user rate limit quota |
| `X-RateLimit-Remaining` | Show requests remaining |
| `X-RateLimit-Reset` | Show when limit resets |
| `Idempotency-Replay` | Track duplicate request handling |

---

### 4. Origin Validation

```typescript
origin: (origin, callback) => {
  // Custom origin validation logic
  
  if (!origin) {
    if (isProduction) {
      callback(new Error('Origin header required'), false);  // ❌ Block
    } else {
      callback(null, true);  // ✅ Allow (dev/testing)
    }
    return;
  }

  if (allowedOrigins.includes(origin)) {
    callback(null, true);  // ✅ Allow
    return;
  }

  callback(new Error('Origin not allowed'), false);  // ❌ Block
}
```

**Flow:**

```
1. Browser sends request with Origin header:
   Origin: http://localhost:5173

2. Backend checks:
   a) Is Origin header present?
      - YES: Check whitelist
      - NO: In prod = reject, in dev = allow
   
   b) Is origin in allowedOrigins?
      - YES: Call callback(null, true) → ✅ Allow
      - NO: Call callback(error, false) → ❌ Block

3. Browser receives CORS headers
   Access-Control-Allow-Origin: http://localhost:5173
   
   Browser: "Origin matched! Request allowed"
   ✅ Frontend code executes
```

---

## Allowed Origins Configuration

### How Origins Are Resolved

```typescript
// apps/backend/src/lib/auth-config.ts

export const resolveAllowedOrigins = (): string[] => {
  // 1. Check environment variable (production)
  const configuredOrigins = splitEnvList(env.CORS_ALLOWED_ORIGINS);
  
  if (configuredOrigins.length > 0) {
    return configuredOrigins;  // Use configured origins
  }

  // 2. Development defaults
  if (env.NODE_ENV !== 'production') {
    return [
      'http://localhost:5173',   // Vite dev default
      'http://localhost:5174',   // Port conflict fallback
      'http://localhost:5175',   // Another fallback
      'http://127.0.0.1:5173',   // localhost alias
      'http://127.0.0.1:5174',   // localhost alias
      'http://127.0.0.1:5175',   // localhost alias
      'http://localhost:3000',   // Backend itself (testing)
      'http://127.0.0.1:3000',   // Backend alias
      'http://localhost:8081',   // Mobile app dev
      'http://127.0.0.1:8081',   // Mobile app alias
    ];
  }

  // 3. Production has no defaults
  return [];
};
```

**Configuration Strategy:**

| Environment | Source | Origins |
|-------------|--------|---------|
| **Development** | Hardcoded defaults | localhost:5173, 5174, 5175, etc. |
| **Production** | Environment variable | Must be explicitly configured |

**Why?**
```
Development:
- Need flexibility for testing
- Multiple ports (Vite uses 5173, but might try 5174)
- Local dev across different machines
- Mobile testing on localhost:8081

Production:
- No defaults = safer
- Force explicit configuration
- Prevents accidental CORS leaks
- Environment-variable based = easy to update
```

---

## Environment Variable Configuration

### Production Setup

```bash
# .env (production)
CORS_ALLOWED_ORIGINS=https://admin.yourdomain.com,https://api.yourdomain.com

# App will split and trim:
[
  'https://admin.yourdomain.com',
  'https://api.yourdomain.com'
]
```

### Validation at Startup

```typescript
// apps/backend/src/app.ts

if (isProduction && allowedOrigins.length === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS must be configured in production');
}
```

**What this does:**
```
Production startup check:
1. Is NODE_ENV === 'production'? YES
2. Is allowedOrigins.length === 0? 
   - If YES: Throw error ❌ App won't start
   - If NO: Continue normally ✅

Purpose:
- Prevent accidental production deployment with no CORS
- Force explicit configuration
- Fail-fast security approach
```

---

## Security Features

### Headers Added for Security

Your backend also adds strict security headers:

```typescript
// apps/backend/src/app.ts

app.addHook('onSend', async (req, reply) => {
  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff');
  
  // Prevent clickjacking
  reply.header('X-Frame-Options', 'DENY');
  
  // Prevent XSS
  reply.header('X-XSS-Protection', '1; mode=block');
  
  // Control referrer information
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Control browser features
  reply.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  
  // HTTPS enforcement (production only)
  if (isProduction) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  // Remove identification
  reply.removeHeader('X-Powered-By');
  reply.removeHeader('Server');
});
```

**What These Do:**

| Header | Prevents | Example Attack |
|--------|----------|-----------------|
| `X-Content-Type-Options: nosniff` | MIME type confusion | Script uploaded as image executed |
| `X-Frame-Options: DENY` | Clickjacking | Iframe overlay attack |
| `X-XSS-Protection` | Reflected XSS | Script in URL parameter |
| `Referrer-Policy` | Referrer leakage | Password in referrer header |
| `Permissions-Policy` | Feature abuse | Camera/mic access without permission |
| `Strict-Transport-Security` | MITM attacks | HTTP downgrade attacks |

---

## Your System's CORS Flow Diagram

### Development (localhost)

```
┌──────────────────────┐
│  Frontend            │
│  localhost:5173      │
└──────────────────────┘
         │
         │ GET /v1/users
         │ Origin: http://localhost:5173
         ↓
┌──────────────────────┐
│  Backend CORS Check  │
│  localhost:3000      │
│                      │
│  Is origin allowed?  │
│  In allowedOrigins?  │
│  ✅ YES (hardcoded)  │
└──────────────────────┘
         │
         │ Access-Control-Allow-Origin: 
         │ http://localhost:5173
         ↓
┌──────────────────────┐
│  Browser             │
│  Check: Origin OK?   │
│  ✅ YES              │
│  Send credentials    │
│  Proceed with req    │
└──────────────────────┘
```

### Production (yourdomain.com)

```
┌──────────────────────────────┐
│  Frontend                    │
│  https://admin.yourdomain.com│
└──────────────────────────────┘
         │
         │ GET /v1/users
         │ Origin: https://admin.yourdomain.com
         ↓
┌──────────────────────────────┐
│  Backend CORS Check          │
│  https://api.yourdomain.com  │
│                              │
│  CORS_ALLOWED_ORIGINS=       │
│  https://admin.yourdomain.com│
│                              │
│  Is origin allowed?          │
│  In env config? ✅ YES       │
└──────────────────────────────┘
         │
         │ Access-Control-Allow-Origin: 
         │ https://admin.yourdomain.com
         │ Strict-Transport-Security: ...
         ↓
┌──────────────────────────────┐
│  Browser                     │
│  Check: Origin OK? ✅ YES    │
│  Check: HTTPS? ✅ YES        │
│  Send credentials            │
│  Store HSTS for 1 year       │
│  Proceed with request        │
└──────────────────────────────┘
```

---

## Complete CORS Request/Response Cycle

### Simple Request (GET)

```
Frontend:
  GET http://localhost:3000/v1/users
  Origin: http://localhost:5173

Backend receives:
  req.origin = 'http://localhost:5173'
  Checks: allowedOrigins.includes('http://localhost:5173')
  Result: true ✅

Backend responds:
  HTTP 200 OK
  Access-Control-Allow-Origin: http://localhost:5173
  Access-Control-Allow-Credentials: true
  Access-Control-Expose-Headers: X-Request-Id, ...
  
  Body: { data: [...] }

Browser:
  Origin matches ✅
  Credentials allowed ✅
  Exposed headers listed ✅
  Release response to frontend code ✅
```

### Preflight Request (POST with custom headers)

```
Frontend wants to:
  POST /v1/admin/auth/login
  X-CSRF-Token: abc123
  Content-Type: application/json

Step 1: Browser sends OPTIONS preflight
  OPTIONS /v1/admin/auth/login
  Origin: http://localhost:5173
  Access-Control-Request-Headers: X-CSRF-Token
  Access-Control-Request-Method: POST

Step 2: Backend CORS plugin validates
  origin = 'http://localhost:5173'
  In allowedOrigins? ✅ YES
  X-CSRF-Token in allowedHeaders? ✅ YES
  Method POST allowed? ✅ YES (not restricted)

Step 3: Backend responds to preflight
  HTTP 204 No Content
  Access-Control-Allow-Origin: http://localhost:5173
  Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
  Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, ...
  Access-Control-Allow-Credentials: true
  Access-Control-Max-Age: 86400

Step 4: Browser validates preflight response
  Origin matches ✅
  Custom headers allowed ✅
  Method allowed ✅
  Credentials allowed ✅

Step 5: Browser sends actual POST request
  POST /v1/admin/auth/login
  Origin: http://localhost:5173
  X-CSRF-Token: abc123
  Content-Type: application/json
  Cookie: admin_jwt=...
  
  Body: { email: "...", password: "..." }

Step 6: Backend processes request
  No CORS checks needed (already verified)
  Authenticate using JWT + CSRF token
  Process login
  
Step 7: Backend responds
  HTTP 200 OK
  (Response includes Set-Cookie headers)
  (CORS headers automatically added)

Step 8: Browser processes response
  CORS headers match preflight? ✅ YES
  Accept response ✅
  Store cookies ✅
  Release response to frontend code ✅
```

---

## Common CORS Errors & Solutions

### Error 1: No Access-Control-Allow-Origin Header

```
Browser Error:
Access to XMLHttpRequest at 'http://localhost:3000/v1/users' 
from origin 'http://localhost:5173' has been blocked by CORS policy: 
No 'Access-Control-Allow-Origin' header is present on the requested resource.

Cause:
- Origin not in allowedOrigins
- OR credentials: true not set in CORS config

Solution:
1. Check env.CORS_ALLOWED_ORIGINS
2. Add your origin to list
3. Restart backend
4. Test again
```

### Error 2: Credentials Mode is not Implemented

```
Browser Error:
Access to XMLHttpRequest at 'http://localhost:3000/v1/users' 
from origin 'http://localhost:5173' has been blocked by CORS policy: 
When responding to a preflight request the value of the 
'Access-Control-Allow-Credentials' header must be 'true' when the request's 
credentials mode is 'include'.

Cause:
- Frontend: withCredentials: true
- Backend: credentials: false

Solution:
- Set credentials: true in backend CORS config (already done)
```

### Error 3: Request Header Not Allowed

```
Browser Error:
Access to XMLHttpRequest at 'http://localhost:3000/v1/users' 
from origin 'http://localhost:5173' has been blocked by CORS policy: 
Request header X-Custom-Header is not allowed by Access-Control-Allow-Headers 
in preflight response.

Cause:
- Custom header not in allowedHeaders config

Solution:
1. Add header to allowedHeaders array in app.ts
2. Restart backend
3. Retry request
```

---

## Best Practices in Your CORS Setup

### ✅ What Your System Does Right

1. **Whitelist Approach (Not Blacklist)**
   ```typescript
   // ✅ GOOD: Whitelist (explicit allow)
   if (allowedOrigins.includes(origin)) {
     callback(null, true);
   }
   
   // ❌ BAD: Blacklist (explicit deny)
   if (!deniedOrigins.includes(origin)) {
     callback(null, true);
   }
   ```

2. **Environment-Specific Configuration**
   ```typescript
   // ✅ GOOD: Dev defaults, prod explicit
   if (NODE_ENV !== 'production') {
     return [hardcoded defaults];
   } else {
     return env.CORS_ALLOWED_ORIGINS;
   }
   ```

3. **Fail-Safe in Production**
   ```typescript
   // ✅ GOOD: Require explicit config
   if (isProduction && allowedOrigins.length === 0) {
     throw new Error('CORS_ALLOWED_ORIGINS must be configured');
   }
   ```

4. **Credentials with Whitelist**
   ```typescript
   // ✅ GOOD: Credentials + whitelist together
   credentials: true,
   origin: (origin, callback) => {
     if (allowedOrigins.includes(origin)) {
       callback(null, true);
     }
   }
   ```

5. **Security Headers**
   ```typescript
   // ✅ GOOD: Multiple security layers
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   Strict-Transport-Security: max-age=31536000
   ```

---

## Summary Table

| Aspect | Your Implementation | Why It Matters |
|--------|-------------------|-------------------|
| **Strategy** | Whitelist | Explicit-allow is safer than explicit-deny |
| **Development** | Hardcoded defaults on localhost | Easy testing without env vars |
| **Production** | Environment variable required | Forces explicit config, prevents leaks |
| **Credentials** | Allowed with whitelist | Auth works across origins safely |
| **Custom Headers** | Whitelist in config | Prevents abuse of non-standard headers |
| **Response Headers** | Expose whitelist | Only needed headers readable by frontend |
| **Security Headers** | Comprehensive suite | Defense-in-depth approach |

---

## Deployment Checklist

### Before Going to Production

```
✅ CORS Checklist:

[ ] Set NODE_ENV=production in deployment
[ ] Set CORS_ALLOWED_ORIGINS env var to:
    - Your admin domain
    - Your API domain
    - Any other authorized origins
    
[ ] Test CORS with actual domains:
    curl -H "Origin: https://admin.yourdomain.com" \
         -H "Access-Control-Request-Method: POST" \
         -H "Access-Control-Request-Headers: Content-Type" \
         -X OPTIONS https://api.yourdomain.com/v1/admin/auth/login
         
    Response should include:
    ✅ Access-Control-Allow-Origin: https://admin.yourdomain.com
    ✅ Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
    ✅ Access-Control-Allow-Credentials: true

[ ] Verify HTTPS on both domains

[ ] Check security headers in response

[ ] Test authentication flow end-to-end

[ ] Monitor logs for CORS rejections

[ ] Document allowed origins for future ref
```

---

## Conclusion

Your CORS implementation follows **production-grade security practices**:

- ✅ **Whitelist-based** (explicit-allow)
- ✅ **Environment-aware** (strict in prod, flexible in dev)
- ✅ **Credentials-enabled** (with proper safeguards)
- ✅ **Well-configured** (headers, expose, allow lists)
- ✅ **Defense-in-depth** (multiple security headers)
- ✅ **Fail-safe** (requires explicit config in prod)

This approach protects against:
- ❌ CORS attacks
- ❌ CSRF attacks
- ❌ Clickjacking
- ❌ XSS attacks
- ❌ MITM attacks
- ❌ Accidental misconfiguration
