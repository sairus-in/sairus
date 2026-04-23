# Deep Dive: Authentication, JWT, Cookies & Routing Issues

## Overview

Your admin panel experienced routing and authentication issues caused by improper cookie configuration. This document explains the complete system, the bug, and the fix.

---

## Part 1: How Authentication Works in Your System

Your system uses **JWT (JSON Web Tokens) + Cookies** for authentication.

### User Login Flow Diagram

```
USER LOGIN FLOW:
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. User enters credentials (admin@college.edu, password)  │
│                                                             │
│  2. Frontend (React) sends POST to backend                  │
│     POST /v1/admin/auth/login                              │
│     Body: { email, password }                              │
│                                                             │
│  3. Backend validates credentials                          │
│     - Checks email in database                             │
│     - Hashes password & compares                           │
│     - Creates JWT token (signed with secret key)           │
│                                                             │
│  4. Backend SENDS COOKIES in response via Set-Cookie       │
│     Response Headers:                                       │
│     Set-Cookie: admin_jwt=<TOKEN>; ...options              │
│     Set-Cookie: admin_csrf=<TOKEN>; ...options             │
│                                                             │
│  5. Browser auto-stores these cookies                       │
│     (ONLY if CORS & sameSite allow it!)                     │
│                                                             │
│  6. Subsequent API calls AUTO-SEND cookies                  │
│     GET /v1/users                                          │
│     Cookies: admin_jwt=..., admin_csrf=...                 │
│                                                             │
│  7. Backend extracts JWT from cookie                        │
│     - Verifies JWT signature                               │
│     - Gets user ID from token                              │
│     - User is authenticated!                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### JWT Token Structure

A JWT token consists of 3 parts separated by dots:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

Part 1: Header
  {
    "alg": "HS256",      // Algorithm used
    "typ": "JWT"         // Type of token
  }

Part 2: Payload (Claims)
  {
    "sub": "admin-123",              // Subject (user ID)
    "iss": "college-bus-system",     // Issuer
    "aud": "admin-panel",            // Audience
    "exp": 1775395200,               // Expiration time
    "iat": 1775391600,               // Issued at
    "role": "TRANSPORT_OFFICER"      // Custom claims
  }

Part 3: Signature
  HMACSHA256(
    base64UrlEncode(header) + "." + base64UrlEncode(payload),
    secret_key  // Only backend knows this!
  )
```

### Why Cookies are Used

```typescript
// The flow in code:
// 1. Backend creates JWT
const jwtToken = issueAdminJwt(admin);
// Result: "eyJh..."

// 2. Backend puts it in a cookie
reply.setCookie('admin_jwt', jwtToken, {
  httpOnly: true,      // Can't be accessed by JavaScript
  sameSite: 'strict',  // Security control
  secure: true,        // HTTPS only
});

// 3. Browser stores it automatically
// Stored in: Cookie storage (not localStorage!)

// 4. Browser sends it automatically on every request
GET /v1/users
Headers: Cookie: admin_jwt=eyJh...

// 5. Backend extracts it
const jwt = req.cookies.admin_jwt;
const payload = verifyAndDecode(jwt);
const userId = payload.sub;
```

---

## Part 2: The SameSite Cookie Problem (THE BUG)

### What Was Wrong

Your backend had this configuration:

```typescript
// ❌ BEFORE (broken)
const adminJwtCookieOptions = {
  httpOnly: true,
  secure: false,         // Dev mode
  sameSite: 'strict',    // ← THIS WAS THE PROBLEM!
  path: '/v1/admin',     // ← ALSO A PROBLEM
  domain: undefined,
};
```

### What sameSite Does

```
sameSite Policy:

sameSite: 'strict'
  - Only send cookie if request is SAME-SITE
  - Never send for cross-origin requests
  - EVEN localhost:5173 → localhost:3000 is blocked!

sameSite: 'lax'
  - Send for same-site requests
  - Allow safe cross-origin requests (GET, navigation)
  - Block dangerous ones (POST, PUT, DELETE)

sameSite: 'none'
  - Send for ALL requests, even cross-origin
  - MUST have secure: true
  - Use for cross-domain authentication
```

### The Origin Problem

```
Your Setup:
┌────────────────────────────────────────────────────────────┐
│  Frontend: http://localhost:5173  (React Admin Panel)      │
│  Backend:  http://localhost:3000  (API Server)             │
└────────────────────────────────────────────────────────────┘
          ↑                              ↑
        Different port = Different origin in browser security model!

Browser Security Rules:
  Origin = protocol + domain + port
  
  localhost:5173  // ← Frontend origin
  localhost:3000  // ← Backend origin
  
  Are they the same? NO! Different ports!
  
Browser sees: CROSS-ORIGIN REQUEST (even though same machine!)
```

### Why It Failed

```
Step-by-step breakdown:

1. User logs in successfully
   POST http://localhost:3000/v1/admin/auth/login
   Response headers:
     Set-Cookie: admin_jwt=...; sameSite=strict; path=/v1/admin
   
   ✅ Cookie stored (same-origin)

2. User clicks "Students" link
   Frontend navigates to /students
   Component mounts, needs data
   
3. Component calls API
   GET http://localhost:3000/v1/users
   
   But request originates from: localhost:5173
   Browser checks: Is 5173 the same as 3000?
   Answer: NO! Different port!
   
   With sameSite=strict:
   Browser: "This is cross-origin, block the cookie ❌"
   
4. Request sent WITHOUT cookie
   GET http://localhost:3000/v1/users
   Cookie: (empty - browser blocked it!)
   
5. Backend receives request
   Looks for: request.cookies.admin_jwt
   Finds: undefined
   
   "No JWT token? User not authenticated!"
   Returns: 401 Unauthorized
   
6. Frontend sees 401
   Axios interceptor catches it
   Clears auth state
   Redirects to login
   
RESULT: Page loads, then instantly redirects ❌
```

### Visual Representation

```
BEFORE FIX (Breaking):
┌───────────────────┐                ┌───────────────────┐
│ Frontend 5173     │                │ Backend 3000       │
│                   │                │                    │
│ Click Students    │────GET────────>│ /v1/users          │
│                   │    request      │                    │
│                   │<──401 error────│ (no cookie!)       │
│                   │                │                    │
│ Clear auth        │                │ Returns:           │
│ Redirect to login │                │ 401 Unauthorized   │
└───────────────────┘                └───────────────────┘
         ↓
    Auto-redirect 
    to /ops/dashboard
    
AFTER FIX (Working):
┌───────────────────┐                ┌───────────────────┐
│ Frontend 5173     │                │ Backend 3000       │
│                   │                │                    │
│ Click Students    │────GET────────>│ /v1/users          │
│                   │    request +    │                    │
│                   │    admin_jwt    │                    │
│                   │<──200 SUCCESS──│                    │
│                   │    + data      │                    │
│                   │                │ Returns:           │
│ Display Students  │                │ [students list]    │
│ in /students page │                │                    │
└───────────────────┘                └───────────────────┘
    ✅ No redirect!
```

---

## Part 3: The JWT Validation Flow

### Happy Path (After Fix)

```
✅ SUCCESSFUL REQUEST:

1. Browser has stored cookie from login
   Cookie storage:
   {
     admin_jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     admin_csrf: "a3f8c2d9e1b4..."
   }

2. Frontend calls API
   GET http://localhost:3000/v1/users
   
3. Browser auto-adds cookie (sameSite=lax allows it)
   GET http://localhost:3000/v1/users
   Cookie: admin_jwt=eyJh...; admin_csrf=a3f8...
   
4. Backend receives request with cookie
   
5. Backend extracts JWT
   const jwtToken = req.cookies.admin_jwt;
   // Result: "eyJh..."
   
6. Backend verifies JWT signature
   const payload = verify(jwtToken, secretKey);
   
   Checks:
   ✅ Signature valid? (was it signed with our secret?)
   ✅ Not expired? (token.exp > now?)
   ✅ Correct issuer? (token.iss == 'college-bus-system'?)
   ✅ Correct audience? (token.aud == 'admin-panel'?)
   
7. Extract user ID from token
   const userId = payload.sub;  // "admin-123"
   
8. Load user from database
   const user = await db.admins.findById(userId);
   
9. Check permissions/capabilities
   const capabilities = getCapabilities(user.role);
   
10. ✅ Grant access
    return { students: [...] };
```

### Broken Path (Before Fix)

```
❌ FAILED REQUEST:

1. User is "logged in" (frontend state = true)
   But cookie was blocked by sameSite: strict
   Browser didn't store it!

2. Frontend calls API
   GET http://localhost:3000/v1/users
   
3. Browser tries to add cookie
   But it has no cookie to add!
   (It was blocked earlier by sameSite: strict)
   
   GET http://localhost:3000/v1/users
   Cookie: (empty!)
   
4. Backend receives request WITHOUT cookie
   
5. Backend looks for JWT
   const jwtToken = req.cookies.admin_jwt;
   // Result: undefined
   
6. No JWT to verify
   throw new Error('No authentication token');
   
7. Return 401 Unauthorized
   response.status = 401;
   response.body = { error: "UNAUTHORIZED" };
   
8. Frontend receives 401
   // From api.client.ts interceptor:
   if (error.response?.status === 401) {
     clearAdminSessionState();  // Logs you out!
     // state.isAuthenticated = false
   }
   
9. React components see isAuthenticated = false
   // From App.tsx:
   if (!isAuthenticated) {
     return <Navigate to="/login" replace />;
   }
   
10. ❌ User redirected to login
    Even though they just logged in!
```

---

## Part 4: Why You Saw Routing Issues

The routing wasn't actually broken - it was **auth state changing unexpectedly**.

### The Chain Reaction

```
TIMELINE OF EVENTS:

[T1] You log in successfully
     ✅ Login API succeeds
     ✅ Backend sends Set-Cookie header
     ❌ Browser blocks cookie (sameSite: strict)
     ✅ Frontend receives user data
     ✅ React state: isAuthenticated = true
     ✅ You see: "Login successful, navigating to dashboard"

[T2] You manually click "Students" link
     ✅ React Router redirects to /students
     ✅ StudentList component mounts
     ✅ useEffect hook fires
     ✅ Calls: GET /v1/users?role=STUDENT
     
[T3] Request sent to backend
     ❌ No cookie included! (sameSite blocked it)
     GET /v1/users
     Headers: (empty cookie!)
     
[T4] Backend processes request
     ❌ Looks for JWT in cookie
     ❌ Doesn't find it
     ❌ Returns: 401 Unauthorized
     
[T5] Frontend receives 401 error
     // api.client.ts interceptor:
     axiosClient.interceptors.response.use(
       (response) => response.data,
       (error) => {
         if (error.response?.status === 401) {
           clearAdminSessionState();  // ← CLEARS AUTH!
         }
       }
     );
     
     Action: clearAdminSessionState()
     - Closes websocket
     - Clears React Query cache
     - Calls: authStore.logout()
     
[T6] Auth state changes
     authStore state:
     {
       user: null,
       isAuthenticated: false,  // ← CHANGED!
       capabilities: null
     }
     
[T7] React re-renders
     App.tsx checks: if (!isAuthenticated)
     Component: <RequireAdminSession>
     Condition: isAuthenticated = false
     Action: <Navigate to="/login" replace />
     
[T8] Navigation happens
     URL changes: /students → /login
     But wait! You're already logged in elsewhere
     Auth middleware redirects unauthenticated to default
     
[T9] Default route is set to /ops/dashboard
     (Because data console auth failed)
     
[T10] ❌ You end up on /ops/dashboard
      **DURATION: ~1-2 seconds from clicking Students**
      
      This appears as: "Click Students, page loads briefly, then redirects"
```

### Code That Causes The Redirect

```typescript
// apps/admin/src/App.tsx
const RequireAdminSession = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;  // ← This fires!
  }

  return <>{children}</>;
};

// Then this happens:
<Route element={
  <RequireAdminSession>  {/* isAuthenticated changes from true → false */}
    <AdminDataShell />
  </RequireAdminSession>
}>
  <Route path="/students" element={...} />
  {/* ... */}
</Route>

// When isAuthenticated becomes false:
// 1. RequireAdminSession renders: <Navigate to="/login" />
// 2. User gets redirected to /login
// 3. From /login, default route captures them
// 4. Ends up back at /ops/dashboard
```

---

## Part 5: Why Data Console Routing Specifically Broke

The **Data Console routes require authentication**, while **Live Ops has fallback behavior**.

### Route Structure

```typescript
// App.tsx routing hierarchy

<Routes>
  <Route path="/login" element={<Login />} />  // ← Public, no auth needed
  
  {/* Live Ops Section */}
  <Route element={<RequireAdminSession>}>
    <Route path="/ops/dashboard" element={...} />
    <Route path="/ops/fleet" element={...} />
    {/* ... */}
    <Route path="/ops/*" element={<Navigate to="/ops/dashboard" />} />
  </Route>
  
  {/* Data Console Section - PROTECTED */}
  <Route element={<RequireAdminSession>}>  {/* ← Auth check here */}
    <Route path="/" element={<Navigate to={default} />} />
    <Route path="/students" element={
      <RequireCapability capability="canManageStudents">
        <StudentList />
      </RequireCapability>
    } />
    <Route path="/routes" element={...} />
    {/* ... */}
    <Route path="*" element={<Navigate to={default} />} />
  </Route>
  
  {/* Global fallback */}
  <Route path="*" element={
    <Navigate to={isAuth ? default : '/login'} />
  } />
</Routes>
```

### Why Data Console Failed Specifically

```
Data Console Routes are NESTED inside:
  <RequireAdminSession>
    <AdminDataShell>
      {routes here}
    </AdminDataShell>
  </RequireAdminSession>

When auth fails:
1. Component re-renders
2. RequireAdminSession checks: isAuthenticated?
3. isAuthenticated = false (due to 401)
4. Renders: <Navigate to="/login" />
5. You get redirected immediately

The "requires auth" check happens at COMPONENT level, not route level.
So ANY auth change → immediate redirect.
```

---

## Part 6: The Fix - Cookie Options Explained

### What Was Changed

```typescript
// BEFORE (Broken)
const adminJwtCookieOptions = {
  httpOnly: true,
  secure: false,         // Dev mode
  sameSite: 'strict',    // ❌ Blocks cross-origin
  path: '/v1/admin',     // ❌ Too restrictive
  domain: undefined,
};

// AFTER (Fixed)
const adminJwtCookieOptions = {
  httpOnly: true,
  secure: isProduction,  // true in prod, false in dev
  sameSite: isProduction ? 'strict' : 'lax',  // ✅ 'lax' in dev
  path: '/',  // ✅ Allows all paths
  domain: adminSecurityConfig.cookieDomain,
};
```

### What Each Option Does

| Option | Value | Purpose | Impact |
|--------|-------|---------|--------|
| `httpOnly` | `true` | Only accessible via HTTP, not JavaScript | Prevents XSS attacks from stealing token |
| `secure` | `isProduction` | Only send over HTTPS | Prevents network sniffen from stealing cookie |
| `sameSite` | `'lax'` (dev) / `'strict'` (prod) | Control when cookie is sent | Dev: allow localhost testing; Prod: CSRF protection |
| `path` | `/` | Send with requests to any path | Was `/v1/admin`, too restrictive |
| `maxAge` | `8 hours` | Cookie expiration | User must re-login after 8 hours |
| `domain` | `undefined` (dev) / `domain.com` (prod) | Send only to this domain | localhost in dev, your domain in prod |

### sameSite Values Detailed

```
sameSite: 'strict'
  ✅ Most secure
  ❌ Doesn't work for localhost development
  Use case: Production, same-domain only
  
  Sends cookie ONLY if:
  - Request from exact same origin
  - secure=true AND https

sameSite: 'lax'
  ✅ Allows safe cross-origin (GET, navigation)
  ✅ Blocks dangerous cross-origin (POST)
  ✅ Works for localhost development
  Use case: Development, testing
  
  Sends cookie if:
  - Same origin (always)
  - Cross-origin GET/navigation (safe)
  - Blocks cross-origin POST/PUT/DELETE (dangerous)

sameSite: 'none'
  ✅ Works for cross-domain
  ❌ Requires secure=true
  ❌ Less secure
  Use case: Cross-domain Single Sign-On
  
  Send cookie always, MUST have:
  - secure: true
  - https: required
```

### Path Restriction Fix

```
BEFORE: path: '/v1/admin'
  Cookie sent ONLY to requests like:
  ✅ GET /v1/admin/auth/me
  ✅ GET /v1/admin/messages
  ❌ GET /v1/users         (different path!)
  ❌ GET /v1/routes        (different path!)
  
  Result: Other API endpoints return 401!

AFTER: path: '/'
  Cookie sent to requests like:
  ✅ GET /v1/admin/auth/me
  ✅ GET /v1/users         (now works!)
  ✅ GET /v1/routes        (now works!)
  ✅ GET /v1/fleet/buses   (now works!)
  
  Result: All authenticated endpoints work!
```

---

## Part 7: Development vs Production Security

### Development Configuration

```typescript
// apps/backend/src/lib/admin-session.ts
const adminJwtCookieOptions = {
  sameSite: isProduction ? 'strict' : 'lax',
  secure: isProduction,
};

// In development (NODE_ENV !== 'production')
{
  sameSite: 'lax',    // Allow localhost 5173 → 3000
  secure: false,      // Allow HTTP (no SSL cert)
}

// Why?
// - Developers need to test across ports
// - No SSL certificates on localhost
// - Speed of development matters more
```

### Production Configuration

```typescript
// In production (NODE_ENV === 'production')
{
  sameSite: 'strict',      // Only same-domain
  secure: true,            // HTTPS required
  domain: 'yourdomain.com' // Specific domain only
}

// Why?
// - Protects against CSRF attacks
// - HTTPS encrypts in transit
// - Prevents cookie theft over network
// - Domain restriction prevents subdomain attacks
```

### Security Progression

```
INSECURE (Never use in production!)
  sameSite: 'none'
  secure: false
  ↓ Anyone can intercept & steal token

SEMI-SECURE (Development only)
  sameSite: 'lax'
  secure: false
  ↓ Fine for localhost testing

VERY SECURE (Production standard)
  sameSite: 'strict'
  secure: true
  domain: 'yourdomain.com'
  ↓ Strong CSRF protection
  ↓ Encrypted in transit
  ↓ Domain-scoped
```

---

## Part 8: The Complete Auth Flow (After Fix)

### Full Request-Response Cycle

```
✅ FIXED AUTHENTICATION FLOW:

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│ STEP 1: USER LOGS IN                                                   │
│                                                                         │
│ Frontend: POST /v1/admin/auth/login                                    │
│ Body: { email: "admin@college.edu", password: "..." }                 │
│                                                                         │
│ Backend processes:                                                      │
│   1. Hash attempt password                                              │
│   2. Compare to database hash                                           │
│   3. Matches? Yes ✅                                                    │
│   4. Create JWT token                                                   │
│   5. Send Set-Cookie headers in response                                │
│                                                                         │
│ Response Headers:                                                       │
│   Set-Cookie: admin_jwt=eyJh...; sameSite=lax; path=/                  │
│   Set-Cookie: admin_csrf=a3f8...; sameSite=lax; path=/                 │
│   Set-Cookie: content remains same                                      │
│                                                                         │
│ Browser:                                                                │
│   1. Sees Set-Cookie headers                                            │
│   2. Checks: sameSite=lax and secure=false and same port?               │
│   3. All valid! ✅                                                      │
│   4. Stores cookies in browser's cookie storage                         │
│                                                                         │
│   Cookie Storage Now Contains:                                          │
│   {                                                                      │
│     admin_jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",             │
│     admin_csrf: "a3f8c2d9e1b4c6f9a2e5d8c1b4f7..."                    │
│   }                                                                      │
│                                                                         │
│ Frontend:                                                               │
│   localStorage.setItem('auth-store', {...})  // Store user data        │
│   state.isAuthenticated = true                 // Update state          │
│   Navigate to /ops/dashboard                   // Show dashboard        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│ STEP 2: USER CLICKS "STUDENTS" LINK                                    │
│                                                                         │
│ Frontend:                                                               │
│   React Router navigates to /students                                   │
│   StudentList component mounts                                          │
│   useEffect hook fires                                                  │
│   Calls: api.get('/v1/users?role=STUDENT')                             │
│                                                                         │
│   This translates to axios request:                                     │
│   GET http://localhost:3000/v1/users?role=STUDENT                      │
│                                                                         │
│ Browser:                                                                │
│   Intercepts outgoing request                                           │
│   Checks: Is this same-origin? (5173 → 3000?)                          │
│   No, different port! But sameSite=lax allows it ✅                     │
│   Browser adds cookies from storage:                                    │
│                                                                         │
│   Final Request:                                                        │
│   GET http://localhost:3000/v1/users?role=STUDENT                      │
│   Cookie: admin_jwt=eyJh...; admin_csrf=a3f8...                        │
│   Origin: http://localhost:5173                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│ STEP 3: BACKEND RECEIVES REQUEST                                       │
│                                                                         │
│ Express/Fastify middleware processes:                                   │
│                                                                         │
│ 1. CORS Middleware                                                      │
│    Checks: Origin = http://localhost:5173                              │
│    Is it in CORS_ALLOWED_ORIGINS? Yes ✅                               │
│    Allow request to continue                                            │
│                                                                         │
│ 2. Extract Cookie                                                       │
│    req.cookies.admin_jwt = "eyJh..."                                   │
│    ✅ Cookie successfully extracted!                                    │
│                                                                         │
│ 3. Verify JWT Signature                                                │
│    const payload = verifyJwt(token, SECRET_KEY)                        │
│                                                                         │
│    Checks:                                                              │
│    ✅ Signature valid? (signed with our key?)                          │
│    ✅ Not expired? (exp > Date.now()?)                                  │
│    ✅ Issuer correct? (iss == 'college-bus-system'?)                   │
│    ✅ Audience correct? (aud == 'admin-panel'?)                        │
│                                                                         │
│    Result: {                                                             │
│      sub: "admin-123",                                                  │
│      role: "TRANSPORT_OFFICER",                                         │
│      iat: 1775391600,                                                   │
│      exp: 1775395200,                                                   │
│      iss: "college-bus-system"                                          │
│    }                                                                      │
│                                                                         │
│ 4. Load User from Database                                             │
│    const user = await db.admin.findById("admin-123")                   │
│    ✅ User found and active                                             │
│                                                                         │
│ 5. Get Capabilities                                                     │
│    const caps = getCapabilities(user.role)                             │
│    Result: {                                                             │
│      canManageStudents: true,                                           │
│      canManageRoutes: true,                                             │
│      ...other permissions                                              │
│    }                                                                      │
│                                                                         │
│ 6. Route Authorizer                                                     │
│    Is canManageStudents = true? Yes ✅                                  │
│    Allow request to continue to handler                                 │
│                                                                         │
│ 7. Query Database                                                       │
│    SELECT * FROM users WHERE role = 'STUDENT' LIMIT 50                 │
│    Result: 47 students found                                            │
│                                                                         │
│ 8. Return Response                                                      │
│    status: 200 OK                                                      │
│    body: {                                                               │
│      success: true,                                                     │
│      data: [                                                             │
│        { id: "s1", name: "Alice", ... },                               │
│        { id: "s2", name: "Bob", ... },                                 │
│        ... 45 more students                                             │
│      ]                                                                   │
│    }                                                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│ STEP 4: FRONTEND RECEIVES RESPONSE                                     │
│                                                                         │
│ Axios interceptor processes:                                            │
│   Response status: 200 ✅                                               │
│   Response body: { success: true, data: [...] }                        │
│                                                                         │
│   Extracting data:                                                      │
│   return response.data.data  // Returns student array                  │
│                                                                         │
│ React component:                                                        │
│   useState(students, setStudents)                                       │
│   useEffect runs: api.get(...).then(setStudents)                       │
│   Students state updated with 47 student records                       │
│   Component re-renders with data                                        │
│                                                                         │
│ UI Display:                                                             │
│   ✅ Shows Students page with data                                      │
│   ✅ Sidebar shows active link: "Students"                             │
│   ✅ No redirect!                                                       │
│   ✅ Everything works!                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Part 9: Summary of Issues & Fixes

### Root Cause Analysis

| Issue | Root Cause | Symptom | Location | Fix |
|-------|-----------|---------|----------|-----|
| **401 Unauthorized** | `sameSite: 'strict'` blocked cookies from being sent | All data requests return 401 | Browser security | Changed to `sameSite: 'lax'` in dev |
| **Auto-redirect to Live Ops** | 401 errors trigger auth interceptor, which clears session | Click Students → redirects to dashboard | api.client.ts interceptor | No more 401s, no redirects |
| **"Routing looks broken"** | Not routing issue; auth state changing unexpectedly | Pages load then disappear after 1-2 seconds | App.tsx RequireAdminSession | Fixed session persistence |
| **Requests failing** | JWT not being sent because cookie path was too restrictive | `/v1/users` returns 401 but `/v1/admin/me` works | Cookie path config | Changed `path: '/v1/admin'` to `path: '/'` |

### What Systems Are Involved

```
Authentication System Components:

┌─────────────────────────────────────────┐
│         Browser (Frontend)              │
│  - Cookie Storage                       │
│  - axios client                         │
│  - Auth interceptors                    │
└─────────────────────────────────────────┘
           ↕ (HTTPS/HTTP)
┌─────────────────────────────────────────┐
│         Backend (Fastify)               │
│  - CORS middleware                      │
│  - Cookie parsing                       │
│  - JWT verification                     │
│  - Auth guard middleware                │
│  - Database queries                     │
└─────────────────────────────────────────┘
           ↕ (SQL)
┌─────────────────────────────────────────┐
│    Database (PostgreSQL)                │
│  - User credentials                     │
│  - User permissions/roles               │
│  - Session logs                         │
└─────────────────────────────────────────┘
```

### Key Security Concepts

```
DEFENSE LAYERS:

Layer 1: HTTPS/TLS
  - Encrypts entire request/response
  - Prevents network sniffing
  - Browsers enforce with 'secure' flag

Layer 2: CSRF Protection
  - CSRF token must match
  - Prevents cross-site forgery
  - sameSite='strict' adds additional protection

Layer 3: JWT Signature Verification
  - Token signed with server secret
  - Cannot forge without secret
  - Signature proven valid = user is authentic

Layer 4: Cookie Flags
  - httpOnly: JavaScript can't access
  - secure: HTTPS only
  - sameSite: Controls cross-origin

Layer 5: Capability-Check
  - Even if authenticated, check permissions
  - User can't access resources beyond role
```

---

## Part 10: File Structure & Relevant Code

### Key Files Involved

```
Frontend:
├── apps/admin/src/
│   ├── App.tsx                          ← Route definitions & auth bootstrap
│   ├── lib/api.client.ts                ← Axios config & interceptors
│   ├── store/auth.store.ts              ← Zustand auth state
│   ├── pages/auth/Login.tsx             ← Login form
│   └── components/shared/RequireCapability.tsx  ← Auth gate

Backend:
├── apps/backend/src/
│   ├── app.ts                           ← CORS & cookie setup
│   ├── lib/admin-session.ts             ← Cookie options (FIXED)
│   ├── lib/auth-config.ts               ← CORS allowed origins
│   ├── modules/auth/
│   │   ├── admin-auth.routes.ts         ← Login endpoint
│   │   ├── admin-auth.service.ts        ← JWT issuance
│   │   └── admin-auth.middleware.ts     ← JWT verification
│   └── middleware/auth.middleware.ts    ← Route guards
```

### Code Examples

#### Backend Cookie Configuration (Before)
```typescript
// ❌ BROKEN
const adminJwtCookieOptions = {
  httpOnly: true,
  secure: false,
  sameSite: 'strict',     // ❌ Blocks localhost development
  path: '/v1/admin',      // ❌ Too restrictive
  maxAge: 8 * 60 * 60,
  domain: undefined,
};
```

#### Backend Cookie Configuration (After)
```typescript
// ✅ FIXED
const adminJwtCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'strict' : 'lax',  // ✅ Dev friendly
  path: '/',              // ✅ All paths
  maxAge: 8 * 60 * 60,
  domain: adminSecurityConfig.cookieDomain,
};
```

#### Frontend API Interceptor
```typescript
// apps/admin/src/lib/api.client.ts
axiosClient.interceptors.response.use(
  (response) => {
    // Success: Extract data from response
    if (response.data?.success === true && 'data' in response.data) {
      return response.data.data;  // Return just the data
    }
    return response.data;
  },
  (error) => {
    // Error handling
    if (error.response?.status === 401) {
      clearAdminSessionState();  // ← This clears auth!
      // Redirects to login automatically
    }
    return Promise.reject(error);
  }
);
```

#### Auth Bootstrap in App.tsx
```typescript
// apps/admin/src/App.tsx
useEffect(() => {
  const bootstrap = async () => {
    if (isAuthenticated) return;  // Already logged in

    try {
      const admin = await api.get<AdminSessionUser>('/v1/admin/auth/me');
      login(admin);  // Sets state.isAuthenticated = true
    } catch (err) {
      if (isAuthError(err)) {
        logout();  // Sets state.isAuthenticated = false
      }
    }
  };

  void bootstrap();
}, [isAuthenticated, login, logout]);
```

---

## Part 11: Testing & Debugging

### How to Verify The Fix Works

```javascript
// In browser console (F12):

// 1. Check if cookies are stored
console.log('Cookies:', document.cookie);

// 2. Test API call manually
fetch('http://localhost:3000/v1/users?role=STUDENT', {
  credentials: 'include',  // ← Important! Send cookies
  headers: { 'Content-Type': 'application/json' }
})
.then(r => {
  console.log('Status:', r.status);
  return r.json();
})
.then(d => console.log('Data:', d))
.catch(e => console.error('Error:', e));

// 3. Check auth state
const authState = JSON.parse(
  localStorage.getItem('auth-store') || '{}'
);
console.log('Auth state:', authState.state.isAuthenticated);

// 4. Monitor network requests
// Open DevTools → Network tab
// Look for status codes:
// ✅ 200 = Success
// ❌ 401 = Unauthorized (auth failed)
// ❌ 403 = Forbidden (auth worked, no permission)
```

### Debugging Steps if Still Having Issues

```
1. Check if API calls are being made with cookies
   DevTools → Network → Click request → Request Headers
   Look for: Cookie: admin_jwt=...

2. If no cookies in request:
   DevTools → Application → Cookies
   Check if admin_jwt and admin_csrf exist
   
   If NOT present:
   - Server might not be setting them
   - Restart backend: pnpm dev --filter=backend
   - Clear browser cookies manually
   - Log in again

3. If cookies present but still 401:
   DevTools → Application → Console
   Run: fetch test (see above)
   Check response status and body
   
   If 401: Backend issue (auth config)
   If 403: Frontend issue (permissions)

4. Check CORS headers
   DevTools → Network → Click request → Response Headers
   Look for: Access-Control-Allow-Credentials: true
```

---

## Part 12: Key Takeaways

### What You Should Remember

1. **Cookies carry the JWT token**
   - JWT is created by backend on login
   - Stored in an HTTP-only cookie
   - Sent automatically with every request

2. **sameSite controls cross-origin cookies**
   - `strict`: Never send cross-origin (highest security)
   - `lax`: Send for safe cross-origin requests (good for dev)
   - `none`: Always send (requires secure=true)

3. **Development needs lax, Production needs strict**
   - localhost:5173 → localhost:3000 is cross-origin
   - Can't test with sameSite=strict
   - Use isProduction check to switch dynamically

4. **401 errors clear authentication**
   - Frontend assumes you're not logged in
   - Session state is cleared
   - You get redirected automatically

5. **Routing itself wasn't broken**
   - React Router was working fine
   - Auth state changes caused redirects
   - Fix the cookies, fix the routing

6. **Security has multiple layers**
   - HTTPS/TLS (encryption)
   - CSRF tokens (forgery protection)
   - JWT signatures (token verification)
   - Cookie flags (storage protection)
   - Capabilities (permission checking)

---

## Conclusion

The issue was a **simple but critical misconfiguration** of cookie security settings:

- ❌ `sameSite: 'strict'` prevented cookies from being sent to the API
- ❌ `path: '/v1/admin'` made cookies only available for certain endpoints
- ✅ Changed to `sameSite: 'lax'` (dev) / `'strict'` (prod)
- ✅ Changed to `path: '/'` to allow all endpoints

This one-line fix resolved:
- ✅ Constant 401 Unauthorized errors
- ✅ Auto-redirects from data console routes
- ✅ Session being lost after login
- ✅ Routing appearing to be broken

The system now works as intended! 🎉
