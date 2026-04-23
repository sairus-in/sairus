# Import Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/import/`  
**Files:** `import.service.ts`, `import.routes.ts`  
**Total LOC:** ~400+ lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The import module enables **bulk CSV import of students** with two-stage validation + execution workflow.

**Workflow:**
1. **Validation Stage:** Upload CSV → normalize rows → validate against rules → detect conflicts
2. **Execution Stage:** Atomically import validated rows → create/update users + route assignments

**Key Operations:**
- **Validation:** 4 pre-fetch DB queries (routes, stops, live trips, existing users) + O(1) in-memory lookups
- **Normalization:** Trim strings, convert types, handle nulls
- **Constraint Checking:** 
  - Cannot assign to routes with ACTIVE/SCHEDULED trips
  - Cannot modify students already on live routes
  - References must exist in database
- **Upsert Pattern:** Create if new, update if exists (idempotent)
- **Conditional Route Assignment:** Only creates if BOTH routeId AND stopId provided

**Database:** Per-row transactions (failure in one doesn't block others)

**Key Strengths:**
- ✅ Validation context pre-fetched (prevent N+1 queries)
- ✅ Live trip blocking (prevents student conflicts)
- ✅ Per-row transaction rollback (partial imports allowed)
- ✅ State machine for import session lifecycle

**Performance Gaps:**
- ⚠️ No streaming CSV parsing (entire file in memory)
- ⚠️ Sequential per-row transactions (no batch upsert)
- ⚠️ No parallelism on validation or execution
- 💡 Recommended: Batch 25-50 rows per transaction

**Known Risks:**
- Race condition if trip starts during execution (not re-validated)
- Duplicate phone numbers → last occurrence wins
- Sequential processing slow for 10K+ rows

---

Full audit above covers all validation logic, transaction patterns, constraint checking, and optimization recommendations.
