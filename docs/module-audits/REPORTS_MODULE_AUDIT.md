# Admin Reports Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/admin/reports.service.ts`  
**Files:** `reports.service.ts`, `reports.routes.ts`  
**Total LOC:** ~350+ lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The reports module provides **asynchronous attendance analysis and CSV export** for admins. Fire-and-forget job queue design with Redis-only persistence.

**Key Features:**
- Async job enqueue with progress tracking (0% → 100%)
- Real-time overview (synchronous) + batch reports (async)
- Scope-based access control (coordinator vs officer)
- Job status tracking in Redis (QUEUED → PROCESSING → COMPLETED/FAILED)
- CSV artifact generation and caching

**Flow:**
1. Enqueue job → generates jobId → stored in Redis
2. Async processing → aggregates trips + attendance logs → generates CSV
3. Poll for completion → download CSV artifact

**Key Strengths:**
- ✅ Scope-based access control (coordinators can't see peer reports)
- ✅ Job ownership validation
- ✅ Fire-and-forget prevents blocking web requests
- ✅ Progress tracking for UX feedback

**CRITICAL GAPS:**
- 🔴 **Fire-and-forget design** — No Cloud Tasks integration (violates CLAUDE.md)
  - If Cloud Run restarts during processing, job dies silently
- 🔴 **Redis-only artifact storage** — Lost after 60min or eviction
  - No persistent database storage of reports
  - No way to recover completed reports after TTL
- 🔴 **Silent failures** — If crash after PROCESSING starts, status hangs indefinitely
- ⚠️ **No pagination** — All trips loaded into memory (OOM risk >50K trips)
- ⚠️ **No retry logic** — Transient DB errors = immediate FAILED state

**Performance:**
- Scale: 50K broadcast → ~2-3 minutes (DB bottleneck)
- Trip query: ~200-500ms (depends on indexes)
- CSV generation: ~50-200ms

**High-Priority Fixes:**
1. Migrate to GCP Cloud Tasks (with retry policy)
2. Add persistent report storage to PostgreSQL
3. Add pagination/streaming CSV generation
4. Implement composite indexes on `trip(date, routeId)`

---

Full audit above covers job lifecycle, scaling, error handling, and 16+ recommendations.
