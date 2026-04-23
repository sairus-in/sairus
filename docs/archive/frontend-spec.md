# College Bus Management System
# Frontend — Complete Architecture & Implementation Spec
# Mobile App (Expo) + Admin Panel (React + Vite)

> Written after full cross-analysis of: backend-architecture, backend-hardened-v2,
> auth-system-final, mobile-app-architecture, engineering-operations.
> Every frontend decision is grounded in what the backend actually does.
> Status: READY FOR IMPLEMENTATION

---

## Table of Contents

1. [Platform Engineering View — How Frontend Connects to Everything](#1-platform-engineering-view)
2. [API Integration Layer — The Foundation](#2-api-integration-layer)
3. [Mobile App — Complete Implementation](#3-mobile-app)
4. [Admin Panel — Complete Implementation](#4-admin-panel)
5. [Map Architecture — Google Maps Deep Integration](#5-map-architecture)
6. [Realtime Architecture — Firebase + Socket.io](#6-realtime-architecture)
7. [Offline Strategy — Low Network First](#7-offline-strategy)
8. [Performance Optimization — Every Tactic](#8-performance-optimization)
9. [State Management Architecture](#9-state-management)
10. [Frontend Security Model](#10-frontend-security)
11. [Build Rules — Non-Negotiables](#11-build-rules)
12. [Build Order](#12-build-order)

---

## 1. Platform Engineering View

### How frontend connects to the entire system

```
┌─────────────────────────────────────────────────────────────────┐
│                     STUDENT MOBILE APP                          │
│  Expo Router ← Zustand ← TanStack Query ← Axios ← JWT          │
│  Firebase RTDB (GPS live)   Socket.io (events)                  │
│  expo-location (GPS check)  expo-camera (QR scan)               │
│  AsyncStorage (offline)     expo-task-manager (background GPS)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS + WSS
┌──────────────────────────▼──────────────────────────────────────┐
│                     FASTIFY BACKEND                             │
│  /v1/auth/*  /v1/attendance/*  /v1/gps/*  /v1/trips/*           │
│  /v1/admin/* /v1/incidents/*   /v1/jobs/* (Cloud Tasks only)    │
└──┬──────────────────┬───────────────────┬────────────────────────┘
   │                  │                   │
┌──▼───┐    ┌────────▼──────┐    ┌───────▼───────────────────────┐
│Cloud │    │  Firebase     │    │      Redis (Upstash)           │
│ SQL  │    │  RTDB         │    │  QR nonces, auth cache,        │
│(Pg)  │    │  /buses/{id}  │    │  rate limits, trip state       │
└──────┘    └───────────────┘    └───────────────────────────────┘
                   ▲
┌──────────────────┴──────────────────────────────────────────────┐
│                     DRIVER MOBILE APP                           │
│  expo-location background task → writes to Firebase RTDB        │
│  Socket.io → receives QR refresh events from backend            │
│  Kiosk mode: expo-keep-awake + expo-brightness                  │
└─────────────────────────────────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼──────────────────────────────────────┐
│                     ADMIN PANEL                                 │
│  React + Vite + TanStack Query + Socket.io                      │
│  Google Maps JS API (all 180 buses on one map)                  │
│  httpOnly cookie auth (no token storage in JS)                  │
│  Recharts (attendance analytics)                                │
└─────────────────────────────────────────────────────────────────┘
```

### What the backend gives the frontend — contract summary

```
Endpoint                          Mobile uses              Admin uses
─────────────────────────────────────────────────────────────────────
GET  /v1/student/home             Every app open           ✗
POST /v1/auth/login               Login flow               ✗
POST /v1/auth/refresh             Silent token refresh     ✗
POST /v1/auth/logout-all          Profile screen           ✗
POST /v1/admin/auth/login         ✗                        Login
POST /v1/attendance/check-in      QR scan result           ✗
POST /v1/attendance/verify-arrival FCM deep link           ✗
POST /v1/attendance/skip-today    Student home             ✗
POST /v1/attendance/wait-for-me   Student home             ✗
GET  /v1/attendance/history       History tab              ✗
POST /v1/attendance/corrections   Correction form          ✗
GET  /v1/admin/corrections        ✗                        Corrections queue
POST /v1/gps/ping                 Driver background task   ✗
POST /v1/trips/start              Driver home              ✗
POST /v1/trips/:id/end            Driver kiosk             ✗
GET  /v1/admin/stats              ✗                        Dashboard
GET  /v1/admin/active-trips       ✗                        Live map
POST /v1/incidents/report         Driver breakdown screen  ✗
GET  /v1/admin/incidents          ✗                        Incidents
POST /v1/users/bulk-import        ✗                        Students page
GET  /v1/users                    ✗                        Students list
Firebase RTDB /buses/{id}         Student live map         Admin fleet map
Socket.io bus:{busId}             Driver kiosk QR          ✗
Socket.io admin                   ✗                        Admin dashboard
```

---

## 2. API Integration Layer

This is the most critical piece of frontend infrastructure.
Everything else builds on top of it.

### Mobile: Axios client with interceptors

```typescript
// apps/mobile/lib/api.client.ts

import axios, { AxiosInstance, AxiosError } from 'axios'
import { useAuthStore } from '../store/auth.store'
import { tokenRefreshQueue } from './token-refresh-queue'

const BASE_URL = __DEV__
  ? 'http://192.168.X.X:3000'  // your laptop IP during dev
  : process.env.EXPO_PUBLIC_API_URL  // Cloud Run URL in prod

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 10_000,  // 10s — matches backend request timeout
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
})

// ── Request interceptor: attach JWT ─────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ── Response interceptor: handle 401 + silent refresh ───────────
// When JWT expires (24h), silently get a new one from Firebase
// Student sees nothing — token refresh is invisible

let isRefreshing = false
let pendingRequests: Array<(token: string) => void> = []

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any

    if (error.response?.status === 401 && !originalRequest._retry) {
      const errorCode = (error.response?.data as any)?.error

      // TOKEN_EXPIRED → try silent refresh
      if (errorCode === 'TOKEN_EXPIRED') {
        originalRequest._retry = true

        if (isRefreshing) {
          // Queue this request — another refresh is already in progress
          return new Promise((resolve) => {
            pendingRequests.push((newToken: string) => {
              originalRequest.headers.Authorization = `Bearer ${newToken}`
              resolve(apiClient(originalRequest))
            })
          })
        }

        isRefreshing = true

        try {
          const newToken = await silentFirebaseRefresh()
          useAuthStore.getState().setToken(newToken)

          // Replay all queued requests with new token
          pendingRequests.forEach(cb => cb(newToken))
          pendingRequests = []

          originalRequest.headers.Authorization = `Bearer ${newToken}`
          return apiClient(originalRequest)
        } catch (refreshError) {
          // Refresh failed → force re-login
          pendingRequests = []
          useAuthStore.getState().clearUser()
          return Promise.reject(refreshError)
        } finally {
          isRefreshing = false
        }
      }

      // SESSION_REVOKED / DEVICE_MISMATCH / FORCED_RELOGIN_REQUIRED → hard logout
      if (['SESSION_REVOKED', 'DEVICE_MISMATCH', 'FORCED_RELOGIN_REQUIRED', 'ACCOUNT_DISABLED'].includes(errorCode)) {
        useAuthStore.getState().clearUser()
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  }
)

// Silent Firebase token refresh
const silentFirebaseRefresh = async (): Promise<string> => {
  const { getDeviceId } = await import('./device')
  const auth = await import('@react-native-firebase/auth')
  const currentUser = auth.default().currentUser

  if (!currentUser) throw new Error('No Firebase user')

  const firebaseToken = await currentUser.getIdToken(true)  // force refresh
  const deviceId = await getDeviceId()

  const response = await axios.post(`${BASE_URL}/v1/auth/refresh`, {
    firebaseToken,
    deviceId
  })

  return response.data.token
}
```

### Admin: Axios client with cookie credentials

```typescript
// apps/admin/src/lib/api.client.ts

import axios from 'axios'

export const adminApiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,  // CRITICAL: sends httpOnly cookie on every request
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  }
})

// ── Response interceptor: handle 401 → redirect to login ────────
adminApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Admin session expired or revoked → redirect to login
      // Don't try to refresh — admin re-authenticates manually
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

### TanStack Query configuration — mobile

```typescript
// apps/mobile/lib/query-client.ts

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Show cached data immediately, refetch in background
      staleTime: 30_000,          // 30s — data considered fresh
      gcTime: 5 * 60 * 1000,      // 5min — keep in memory

      // CRITICAL for low network: show cached data even when offline
      networkMode: 'offlineFirst',

      retry: (failureCount, error: any) => {
        // Don't retry auth errors — they need action
        if ([401, 403].includes(error?.response?.status)) return false
        // Retry network errors up to 3 times
        return failureCount < 3
      },

      retryDelay: (attemptIndex) =>
        Math.min(1000 * 2 ** attemptIndex, 10_000),  // exponential backoff
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 0,  // mutations don't retry — they go to offline queue
    }
  }
})
```

### TanStack Query configuration — admin

```typescript
// apps/admin/src/lib/query-client.ts

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,        // 15s — admin data refreshes more aggressively
      gcTime: 2 * 60 * 1000,
      networkMode: 'online',    // Admin is always online — no offline mode needed
      retry: (failureCount, error: any) => {
        if ([401, 403, 404].includes(error?.response?.status)) return false
        return failureCount < 2
      }
    }
  }
})
```

---

## 3. Mobile App

### The one app, two roles principle

Both Student and Driver use the same installed app.
The root `_layout.tsx` routes based on role from the JWT.
No user ever navigates between roles manually.

### Complete file structure

```
apps/mobile/
├── app/
│   ├── _layout.tsx                    ← brain: auth guard + role routing + FCM setup
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   ├── verify-otp.tsx
│   │   └── pending.tsx
│   ├── (student)/
│   │   ├── _layout.tsx                ← tab navigator
│   │   ├── index.tsx                  ← home
│   │   ├── map.tsx                    ← live bus map
│   │   ├── history.tsx                ← attendance history
│   │   ├── profile.tsx
│   │   ├── scanner.tsx                ← QR scanner (no tabs)
│   │   ├── checkin-success.tsx
│   │   ├── checkin-fail.tsx
│   │   ├── verify-arrival.tsx         ← FCM deep link target
│   │   └── correction/
│   │       ├── index.tsx
│   │       └── [logId].tsx
│   └── (driver)/
│       ├── _layout.tsx
│       ├── index.tsx                  ← pre-trip
│       ├── route-preview.tsx
│       ├── kiosk.tsx                  ← full screen, no nav
│       ├── breakdown.tsx
│       ├── post-breakdown.tsx
│       ├── summary.tsx
│       └── messages.tsx
│
├── components/
│   ├── shared/
│   │   ├── OfflineBanner.tsx
│   │   ├── LoadingState.tsx
│   │   ├── ErrorState.tsx
│   │   └── EmptyState.tsx
│   ├── student/
│   │   ├── BusStatusCard.tsx          ← 7 states
│   │   ├── CheckInButton.tsx          ← 6 states + animation
│   │   ├── AttendanceCalendar.tsx
│   │   ├── AttendanceRow.tsx
│   │   ├── CorrectionNudge.tsx
│   │   └── WaitForMeSheet.tsx
│   └── driver/
│       ├── QRDisplay.tsx
│       ├── CheckInToast.tsx
│       ├── WaitRequestBanner.tsx
│       ├── ManualMarkSheet.tsx
│       └── AdminMessageBar.tsx
│
├── hooks/
│   ├── useStudentHome.ts
│   ├── useLiveBus.ts
│   ├── useCheckin.ts
│   ├── useAttendanceHistory.ts
│   ├── useKioskSocket.ts
│   ├── useOfflineQueue.ts
│   └── useNetworkStatus.ts
│
├── store/
│   ├── auth.store.ts                  ← Zustand + AsyncStorage
│   └── trip.store.ts                  ← driver kiosk state
│
├── lib/
│   ├── api.client.ts
│   ├── socket.ts
│   ├── firebase.ts
│   ├── device.ts                      ← deviceId hash
│   ├── notifications.ts
│   └── offline-queue.ts
│
└── tasks/
    └── gps.task.ts
```

---

### Root layout — `app/_layout.tsx`

```typescript
// app/_layout.tsx
// This file runs first on every app open. It decides everything.

import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import * as Notifications from 'expo-notifications'
import messaging from '@react-native-firebase/messaging'
import { useAuthStore } from '../store/auth.store'
import { queryClient } from '../lib/query-client'
import { setupNotificationHandlers } from '../lib/notifications'

export default function RootLayout() {
  const { user, isLoaded, token } = useAuthStore()
  const router = useRouter()
  const segments = useSegments()

  // ── Auth routing — runs when user or load state changes ─────────
  useEffect(() => {
    if (!isLoaded) return  // Still reading from AsyncStorage

    const inAuth    = segments[0] === '(auth)'
    const inStudent = segments[0] === '(student)'
    const inDriver  = segments[0] === '(driver)'

    if (!user || !token) {
      // Not logged in → login screen
      if (!inAuth) router.replace('/(auth)/login')
      return
    }

    // Logged in but no route assignment
    if (user.role === 'STUDENT' && !user.routeAssignment) {
      router.replace('/(auth)/pending')
      return
    }

    // Route to correct experience
    if (user.role === 'DRIVER') {
      if (!inDriver) router.replace('/(driver)/')
    } else {
      if (!inStudent) router.replace('/(student)/')
    }
  }, [user, isLoaded, token])

  // ── FCM setup — runs once on app open ───────────────────────────
  useEffect(() => {
    setupNotificationHandlers(router, queryClient)
  }, [])

  // ── FCM token refresh — send to backend on every launch ─────────
  useEffect(() => {
    if (!user || !token) return

    const refreshFCMToken = async () => {
      const fcmToken = await messaging().getToken()
      // Fire and forget — don't block app load
      fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/users/fcm-token`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fcmToken })
      }).catch(() => {})  // silent fail — not critical
    }

    refreshFCMToken()
  }, [user, token])

  if (!isLoaded) return null  // SplashScreen handles this

  return <Slot />
}
```

---

### Auth store — `store/auth.store.ts`

```typescript
// store/auth.store.ts

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface RouteAssignment {
  routeId:  string
  routeName: string
  stopName:  string
  busNumber: string
  busId:     string
  scheduledTimeMorning: string
}

interface AuthUser {
  id:         string
  name:       string
  phone:      string
  role:       'STUDENT' | 'STAFF' | 'DRIVER'
  department?: string
  rollNumber?: string
  routeAssignment?: RouteAssignment
}

interface AuthStore {
  user:     AuthUser | null
  token:    string | null
  isLoaded: boolean

  setUser:   (user: AuthUser, token: string) => void
  setToken:  (token: string) => void
  clearUser: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:     null,
      token:    null,
      isLoaded: false,

      setUser:   (user, token) => set({ user, token }),
      setToken:  (token)       => set({ token }),
      clearUser: ()            => set({ user: null, token: null }),
    }),
    {
      name:    'auth-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Mark as loaded after reading from AsyncStorage
        if (state) state.isLoaded = true
      },
    }
  )
)
```

---

### Login screen — `app/(auth)/login.tsx`

```typescript
// app/(auth)/login.tsx

import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, Alert
} from 'react-native'
import { useRouter } from 'expo-router'
import auth from '@react-native-firebase/auth'

export default function LoginScreen() {
  const [phone, setPhone]     = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSendOTP = async () => {
    const cleaned = phone.replace(/\D/g, '')
    if (cleaned.length !== 10) {
      Alert.alert('Invalid number', 'Enter a valid 10-digit mobile number')
      return
    }

    setLoading(true)
    const formatted = `+91${cleaned}`

    try {
      const confirmation = await auth().signInWithPhoneNumber(formatted)
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { verificationId: confirmation.verificationId, phone: formatted }
      })
    } catch (err: any) {
      const messages: Record<string, string> = {
        'auth/invalid-phone-number': 'Enter a valid 10-digit number',
        'auth/too-many-requests':    'Too many attempts. Try again in 1 hour.',
        'auth/quota-exceeded':       'OTP limit reached. Try again later.',
      }
      Alert.alert('Error', messages[err.code] ?? 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.content}>
        <Text style={styles.title}>🚌</Text>
        <Text style={styles.heading}>College Bus</Text>
        <Text style={styles.subheading}>Enter your registered mobile number</Text>

        <View style={styles.inputRow}>
          <View style={styles.prefix}>
            <Text style={styles.prefixText}>+91</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="10-digit number"
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
            onSubmitEditing={handleSendOTP}
            returnKeyType="done"
            autoFocus
          />
        </View>

        <TouchableOpacity
          style={[styles.button, (loading || phone.length !== 10) && styles.buttonDisabled]}
          onPress={handleSendOTP}
          disabled={loading || phone.length !== 10}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Sending OTP...' : 'Send OTP'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Only registered college students and staff can log in.
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#fff' },
  content:      { flex: 1, justifyContent: 'center', padding: 24 },
  title:        { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  heading:      { fontSize: 28, fontWeight: '700', textAlign: 'center', color: '#111' },
  subheading:   { fontSize: 15, color: '#6b7280', textAlign: 'center', marginBottom: 32, marginTop: 4 },
  inputRow:     { flexDirection: 'row', borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 12, marginBottom: 16, overflow: 'hidden' },
  prefix:       { backgroundColor: '#f3f4f6', paddingHorizontal: 14, justifyContent: 'center' },
  prefixText:   { fontSize: 16, color: '#374151', fontWeight: '600' },
  input:        { flex: 1, fontSize: 18, padding: 14, color: '#111', letterSpacing: 1 },
  button:       { backgroundColor: '#1E3A8A', borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText:   { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint:         { marginTop: 16, fontSize: 13, color: '#9ca3af', textAlign: 'center' },
})
```

---

### OTP verification — `app/(auth)/verify-otp.tsx`

```typescript
// app/(auth)/verify-otp.tsx

import { useState, useRef, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import auth from '@react-native-firebase/auth'
import { apiClient } from '../../lib/api.client'
import { getDeviceId } from '../../lib/device'
import { useAuthStore } from '../../store/auth.store'

export default function VerifyOTPScreen() {
  const { verificationId, phone } = useLocalSearchParams<{
    verificationId: string
    phone: string
  }>()

  const [otp, setOtp]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [countdown, setCountdown] = useState(30)
  const [attempts, setAttempts] = useState(0)
  const { setUser } = useAuthStore()
  const router = useRouter()
  const inputRef = useRef<TextInput>(null)

  // Countdown for resend button
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => setCountdown(c => c - 1), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const handleVerify = async () => {
    if (otp.length !== 6 || loading) return
    setLoading(true)

    try {
      // Step 1: Verify OTP with Firebase
      const credential = auth.PhoneAuthProvider.credential(verificationId, otp)
      const userCredential = await auth().signInWithCredential(credential)

      // Step 2: Get Firebase ID token
      const firebaseToken = await userCredential.user.getIdToken()

      // Step 3: Get device ID (SHA-256 hashed by getDeviceId)
      const deviceId = await getDeviceId()

      // Step 4: Exchange for backend JWT
      const response = await apiClient.post('/v1/auth/login', {
        firebaseToken,
        deviceId
      })

      const { user, token } = response.data

      // Step 5: Handle pending provisioning
      if (response.data.status === 'PENDING_PROVISIONING') {
        setUser({ ...user, authStatus: 'PENDING_PROVISIONING' }, token)
        return  // _layout.tsx will route to /pending
      }

      // Step 6: Store user — _layout.tsx reacts and routes
      setUser(user, token)

    } catch (err: any) {
      const errCode = err.code  // Firebase error code
      const errResponse = err.response?.data?.error  // Backend error code

      if (errCode === 'auth/invalid-verification-code') {
        setAttempts(a => a + 1)
        const remaining = 3 - attempts - 1
        if (remaining <= 0) {
          Alert.alert('Too many attempts', 'Request a new OTP.', [
            { text: 'OK', onPress: () => router.back() }
          ])
        } else {
          Alert.alert('Wrong code', `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`)
        }
      } else if (errCode === 'auth/code-expired') {
        Alert.alert('OTP expired', 'Request a new code.', [
          { text: 'OK', onPress: () => router.back() }
        ])
      } else if (errResponse === 'USER_NOT_REGISTERED') {
        Alert.alert(
          'Not registered',
          'This number is not registered in the college transport system. Contact the transport office.',
          [{ text: 'OK', onPress: () => router.back() }]
        )
      } else {
        Alert.alert('Error', 'Something went wrong. Please try again.')
      }
      setOtp('')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (countdown > 0) return
    router.back()  // Go back to login to re-enter phone and get new OTP
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Enter OTP</Text>
      <Text style={styles.subheading}>
        Sent to {phone}
      </Text>

      <TextInput
        ref={inputRef}
        style={styles.otpInput}
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        textAlign="center"
        onSubmitEditing={handleVerify}
      />

      <TouchableOpacity
        style={[styles.button, (otp.length !== 6 || loading) && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={otp.length !== 6 || loading}
      >
        <Text style={styles.buttonText}>
          {loading ? 'Verifying...' : 'Verify'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleResend}
        disabled={countdown > 0}
        style={styles.resendButton}
      >
        <Text style={[styles.resendText, countdown > 0 && styles.resendDisabled]}>
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  heading:        { fontSize: 26, fontWeight: '700', textAlign: 'center', color: '#111', marginBottom: 8 },
  subheading:     { fontSize: 15, color: '#6b7280', textAlign: 'center', marginBottom: 32 },
  otpInput:       { fontSize: 36, fontWeight: '700', letterSpacing: 16, padding: 16, borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 12, marginBottom: 20, color: '#111' },
  button:         { backgroundColor: '#1E3A8A', borderRadius: 12, padding: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  resendButton:   { marginTop: 16, alignItems: 'center', padding: 12 },
  resendText:     { fontSize: 14, color: '#1E3A8A', fontWeight: '600' },
  resendDisabled: { color: '#9ca3af' },
})
```

---

### Student Home — `app/(student)/index.tsx`

```typescript
// app/(student)/index.tsx

import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native'
import { useAuthStore } from '../../store/auth.store'
import { useStudentHome } from '../../hooks/useStudentHome'
import { BusStatusCard } from '../../components/student/BusStatusCard'
import { CheckInButton } from '../../components/student/CheckInButton'
import { StatCards } from '../../components/student/StatCards'
import { CorrectionNudge } from '../../components/student/CorrectionNudge'
import { OfflineBanner } from '../../components/shared/OfflineBanner'
import { WaitForMeSheet } from '../../components/student/WaitForMeSheet'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { useState } from 'react'

export default function StudentHomeScreen() {
  const { user } = useAuthStore()
  const { isOnline } = useNetworkStatus()
  const [waitSheetVisible, setWaitSheetVisible] = useState(false)

  const {
    data: home,
    isLoading,
    isFetching,
    refetch,
    isStale,
  } = useStudentHome()

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={refetch} />
      }
    >
      {!isOnline && <OfflineBanner />}

      <Text style={styles.greeting}>
        Good morning, {user?.name?.split(' ')[0]} 👋
      </Text>

      {/* Bus status card — shows 7 different states */}
      <BusStatusCard
        home={home}
        isLoading={isLoading}
        isStale={isStale && !isOnline}
        onWaitForMe={() => setWaitSheetVisible(true)}
      />

      {/* The main check-in button */}
      <CheckInButton home={home} isLoading={isLoading} />

      {/* Skip today — only visible before trip starts */}

      {/* Attendance stats */}
      {home?.attendance && (
        <StatCards attendance={home.attendance} />
      )}

      {/* Nudge if marked absent yesterday and no correction filed */}
      {home?.correctionNudge && (
        <CorrectionNudge nudge={home.correctionNudge} />
      )}

      {/* Wait-for-me bottom sheet */}
      <WaitForMeSheet
        visible={waitSheetVisible}
        tripId={home?.trip?.id}
        onClose={() => setWaitSheetVisible(false)}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content:   { padding: 20, paddingBottom: 40 },
  greeting:  { fontSize: 22, fontWeight: '700', color: '#111', marginBottom: 16 },
})
```

---

### useStudentHome hook

```typescript
// hooks/useStudentHome.ts

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api.client'

export interface StudentHome {
  trip: {
    id:       string
    status:   'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | null
    busId:    string
    busNumber: string
    routeName: string
    stopName:  string
    scheduledTime: string
  } | null
  checkin: {
    status:      'PRESENT' | 'ABSENT' | 'PENDING' | 'SELF_ARRANGED' | null
    checkedInAt: string | null
  }
  attendance: {
    thisMonth:  number  // percentage
    present:    number  // count
    absent:     number
    total:      number
  }
  correctionNudge: {
    logId:   string
    date:    string
    message: string
  } | null
}

export const useStudentHome = () => {
  return useQuery<StudentHome>({
    queryKey: ['student-home'],
    queryFn:  () => apiClient.get('/v1/student/home').then(r => r.data.data),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      // Poll every 30s if trip is active, every 5min otherwise
      const data = query.state.data
      return data?.trip?.status === 'ACTIVE' ? 30_000 : 5 * 60 * 1000
    }
  })
}
```

---

### BusStatusCard — `components/student/BusStatusCard.tsx`

```typescript
// components/student/BusStatusCard.tsx
// 7 distinct states — every one accounted for

import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { StudentHome } from '../../hooks/useStudentHome'

type Props = {
  home:        StudentHome | undefined
  isLoading:   boolean
  isStale:     boolean
  onWaitForMe: () => void
}

type BusState =
  | 'loading'
  | 'no_trip_today'
  | 'trip_not_started'
  | 'trip_active_not_checked'
  | 'trip_active_checked_in'
  | 'trip_ended'
  | 'trip_cancelled'

const getBusState = (home: StudentHome | undefined, isLoading: boolean): BusState => {
  if (isLoading || !home) return 'loading'
  if (!home.trip)             return 'no_trip_today'
  if (home.trip.status === 'CANCELLED') return 'trip_cancelled'
  if (home.trip.status === 'COMPLETED') return 'trip_ended'
  if (home.trip.status === 'SCHEDULED') return 'trip_not_started'
  // ACTIVE:
  if (home.checkin.status === 'PRESENT') return 'trip_active_checked_in'
  return 'trip_active_not_checked'
}

export const BusStatusCard = ({ home, isLoading, isStale, onWaitForMe }: Props) => {
  const busState = getBusState(home, isLoading)

  const stateConfig = {
    loading: {
      emoji: '⏳', title: 'Loading...', subtitle: '',
      color: '#f3f4f6', textColor: '#9ca3af'
    },
    no_trip_today: {
      emoji: '😴', title: 'No trip today',
      subtitle: home?.trip ? '' : 'No bus scheduled for today',
      color: '#f3f4f6', textColor: '#6b7280'
    },
    trip_not_started: {
      emoji: '🚌', title: `Bus ${home?.trip?.busNumber}`,
      subtitle: `Departs ${home?.trip?.scheduledTime} from ${home?.trip?.stopName}`,
      color: '#eff6ff', textColor: '#1E3A8A'
    },
    trip_active_not_checked: {
      emoji: '🔴', title: `Bus ${home?.trip?.busNumber} — boarding`,
      subtitle: `Scan QR to check in at ${home?.trip?.stopName}`,
      color: '#fef2f2', textColor: '#dc2626'
    },
    trip_active_checked_in: {
      emoji: '✅', title: 'Checked in',
      subtitle: `${home?.trip?.busNumber} · ${home?.checkin?.checkedInAt ? new Date(home.checkin.checkedInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}`,
      color: '#f0fdf4', textColor: '#16a34a'
    },
    trip_ended: {
      emoji: '🏁', title: 'Trip completed',
      subtitle: home?.checkin?.status === 'PRESENT' ? 'You were marked present ✓' : 'You were marked absent',
      color: '#f9fafb', textColor: '#6b7280'
    },
    trip_cancelled: {
      emoji: '⚠️', title: 'Trip cancelled',
      subtitle: 'Contact transport office for details',
      color: '#fffbeb', textColor: '#d97706'
    },
  }[busState]

  return (
    <View style={[styles.card, { backgroundColor: stateConfig.color }]}>
      <View style={styles.row}>
        <Text style={styles.emoji}>{stateConfig.emoji}</Text>
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: stateConfig.textColor }]}>
            {stateConfig.title}
          </Text>
          {stateConfig.subtitle ? (
            <Text style={styles.subtitle}>{stateConfig.subtitle}</Text>
          ) : null}
        </View>
      </View>

      {/* Wait-for-me button — only when trip active, not checked in */}
      {busState === 'trip_active_not_checked' && (
        <TouchableOpacity style={styles.waitBtn} onPress={onWaitForMe}>
          <Text style={styles.waitBtnText}>⏱ Running late? Notify driver</Text>
        </TouchableOpacity>
      )}

      {isStale && (
        <Text style={styles.staleLabel}>Cached data — offline</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card:      { borderRadius: 16, padding: 16, marginBottom: 16 },
  row:       { flexDirection: 'row', alignItems: 'center' },
  emoji:     { fontSize: 32, marginRight: 12 },
  textCol:   { flex: 1 },
  title:     { fontSize: 17, fontWeight: '700' },
  subtitle:  { fontSize: 13, color: '#6b7280', marginTop: 2 },
  waitBtn:   { marginTop: 12, padding: 10, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 8, alignItems: 'center' },
  waitBtnText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  staleLabel: { fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'right' },
})
```

---

### CheckInButton — `components/student/CheckInButton.tsx`

```typescript
// components/student/CheckInButton.tsx
// 6 states. The most important UI component in the system.

import { useRef, useEffect } from 'react'
import { TouchableOpacity, Text, StyleSheet, Animated } from 'react-native'
import { useRouter } from 'expo-router'
import { StudentHome } from '../../hooks/useStudentHome'

type CheckInState =
  | 'inactive'      // no trip or trip not started
  | 'active'        // trip active, not checked in → pulsing green
  | 'checked_in'    // already checked in
  | 'window_closed' // trip ended, not checked in
  | 'self_arranged' // skip today was used
  | 'loading'       // data loading

const getState = (home: StudentHome | undefined, isLoading: boolean): CheckInState => {
  if (isLoading || !home) return 'loading'
  if (!home.trip || home.trip.status === 'SCHEDULED') return 'inactive'
  if (home.trip.status === 'COMPLETED' || home.trip.status === 'CANCELLED') {
    if (home.checkin.status === 'SELF_ARRANGED') return 'self_arranged'
    return 'window_closed'
  }
  if (home.checkin.status === 'PRESENT')       return 'checked_in'
  if (home.checkin.status === 'SELF_ARRANGED') return 'self_arranged'
  if (home.trip.status === 'ACTIVE')           return 'active'
  return 'inactive'
}

type Props = {
  home:      StudentHome | undefined
  isLoading: boolean
}

export const CheckInButton = ({ home, isLoading }: Props) => {
  const state = getState(home, isLoading)
  const router = useRouter()
  const pulse = useRef(new Animated.Value(1)).current

  // Pulsing animation when active
  useEffect(() => {
    if (state !== 'active') {
      pulse.setValue(1)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [state])

  const config = {
    loading:       { label: '...',               bg: '#e5e7eb', text: '#9ca3af', disabled: true },
    inactive:      { label: 'Trip not started',  bg: '#e5e7eb', text: '#9ca3af', disabled: true },
    active:        { label: '📷  Scan to Check In', bg: '#16a34a', text: '#fff', disabled: false },
    checked_in:    { label: '✓  Checked In',     bg: '#dcfce7', text: '#166534', disabled: true },
    window_closed: { label: 'Window Closed',      bg: '#f3f4f6', text: '#9ca3af', disabled: true },
    self_arranged: { label: 'Marked — Not taking bus', bg: '#fef9c3', text: '#854d0e', disabled: true },
  }[state]

  return (
    <>
      <Animated.View style={{ transform: [{ scale: state === 'active' ? pulse : 1 }] }}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: config.bg }]}
          onPress={() => router.push('/(student)/scanner')}
          disabled={config.disabled}
          activeOpacity={0.85}
        >
          <Text style={[styles.label, { color: config.text }]}>
            {config.label}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {state === 'window_closed' && (
        <TouchableOpacity
          style={styles.correctionLink}
          onPress={() => router.push('/(student)/correction')}
        >
          <Text style={styles.correctionText}>Did you board? Raise a correction →</Text>
        </TouchableOpacity>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  button:         { borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 8 },
  label:          { fontSize: 18, fontWeight: '700' },
  correctionLink: { alignItems: 'center', padding: 8 },
  correctionText: { fontSize: 13, color: '#6b7280', textDecorationLine: 'underline' },
})
```

---

### QR Scanner — `app/(student)/scanner.tsx`

```typescript
// app/(student)/scanner.tsx

import { useState, useEffect } from 'react'
import { View, Text, StyleSheet, Alert, TouchableOpacity, ActivityIndicator } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import { useCheckin } from '../../hooks/useCheckin'

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const router = useRouter()
  const { submitCheckin, isSubmitting } = useCheckin()

  useEffect(() => {
    if (!permission?.granted) requestPermission()
  }, [])

  const handleBarCodeScanned = async ({ data: qrToken }: { data: string }) => {
    if (scanned || isSubmitting) return
    setScanned(true)

    // Get student location for geofence check
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert(
        'Location needed',
        'The app needs your location to verify you are near the bus.',
        [{ text: 'OK', onPress: () => setScanned(false) }]
      )
      return
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High
    })

    // Warn if GPS accuracy is poor
    if (location.coords.accuracy && location.coords.accuracy > 50) {
      Alert.alert(
        'Weak GPS signal',
        `GPS accuracy is ${Math.round(location.coords.accuracy)}m. Move to an open area for better accuracy.`,
        [
          { text: 'Try anyway', onPress: () => doSubmit(qrToken, location) },
          { text: 'Cancel', onPress: () => setScanned(false) }
        ]
      )
      return
    }

    await doSubmit(qrToken, location)
  }

  const doSubmit = async (qrToken: string, location: Location.LocationObject) => {
    const result = await submitCheckin({
      qrToken,
      studentLat: location.coords.latitude,
      studentLon: location.coords.longitude,
    })

    if (result.success) {
      router.replace('/(student)/checkin-success')
    } else {
      router.replace({
        pathname: '/(student)/checkin-fail',
        params: { reason: result.error }
      })
    }
  }

  if (!permission?.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>Camera access needed to scan QR code</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />

      {/* Scanning overlay */}
      <View style={styles.overlay}>
        <View style={styles.scanBox} />
        <Text style={styles.instruction}>
          {isSubmitting ? 'Verifying...' : 'Point camera at the driver\'s screen'}
        </Text>
      </View>

      {isSubmitting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#000' },
  center:         { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  permText:       { fontSize: 16, textAlign: 'center', marginBottom: 16, color: '#374151' },
  permBtn:        { backgroundColor: '#1E3A8A', padding: 14, borderRadius: 10, paddingHorizontal: 24 },
  permBtnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  overlay:        { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanBox:        { width: 260, height: 260, borderWidth: 2, borderColor: '#16a34a', borderRadius: 16, backgroundColor: 'transparent' },
  instruction:    { color: '#fff', marginTop: 24, fontSize: 15, backgroundColor: 'rgba(0,0,0,0.6)', padding: 12, borderRadius: 8, textAlign: 'center' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  cancelBtn:      { position: 'absolute', bottom: 50, alignSelf: 'center', padding: 14 },
  cancelText:     { color: '#fff', fontSize: 16, fontWeight: '600' },
})
```

---

### useCheckin hook — with offline queue

```typescript
// hooks/useCheckin.ts

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../lib/api.client'
import { offlineQueue } from '../lib/offline-queue'
import { useNetworkStatus } from './useNetworkStatus'

interface CheckinPayload {
  qrToken:    string
  studentLat: number
  studentLon: number
}

const ERROR_MESSAGES: Record<string, string> = {
  QR_ALREADY_USED:      'QR code already scanned. Ask driver for the next code.',
  TRIP_NOT_ACTIVE:      'Trip has ended or not started.',
  ROUTE_MISMATCH:       'This is not your assigned bus.',
  TOO_FAR:              'You are too far from the bus. Move closer and try again.',
  ALREADY_CHECKED_IN:   'You are already checked in today.',
  RATE_LIMITED:         'Too many attempts. Wait 1 minute.',
  DEVICE_MISMATCH:      'Check-in must be done from your registered device.',
}

export const useCheckin = () => {
  const { isOnline } = useNetworkStatus()
  const queryClient = useQueryClient()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submitCheckin = async (payload: CheckinPayload): Promise<
    { success: true } | { success: false; error: string }
  > => {
    setIsSubmitting(true)

    try {
      if (!isOnline) {
        // Queue for when network returns
        await offlineQueue.add('checkin', payload)
        // Optimistically update UI
        queryClient.setQueryData(['student-home'], (old: any) => ({
          ...old,
          checkin: { status: 'PENDING', checkedInAt: null, isQueued: true }
        }))
        return { success: true }
      }

      const response = await apiClient.post('/v1/attendance/check-in', payload)

      if (response.data.status === 'ALREADY_CHECKED_IN') {
        // Idempotent — already done
        queryClient.invalidateQueries({ queryKey: ['student-home'] })
        return { success: true }
      }

      // Invalidate home query → re-fetch shows PRESENT status
      queryClient.invalidateQueries({ queryKey: ['student-home'] })
      return { success: true }

    } catch (err: any) {
      const errorCode = err.response?.data?.error ?? 'UNKNOWN_ERROR'
      const userMessage = ERROR_MESSAGES[errorCode] ?? 'Check-in failed. Please try again.'
      return { success: false, error: userMessage }
    } finally {
      setIsSubmitting(false)
    }
  }

  return { submitCheckin, isSubmitting }
}
```

---

### Driver Kiosk — `app/(driver)/kiosk.tsx`

```typescript
// app/(driver)/kiosk.tsx
// Full screen. No tab bar. Phone becomes check-in terminal.

import { useEffect, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert
} from 'react-native'
import QRCode from 'react-native-qrcode-svg'
import * as KeepAwake from 'expo-keep-awake'
import * as Brightness from 'expo-brightness'
import { useRouter } from 'expo-router'
import { useTripStore } from '../../store/trip.store'
import { useKioskSocket } from '../../hooks/useKioskSocket'
import { StudentListRow } from '../../components/driver/StudentListRow'
import { WaitRequestBanner } from '../../components/driver/WaitRequestBanner'
import { AdminMessageBar } from '../../components/driver/AdminMessageBar'
import { CheckInToast } from '../../components/driver/CheckInToast'
import { startGPSBroadcast } from '../../tasks/gps.task'

export default function KioskScreen() {
  const router = useRouter()
  const {
    tripId, qrToken, currentStop, currentStopIndex,
    students, waitRequests, checkedInCount, totalCount,
    urgentMessage, lastCheckedInName,
  } = useTripStore()

  // Socket.io: receive QR refresh + check-in events from backend
  useKioskSocket()

  // Screen management
  useEffect(() => {
    KeepAwake.activateKeepAwakeAsync()
    Brightness.setBrightnessAsync(1.0)

    return () => {
      KeepAwake.deactivateKeepAwake()
      Brightness.restoreSystemBrightnessAsync()
    }
  }, [])

  // GPS broadcast starts when kiosk opens
  useEffect(() => {
    startGPSBroadcast()
  }, [])

  const handleEndTrip = () => {
    Alert.alert(
      'End Trip',
      `${checkedInCount} students checked in, ${totalCount - checkedInCount} absent. Confirm end trip?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Trip', style: 'destructive', onPress: () => router.push('/(driver)/summary') }
      ]
    )
  }

  return (
    <View style={styles.container}>
      {/* Urgent message from admin */}
      {urgentMessage && <AdminMessageBar message={urgentMessage} />}

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.stopLabel}>Current stop</Text>
          <Text style={styles.stopName}>{currentStop}</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{checkedInCount}</Text>
          <Text style={styles.countTotal}>/{totalCount}</Text>
        </View>
      </View>

      {/* Wait-for-me banners */}
      {waitRequests.map(req => (
        <WaitRequestBanner key={req.studentId} request={req} />
      ))}

      {/* QR Code — maximum size */}
      <View style={styles.qrContainer}>
        {qrToken ? (
          <QRCode
            value={qrToken}
            size={220}
            color="#000000"
            backgroundColor="#ffffff"
            quietZone={10}
          />
        ) : (
          <View style={styles.qrPlaceholder}>
            <Text style={styles.qrPlaceholderText}>Generating QR...</Text>
          </View>
        )}
        <Text style={styles.scanLabel}>Students — scan to check in</Text>
      </View>

      {/* Check-in toast */}
      {lastCheckedInName && <CheckInToast name={lastCheckedInName} />}

      {/* Student list */}
      <FlatList
        data={students}
        keyExtractor={s => s.id}
        renderItem={({ item }) => <StudentListRow student={item} />}
        style={styles.list}
        showsVerticalScrollIndicator={false}
      />

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.breakdownBtn}
          onPress={() => router.push('/(driver)/breakdown')}
        >
          <Text style={styles.breakdownBtnText}>🚨 Breakdown</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.endTripBtn}
          onPress={handleEndTrip}
        >
          <Text style={styles.endTripBtnText}>End Trip</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#fff', paddingTop: 48 },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  stopLabel:          { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },
  stopName:           { fontSize: 20, fontWeight: '700', color: '#111' },
  countBadge:         { flexDirection: 'row', alignItems: 'baseline' },
  countText:          { fontSize: 32, fontWeight: '800', color: '#16a34a' },
  countTotal:         { fontSize: 18, color: '#6b7280', fontWeight: '500' },
  qrContainer:        { alignItems: 'center', paddingVertical: 16, backgroundColor: '#f9fafb', marginHorizontal: 16, borderRadius: 16 },
  qrPlaceholder:      { width: 220, height: 220, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e5e7eb', borderRadius: 8 },
  qrPlaceholderText:  { color: '#9ca3af', fontSize: 14 },
  scanLabel:          { marginTop: 8, fontSize: 13, color: '#6b7280' },
  list:               { flex: 1, marginTop: 8 },
  actions:            { flexDirection: 'row', padding: 16, gap: 12, paddingBottom: 32 },
  breakdownBtn:       { flex: 1, backgroundColor: '#fef2f2', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#fecaca' },
  breakdownBtnText:   { color: '#dc2626', fontWeight: '700', fontSize: 15 },
  endTripBtn:         { flex: 1, backgroundColor: '#1E3A8A', borderRadius: 12, padding: 14, alignItems: 'center' },
  endTripBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },
})
```

---

### useKioskSocket hook

```typescript
// hooks/useKioskSocket.ts

import { useEffect } from 'react'
import { socket } from '../lib/socket'
import { useTripStore } from '../store/trip.store'

export const useKioskSocket = () => {
  const {
    tripId, setQrToken, markStudentPresent,
    addWaitRequest, setUrgentMessage, setLastCheckedIn
  } = useTripStore()

  useEffect(() => {
    if (!tripId) return

    // Join the trip room
    socket.emit('join_trip_room', tripId)

    // New QR after successful scan — refresh immediately
    socket.on('qr:refresh', (newToken: string) => {
      setQrToken(newToken)
    })

    // Student checked in
    socket.on('checkin:success', (data: { userId: string, name: string }) => {
      markStudentPresent(data.userId)
      setLastCheckedIn(data.name)
    })

    // Student sent wait-for-me
    socket.on('wait:request', (data: { studentId: string, studentName: string, etaMinutes: number }) => {
      addWaitRequest(data)
    })

    // Urgent message from admin
    socket.on('admin:message', (data: { body: string, isUrgent: boolean }) => {
      if (data.isUrgent) setUrgentMessage(data.body)
    })

    return () => {
      socket.off('qr:refresh')
      socket.off('checkin:success')
      socket.off('wait:request')
      socket.off('admin:message')
      socket.emit('leave_trip_room', tripId)
    }
  }, [tripId])
}
```

---

### Background GPS task — `tasks/gps.task.ts`

```typescript
// tasks/gps.task.ts

import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import database from '@react-native-firebase/database'
import { useAuthStore } from '../store/auth.store'
import { useTripStore } from '../store/trip.store'

export const GPS_TASK = 'BACKGROUND_GPS'
const MIN_DISTANCE_METRES = 5  // delta compression — skip if not moved

let lastLat = 0, lastLon = 0

TaskManager.defineTask(GPS_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.length) return

  const loc = data.locations[0]
  const { latitude: lat, longitude: lon } = loc.coords

  // Delta compression — don't write if bus barely moved
  const dx = Math.abs(lat - lastLat) * 111_000
  const dy = Math.abs(lon - lastLon) * 111_000 * Math.cos(lat * Math.PI / 180)
  if (Math.sqrt(dx*dx + dy*dy) < MIN_DISTANCE_METRES) return

  lastLat = lat; lastLon = lon

  const authState  = useAuthStore.getState()
  const tripState  = useTripStore.getState()
  const busId      = authState.user?.routeAssignment?.busId
  const token      = authState.token

  if (!busId || !token) return

  const payload = {
    busId,
    tripId:    tripState.tripId ?? undefined,
    lat,
    lon,
    speed:     (loc.coords.speed ?? 0) * 3.6,    // m/s → km/h
    heading:   loc.coords.heading ?? 0,
    accuracy:  loc.coords.accuracy ?? 0,
    timestamp: loc.timestamp,
  }

  // 1. Write to Firebase RTDB immediately (students see live map)
  try {
    await database()
      .ref(`/buses/${busId}`)
      .set({
        lat, lon,
        speed:       payload.speed,
        heading:     payload.heading,
        lastUpdated: payload.timestamp,
        gpsStatus:   'LIVE',
      })
  } catch (err) {
    // Firebase failure — don't block backend write
    console.error('[GPS] Firebase RTDB write failed', err)
  }

  // 2. Write to backend (GPS logs for history + college gate geofence check)
  try {
    await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/gps/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    // Backend failure — Firebase RTDB still has live position
    console.error('[GPS] Backend ping failed', err)
  }
})

export const startGPSBroadcast = async () => {
  const { status } = await Location.requestBackgroundPermissionsAsync()
  if (status !== 'granted') throw new Error('Background location permission required')

  const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK)
  if (isRunning) return  // Already running

  await Location.startLocationUpdatesAsync(GPS_TASK, {
    accuracy:          Location.Accuracy.High,
    timeInterval:      3_000,   // every 3 seconds
    distanceInterval:  5,       // or every 5 metres
    foregroundService: {
      notificationTitle: 'Bus tracking active',
      notificationBody:  'Your location is being shared with students',
      notificationColor: '#1E3A8A',
    },
    pausesUpdatesAutomatically: false,
  })
}

export const stopGPSBroadcast = async () => {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK)
  if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK)
}
```

---

## 4. Admin Panel

### Complete file structure

```
apps/admin/src/
├── pages/
│   ├── auth/
│   │   ├── Login.tsx
│   │   ├── ForgotPassword.tsx
│   │   └── ResetPassword.tsx
│   ├── dashboard/
│   │   └── index.tsx            ← live ops: stats + fleet map + alerts
│   ├── attendance/
│   │   ├── index.tsx            ← attendance table with filters
│   │   └── corrections.tsx      ← correction queue
│   ├── students/
│   │   ├── index.tsx            ← student list
│   │   └── bulk-import.tsx
│   ├── routes/
│   │   ├── index.tsx
│   │   └── editor.tsx           ← route editor
│   ├── drivers/
│   │   └── index.tsx
│   ├── incidents/
│   │   └── index.tsx
│   ├── fleet/
│   │   └── index.tsx            ← all buses live
│   └── messages/
│       └── index.tsx
│
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── AlertBell.tsx
│   ├── dashboard/
│   │   ├── StatsBar.tsx
│   │   ├── FleetMap.tsx         ← Google Maps, 180 buses
│   │   ├── AlertFeed.tsx
│   │   └── BusDetailPanel.tsx
│   ├── attendance/
│   │   ├── AttendanceTable.tsx
│   │   ├── CorrectionCard.tsx
│   │   └── StatusBadge.tsx
│   └── shared/
│       ├── DataTable.tsx
│       ├── FilterBar.tsx
│       └── ExportButton.tsx
│
├── hooks/
│   ├── useAdminAuth.ts
│   ├── useFleetSocket.ts        ← Socket.io all buses
│   ├── useLiveAlerts.ts
│   ├── useDashboardStats.ts
│   ├── useAttendance.ts
│   └── useCorrections.ts
│
├── store/
│   ├── fleet.store.ts           ← Zustand: all bus positions
│   └── alerts.store.ts          ← Zustand: pending alerts
│
└── lib/
    ├── api.client.ts
    ├── socket.ts
    └── query-client.ts
```

---

### Admin Login — `pages/auth/Login.tsx`

```typescript
// pages/auth/Login.tsx

import { useState, FormEvent } from 'react'
import { adminApiClient } from '../../lib/api.client'
import { useNavigate } from 'react-router-dom'

export default function AdminLogin() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]        = useState('')
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Backend sets httpOnly cookie in response
      // withCredentials: true means browser stores it automatically
      await adminApiClient.post('/v1/admin/auth/login', { email, password })
      navigate('/dashboard')
    } catch (err: any) {
      const code = err.response?.data?.error
      const messages: Record<string, string> = {
        INVALID_CREDENTIALS:        'Incorrect email or password.',
        ACCOUNT_TEMPORARILY_LOCKED: 'Account locked. Try again in 15 minutes.',
        ACCOUNT_DISABLED:           'Account disabled. Contact your administrator.',
      }
      setError(messages[code] ?? 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🚌</div>
          <h1 className="text-2xl font-bold text-gray-900">Transport Admin</h1>
          <p className="text-gray-500 mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@college.edu"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-900 text-white rounded-lg py-3 font-semibold text-sm hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <a
            href="/forgot-password"
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Forgot password?
          </a>
        </div>
      </div>
    </div>
  )
}
```

---

### Admin Dashboard — `pages/dashboard/index.tsx`

```typescript
// pages/dashboard/index.tsx

import { StatsBar }       from '../../components/dashboard/StatsBar'
import { FleetMap }       from '../../components/dashboard/FleetMap'
import { AlertFeed }      from '../../components/dashboard/AlertFeed'
import { BusDetailPanel } from '../../components/dashboard/BusDetailPanel'
import { useFleetSocket } from '../../hooks/useFleetSocket'
import { useDashboardStats } from '../../hooks/useDashboardStats'
import { useAlertsStore } from '../../store/alerts.store'
import { useState } from 'react'

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats()
  const [selectedBusId, setSelectedBusId]         = useState<string | null>(null)
  const alerts = useAlertsStore(s => s.alerts)

  // Connects to Socket.io admin room — receives all fleet updates
  useFleetSocket()

  return (
    <div className="h-full flex flex-col">
      {/* Stats bar */}
      <div className="flex-none p-4 pb-0">
        <StatsBar stats={stats} isLoading={statsLoading} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex gap-4 p-4 min-h-0">
        {/* Fleet map — takes most space */}
        <div className="flex-1 relative">
          <FleetMap
            onBusClick={setSelectedBusId}
            selectedBusId={selectedBusId}
          />
        </div>

        {/* Right panel: alerts + bus detail */}
        <div className="w-80 flex flex-col gap-4 min-h-0">
          {selectedBusId && (
            <BusDetailPanel
              busId={selectedBusId}
              onClose={() => setSelectedBusId(null)}
            />
          )}
          <div className="flex-1 min-h-0 overflow-auto">
            <AlertFeed alerts={alerts} />
          </div>
        </div>
      </div>
    </div>
  )
}
```

---

## 5. Map Architecture

### The fleet map — `components/dashboard/FleetMap.tsx`

```typescript
// components/dashboard/FleetMap.tsx
// All 180 buses on one Google Map. Real-time positions via Zustand.
// Bus markers rotate to face direction of travel.
// Click bus → side panel.

import { useEffect, useRef, useCallback } from 'react'
import { useFleetStore } from '../../store/fleet.store'

interface Props {
  onBusClick:    (busId: string) => void
  selectedBusId: string | null
}

export const FleetMap = ({ onBusClick, selectedBusId }: Props) => {
  const mapRef      = useRef<HTMLDivElement>(null)
  const googleMap   = useRef<google.maps.Map | null>(null)
  const markers     = useRef<Map<string, google.maps.Marker>>(new Map())
  const infoWindows = useRef<Map<string, google.maps.InfoWindow>>(new Map())
  const buses       = useFleetStore(s => s.buses)

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || googleMap.current) return

    googleMap.current = new google.maps.Map(mapRef.current, {
      center: { lat: 12.9716, lng: 80.2209 },  // College coordinates
      zoom:   13,
      mapId:  import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,  // Custom map style
      disableDefaultUI: false,
      fullscreenControl: true,
      zoomControl: true,
      streetViewControl: false,
    })
  }, [])

  // Update markers when bus positions change (Zustand reactive)
  useEffect(() => {
    if (!googleMap.current) return

    buses.forEach((bus) => {
      const existingMarker = markers.current.get(bus.busId)

      const color =
        bus.gpsStatus === 'OFFLINE' ? '#dc2626' :
        bus.gpsStatus === 'STALE'   ? '#d97706' :
        bus.isLate                  ? '#d97706' :
        '#16a34a'

      if (existingMarker) {
        // Animate marker to new position smoothly
        animateMarker(existingMarker, existingMarker.getPosition()!, { lat: bus.lat, lng: bus.lon })
        // Rotate icon to face heading
        existingMarker.setIcon(createBusIcon(color, bus.heading, bus.busId === selectedBusId))
      } else {
        // Create new marker
        const marker = new google.maps.Marker({
          position: { lat: bus.lat, lng: bus.lon },
          map:      googleMap.current!,
          icon:     createBusIcon(color, bus.heading, false),
          title:    bus.busNumber,
          optimized: true,  // batches DOM updates for performance
        })

        marker.addListener('click', () => onBusClick(bus.busId))
        markers.current.set(bus.busId, marker)
      }
    })

    // Remove markers for buses that are no longer active
    markers.current.forEach((marker, busId) => {
      if (!buses.find(b => b.busId === busId)) {
        marker.setMap(null)
        markers.current.delete(busId)
      }
    })
  }, [buses, selectedBusId])

  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: '100%', borderRadius: '12px' }}
    />
  )
}

// Custom bus icon — rotated SVG arrow
const createBusIcon = (
  color: string,
  heading: number,
  isSelected: boolean
): google.maps.Symbol => ({
  path: 'M 0 -20 L 10 10 L 0 5 L -10 10 Z',  // Arrow pointing up
  fillColor:    color,
  fillOpacity:  1,
  strokeColor:  isSelected ? '#fff' : 'transparent',
  strokeWeight: isSelected ? 3 : 0,
  scale:        isSelected ? 1.4 : 1.2,
  rotation:     heading,  // rotates to face direction of travel
  anchor:       new google.maps.Point(0, 0),
})

// Smooth marker animation between positions
const animateMarker = (
  marker: google.maps.Marker,
  from: google.maps.LatLng,
  to: { lat: number, lng: number },
  steps = 20
) => {
  let step = 0
  const latStep = (to.lat - from.lat()) / steps
  const lngStep = (to.lng - from.lng()) / steps

  const animate = () => {
    step++
    marker.setPosition({
      lat: from.lat() + latStep * step,
      lng: from.lng() + lngStep * step,
    })
    if (step < steps) requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}
```

### Student live map — `app/(student)/map.tsx`

```typescript
// app/(student)/map.tsx
// Student sees their assigned bus moving live.
// Firebase RTDB subscription + client-side interpolation.

import { useEffect, useRef } from 'react'
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps'
import { View, Text, StyleSheet } from 'react-native'
import { useAuthStore } from '../../store/auth.store'
import { useLiveBus } from '../../hooks/useLiveBus'
import { useStudentHome } from '../../hooks/useStudentHome'

export default function MapScreen() {
  const { user }  = useAuthStore()
  const busId     = user?.routeAssignment?.busId ?? null
  const { data: home } = useStudentHome()

  const { busLocation, gpsStatus, isStale } = useLiveBus(busId)
  const mapRef = useRef<MapView>(null)
  const animatedPos = useRef({ lat: 0, lon: 0 })
  const interpolation = useRef<NodeJS.Timeout | null>(null)

  // Client-side interpolation for smooth movement
  useEffect(() => {
    if (!busLocation) return

    const targetLat = busLocation.lat
    const targetLon = busLocation.lon
    const speed     = busLocation.speed   // km/h
    const heading   = busLocation.heading

    // Clear previous interpolation
    if (interpolation.current) clearInterval(interpolation.current)

    // Predict position based on speed + heading
    // Move from current animated position toward actual GPS position
    const STEPS = 20  // smooth over 1 second
    const INTERVAL = 50  // ms

    let step = 0
    const fromLat = animatedPos.current.lat || targetLat
    const fromLon = animatedPos.current.lon || targetLon

    interpolation.current = setInterval(() => {
      step++
      animatedPos.current = {
        lat: fromLat + (targetLat - fromLat) * (step / STEPS),
        lon: fromLon + (targetLon - fromLon) * (step / STEPS),
      }
      // Force re-render with new position
      if (step >= STEPS) clearInterval(interpolation.current!)
    }, INTERVAL)

    return () => {
      if (interpolation.current) clearInterval(interpolation.current)
    }
  }, [busLocation?.lat, busLocation?.lon])

  const region = {
    latitude:        busLocation?.lat ?? 12.9716,
    longitude:       busLocation?.lon ?? 80.2209,
    latitudeDelta:   0.05,
    longitudeDelta:  0.05,
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
      >
        {/* Animated bus marker */}
        {animatedPos.current.lat !== 0 && (
          <Marker
            coordinate={{
              latitude:  animatedPos.current.lat,
              longitude: animatedPos.current.lon,
            }}
            title={`Bus ${user?.routeAssignment?.busNumber}`}
            description={gpsStatus === 'OFFLINE' ? 'GPS offline' : 'Live'}
            rotation={busLocation?.heading ?? 0}
          >
            <View style={[styles.busMarker, gpsStatus === 'OFFLINE' && styles.busMarkerOffline]}>
              <Text style={styles.busMarkerText}>🚌</Text>
            </View>
          </Marker>
        )}

        {/* Route stops */}
        {home?.trip && (
          <Marker
            coordinate={{ latitude: 12.9716, longitude: 80.2209 }}
            title={user?.routeAssignment?.stopName}
            pinColor="#1E3A8A"
          />
        )}
      </MapView>

      {/* GPS status overlay */}
      {gpsStatus !== 'LIVE' && (
        <View style={styles.gpsStatusBanner}>
          <Text style={styles.gpsStatusText}>
            {gpsStatus === 'OFFLINE' ? '⚠️ GPS signal lost — last known position' : '⚡ GPS signal weak'}
          </Text>
        </View>
      )}

      {/* ETA card */}
      <View style={styles.etaCard}>
        <Text style={styles.etaRoute}>{user?.routeAssignment?.routeName}</Text>
        <Text style={styles.etaStop}>Your stop: {user?.routeAssignment?.stopName}</Text>
        {busLocation?.eta && (
          <Text style={styles.etaTime}>Arrives in ~{busLocation.eta} min</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container:         { flex: 1 },
  busMarker:         { backgroundColor: '#1E3A8A', borderRadius: 20, padding: 4 },
  busMarkerOffline:  { backgroundColor: '#dc2626' },
  busMarkerText:     { fontSize: 20 },
  gpsStatusBanner:   { position: 'absolute', top: 60, left: 16, right: 16, backgroundColor: '#fef3c7', padding: 10, borderRadius: 8, alignItems: 'center' },
  gpsStatusText:     { fontSize: 13, color: '#92400e', fontWeight: '500' },
  etaCard:           { position: 'absolute', bottom: 40, left: 16, right: 16, backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
  etaRoute:          { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 2 },
  etaStop:           { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  etaTime:           { fontSize: 15, color: '#16a34a', fontWeight: '700' },
})
```

---

## 6. Realtime Architecture

### Firebase RTDB — useLiveBus hook

```typescript
// hooks/useLiveBus.ts
// Subscribes to one bus. Auto-switches when substitute bus assigned.

import { useState, useEffect, useRef } from 'react'
import database from '@react-native-firebase/database'

interface BusLocation {
  lat:         number
  lon:         number
  speed:       number
  heading:     number
  lastUpdated: number
  gpsStatus:   'LIVE' | 'STALE' | 'OFFLINE'
  eta?:        number  // minutes to student's stop
}

export const useLiveBus = (busId: string | null) => {
  const [busLocation, setBusLocation] = useState<BusLocation | null>(null)
  const prevBusId   = useRef<string | null>(null)
  const unsubscribe = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!busId || busId === prevBusId.current) return

    // Clean up previous subscription
    unsubscribe.current?.()

    // Firebase persistence means this works offline with last known data
    const ref     = database().ref(`/buses/${busId}`)
    const handler = ref.on('value', snapshot => {
      const data = snapshot.val()
      if (data) setBusLocation(data)
    })

    unsubscribe.current = () => ref.off('value', handler)
    prevBusId.current = busId

    return () => unsubscribe.current?.()
  }, [busId])

  const isStale = busLocation
    ? Date.now() - busLocation.lastUpdated > 90_000  // 90s stale threshold
    : false

  const computedGpsStatus =
    isStale         ? 'OFFLINE' :
    !busLocation    ? 'UNKNOWN' :
    busLocation.gpsStatus ?? 'LIVE'

  return { busLocation, gpsStatus: computedGpsStatus, isStale }
}
```

### Socket.io singleton — `lib/socket.ts`

```typescript
// apps/mobile/lib/socket.ts

import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '../store/auth.store'

let _socket: Socket | null = null

export const getSocket = (): Socket => {
  if (_socket?.connected) return _socket

  const token = useAuthStore.getState().token

  _socket = io(process.env.EXPO_PUBLIC_API_URL!, {
    auth:         { token },
    transports:   ['websocket'],   // skip polling — mobile always supports WS
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay:    1_000,
    reconnectionDelayMax: 10_000,
    timeout:              5_000,
  })

  _socket.on('connect', () => {
    console.log('[Socket] Connected:', _socket?.id)
  })

  _socket.on('disconnect', (reason) => {
    console.log('[Socket] Disconnected:', reason)
  })

  _socket.on('connect_error', (err) => {
    console.error('[Socket] Connection error:', err.message)
  })

  return _socket
}

export const socket = new Proxy({} as Socket, {
  get: (_, prop) => (getSocket() as any)[prop],
})
```

### Admin Socket.io — fleet updates

```typescript
// apps/admin/src/hooks/useFleetSocket.ts

import { useEffect } from 'react'
import { io } from 'socket.io-client'
import { useFleetStore } from '../store/fleet.store'
import { useAlertsStore } from '../store/alerts.store'

export const useFleetSocket = () => {
  const { updateBus, setFleet } = useFleetStore()
  const { addAlert } = useAlertsStore()

  useEffect(() => {
    const socket = io(import.meta.env.VITE_API_URL, {
      withCredentials: true,  // sends admin_jwt cookie
      transports: ['websocket'],
    })

    socket.emit('join_admin_room')

    // Individual bus GPS position update
    socket.on('gps:position', (data: {
      busId:     string
      busNumber: string
      lat:       number
      lon:       number
      speed:     number
      heading:   number
      gpsStatus: string
      isLate:    boolean
    }) => {
      updateBus(data)
    })

    // GPS status change (LIVE → STALE → OFFLINE)
    socket.on('gps:status', (data: { busId: string, status: string }) => {
      updateBus({ busId: data.busId, gpsStatus: data.status })
      if (data.status === 'OFFLINE') {
        addAlert({ type: 'GPS_OFFLINE', busId: data.busId, timestamp: Date.now() })
      }
    })

    // Check-in event — update dashboard stats
    socket.on('checkin:success', (data: { tripId: string, userId: string }) => {
      // TanStack Query will refetch dashboard stats
    })

    // New breakdown incident
    socket.on('incident:reported', (data: any) => {
      addAlert({ type: 'BREAKDOWN', ...data, timestamp: Date.now() })
    })

    // Late start alert
    socket.on('trip:late-start', (data: any) => {
      addAlert({ type: 'LATE_START', ...data, timestamp: Date.now() })
    })

    return () => {
      socket.disconnect()
    }
  }, [])
}
```

---

## 7. Offline Strategy

### Offline queue — `lib/offline-queue.ts`

```typescript
// apps/mobile/lib/offline-queue.ts
// Queues check-in attempts when offline. Flushes automatically on reconnect.

import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { apiClient } from './api.client'

const QUEUE_KEY = 'offline_checkin_queue'

interface QueuedAction {
  id:        string
  type:      'checkin'
  payload:   any
  queuedAt:  number
  attempts:  number
}

export const offlineQueue = {
  async add(type: 'checkin', payload: any) {
    const existing = await this.getAll()
    const item: QueuedAction = {
      id:       Math.random().toString(36).slice(2),
      type,
      payload,
      queuedAt: Date.now(),
      attempts: 0,
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...existing, item]))
  },

  async getAll(): Promise<QueuedAction[]> {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  },

  async flush() {
    const items = await this.getAll()
    if (items.length === 0) return

    const remaining: QueuedAction[] = []

    for (const item of items) {
      // Drop items older than 2 hours — window has definitely closed
      if (Date.now() - item.queuedAt > 2 * 60 * 60 * 1000) continue

      try {
        if (item.type === 'checkin') {
          await apiClient.post('/v1/attendance/check-in', {
            ...item.payload,
            isReplay: true  // tells backend this is a replay — logs it differently
          })
        }
        // Success — don't add back to queue
      } catch (err: any) {
        item.attempts++
        if (item.attempts < 3) {
          remaining.push(item)  // retry up to 3 times
        }
        // After 3 failures: drop. Student will need to file correction.
      }
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining))
  },

  setupAutoFlush() {
    // Flush queue when network comes back online
    NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        this.flush()
      }
    })
  }
}
```

---

## 8. Performance Optimization

### TanStack Query — prefetching on app open

```typescript
// apps/mobile/lib/prefetch.ts
// Prefetch critical data the moment user opens the app
// So screens appear instantly with real data

export const prefetchOnAppOpen = async (queryClient: QueryClient) => {
  // Always prefetch home — it's the first screen
  await queryClient.prefetchQuery({
    queryKey: ['student-home'],
    queryFn:  () => apiClient.get('/v1/student/home').then(r => r.data.data),
    staleTime: 30_000,
  })
}
```

### List virtualization — attendance history

```typescript
// hooks/useAttendanceHistory.ts
// Infinite scroll — load 20 at a time, not all at once

import { useInfiniteQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api.client'

export const useAttendanceHistory = () => {
  return useInfiniteQuery({
    queryKey:       ['attendance-history'],
    queryFn:        ({ pageParam = 1 }) =>
      apiClient.get('/v1/attendance/history', { params: { page: pageParam, limit: 20 } })
        .then(r => r.data),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.pages
        ? last.pagination.page + 1
        : undefined,
    initialPageParam: 1,
  })
}

// Usage in component: FlatList with onEndReached → fetchNextPage
// Renders only visible rows — critical for students with 100+ history items
```

### Memo and callback optimization

```typescript
// components/dashboard/FleetMap.tsx admin

// Bus markers are expensive — wrap in React.memo
const BusMarker = React.memo(({ bus }: { bus: BusData }) => (
  // marker JSX
), (prev, next) => {
  // Only re-render if position or status changed
  return prev.bus.lat === next.bus.lat &&
         prev.bus.lon === next.bus.lon &&
         prev.bus.gpsStatus === next.bus.gpsStatus
})

// Zustand fleet store — only subscribe to specific bus to avoid re-renders
const busPosition = useFleetStore(
  useCallback(s => s.buses.find(b => b.busId === busId), [busId])
)
```

### Image/asset optimization

```typescript
// app.json — expo config
{
  "expo": {
    "assetBundlePatterns": ["**/*"],
    "web": {
      "bundler": "metro"
    },
    "extra": {
      "eas": {
        "projectId": "..."
      }
    }
  }
}

// Use expo-image instead of Image for caching + performance
import { Image } from 'expo-image'
<Image
  source={{ uri: avatarUrl }}
  placeholder={blurhash}
  contentFit="cover"
  transition={200}
  cachePolicy="memory-disk"
/>
```

---

## 9. State Management

### What lives where — the rule

```
Zustand:
  User session (auth.store)        → persisted to AsyncStorage
  Driver trip state (trip.store)   → kiosk QR, students, wait requests
  Admin fleet positions            → received from Socket.io, fast updates
  Admin alerts                     → received from Socket.io

TanStack Query:
  All server data (home, history, corrections, etc.)
  Refreshes in background
  Cached between screens

AsyncStorage:
  Auth tokens (via Zustand persist)
  Offline check-in queue
  User preferences (language)

Firebase RTDB:
  Live bus GPS positions (read-only on student side)
  Written only by driver background task
```

### Zustand fleet store — admin

```typescript
// apps/admin/src/store/fleet.store.ts

import { create } from 'zustand'

interface BusData {
  busId:     string
  busNumber: string
  lat:       number
  lon:       number
  speed:     number
  heading:   number
  gpsStatus: string
  isLate:    boolean
  tripId:    string | null
  driverName: string
}

interface FleetStore {
  buses:     BusData[]
  updateBus: (update: Partial<BusData> & { busId: string }) => void
  setFleet:  (buses: BusData[]) => void
}

export const useFleetStore = create<FleetStore>((set) => ({
  buses: [],

  updateBus: (update) => set(state => ({
    buses: state.buses.map(b =>
      b.busId === update.busId ? { ...b, ...update } : b
    )
  })),

  setFleet: (buses) => set({ buses }),
}))
```

---

## 10. Frontend Security

### Mobile — never store sensitive data in plain AsyncStorage

```typescript
// Use expo-secure-store for truly sensitive items
import * as SecureStore from 'expo-secure-store'

// JWT token — store in SecureStore (encrypted on device)
await SecureStore.setItemAsync('jwt_token', token)
const token = await SecureStore.getItemAsync('jwt_token')

// Non-sensitive session data (user name, role, route) — AsyncStorage is fine
// Don't store: password, raw device ID, PII beyond what's needed for UI
```

### Admin — no token storage needed

```typescript
// The admin JWT is in an httpOnly cookie.
// The browser sends it automatically.
// JavaScript cannot read it — XSS proof.
// withCredentials: true is the only config needed.

adminApiClient.defaults.withCredentials = true
// That's it. No localStorage. No sessionStorage. No token in JS memory.
```

### Input sanitization

```typescript
// All user input goes through Zod validation before API calls
import { z } from 'zod'

const checkinSchema = z.object({
  qrToken:    z.string().min(50).max(500),  // JWT tokens are long
  studentLat: z.number().min(-90).max(90),
  studentLon: z.number().min(-180).max(180),
})

// Validate before sending
const validated = checkinSchema.parse(payload)
```

### Error message mapping — never expose internals

```typescript
// Never show raw API errors to users
const ERROR_MESSAGES: Record<string, string> = {
  QR_ALREADY_USED:            'QR code already scanned. Ask driver for next code.',
  TOO_FAR:                    'You are too far from the bus.',
  ROUTE_MISMATCH:             'This is not your assigned bus.',
  ALREADY_CHECKED_IN:         'Already checked in today.',
  RATE_LIMITED:               'Too many attempts. Wait 1 minute.',
  DEVICE_MISMATCH:            'Use your registered device to check in.',
  INVALID_CREDENTIALS:        'Incorrect email or password.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Account locked. Try in 15 minutes.',
}

const getUserMessage = (error: string): string =>
  ERROR_MESSAGES[error] ?? 'Something went wrong. Please try again.'
```

---

## 11. Build Rules

Every file must satisfy these. No exceptions.

```
MOBILE:

1. ROLE_ROUTING
   _layout.tsx is the ONLY place that routes between role groups.
   Never call router.replace('/(driver)/') from a student screen.

2. API_HOOKS
   Never call apiClient directly in a component.
   Every API call lives in a hook. Components call hooks.

3. OFFLINE_FIRST
   Every query: networkMode: 'offlineFirst'
   Every check-in mutation: goes to offline queue if no network
   No screen shows blank under any network condition

4. ERROR_MAPPING
   Never show raw API error codes to users.
   All errors mapped through ERROR_MESSAGES dictionary.

5. FIREBASE_CLEANUP
   Every useLiveBus() subscription cleans up on unmount.
   ref.off() always called in useEffect cleanup.

6. GPS_DELTA
   GPS task skips writes if bus moved < 5 metres.
   GPS task writes Firebase RTDB FIRST, backend SECOND.

7. FCM_REFRESH
   FCM token sent to backend on every app launch.
   All FCM handlers registered in root _layout.tsx.

8. CHECKIN_IDEMPOTENT
   Already checked in = success (not error).
   Backend 200 with status ALREADY_CHECKED_IN → navigate to success screen.

9. KIOSK_ALWAYS_ON
   expo-keep-awake activated on kiosk screen entry.
   expo-brightness set to 1.0 on kiosk screen entry.
   Both cleaned up on screen exit.

10. STATE_OWNERSHIP
    Server state → TanStack Query only.
    Session state → Zustand only.
    Never duplicate server state in Zustand.

ADMIN:

11. CREDENTIALS_COOKIE
    withCredentials: true on every admin request.
    Never store admin JWT in localStorage or sessionStorage.
    Never access document.cookie for the JWT.

12. MAP_PERFORMANCE
    Fleet map markers use React.memo.
    Zustand subscription scoped to individual bus where possible.
    Marker positions animate smoothly — no teleporting.

13. SOCKET_CLEANUP
    Every Socket.io listener cleaned up in useEffect return.
    Admin socket uses withCredentials for auth.

14. PAGINATION
    No admin list endpoint returns unbounded results.
    All tables use pagination — default 20, max 100.
    Use infinite scroll or pagination controls.
```

---

## 12. Build Order

Build exactly in this sequence:

```
MOBILE:

M1.  lib/device.ts — getDeviceId() with SHA-256 hash
M2.  lib/api.client.ts — Axios with interceptors + silent refresh
M3.  lib/socket.ts — Socket.io singleton
M4.  lib/firebase.ts — Firebase init + offline persistence
M5.  store/auth.store.ts — Zustand + AsyncStorage persist
M6.  store/trip.store.ts — Zustand kiosk state
M7.  app/_layout.tsx — auth guard + role routing + FCM setup
M8.  (auth)/login.tsx + verify-otp.tsx + pending.tsx
     → Test: full auth flow works end-to-end
M9.  hooks/useStudentHome.ts
M10. components/student/BusStatusCard.tsx (7 states)
M11. components/student/CheckInButton.tsx (6 states)
M12. (student)/index.tsx — home screen
     → Test: home shows correct state for all trip scenarios
M13. (student)/scanner.tsx + hooks/useCheckin.ts
M14. (student)/checkin-success.tsx + checkin-fail.tsx
     → Test: full check-in flow QR → success
M15. hooks/useLiveBus.ts — Firebase RTDB subscription
M16. (student)/map.tsx — live bus with interpolation
M17. hooks/useAttendanceHistory.ts — infinite scroll
M18. (student)/history.tsx
M19. (student)/profile.tsx
M20. (student)/correction/* — correction request flow
M21. lib/offline-queue.ts + hooks/useOfflineQueue.ts
     → Test: check-in works when phone in airplane mode
M22. tasks/gps.task.ts — background GPS
M23. (driver)/index.tsx — pre-trip
M24. (driver)/route-preview.tsx
M25. (driver)/kiosk.tsx + hooks/useKioskSocket.ts + components/driver/*
     → Test: kiosk shows QR, receives check-in events, refreshes QR
M26. (driver)/breakdown.tsx
M27. (driver)/summary.tsx
M28. i18n setup — en.ts + ta.ts
M29. End-to-end test: driver starts trip → students check in → admin sees it

ADMIN:

A1.  lib/api.client.ts — withCredentials: true
A2.  lib/socket.ts — admin socket
A3.  pages/auth/Login.tsx + ForgotPassword.tsx + ResetPassword.tsx
     → Test: login sets cookie, 401 redirects to login
A4.  store/fleet.store.ts + store/alerts.store.ts
A5.  hooks/useFleetSocket.ts — Socket.io fleet updates
A6.  components/dashboard/FleetMap.tsx — Google Maps
A7.  components/dashboard/StatsBar.tsx + AlertFeed.tsx + BusDetailPanel.tsx
A8.  pages/dashboard/index.tsx
     → Test: fleet map shows buses moving, alerts appear
A9.  components/attendance/AttendanceTable.tsx + StatusBadge.tsx
A10. pages/attendance/index.tsx + corrections.tsx
     → Test: correction approval updates student status
A11. pages/students/index.tsx + bulk-import.tsx
A12. pages/routes/index.tsx + editor.tsx
A13. pages/drivers/index.tsx
A14. pages/incidents/index.tsx
A15. End-to-end test: admin sees breakdown alert → resolves it → students notified
```

---

*Frontend Architecture — College Bus Management System*
*Mobile (Expo) + Admin (React + Vite)*
*March 2026 · Status: Ready to build*
