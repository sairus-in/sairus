# Incidents Module — Deep Dive Audit

**Module Location:** `apps/backend/src/modules/incidents/`  
**Files:** `incidents.service.ts`, `incidents.routes.ts`  
**Total LOC:** ~400+ lines

[Content from comprehensive agent analysis - Full audit above in agent output]

---

## Quick Summary

The incidents module handles **SOS/breakdown reporting** for buses. It manages:
- Multi-channel escalation (COORDINATOR → TRANSPORT_OFFICER → PRINCIPAL)
- Notification dispatch (PUSH + IN_APP + SMS to coordinators)
- WebSocket real-time dashboard updates
- Incident status lifecycle (REPORTED → ASSIGNED → RESOLVED)
- Rate limiting (10 reports/hour per driver)

**Key Strengths:**
- ✅ Multi-channel notifications (SMS for critical alerts)
- ✅ Route coordinator discovery via join table
- ✅ WebSocket broadcast to admin dashboard
- ✅ Incident escalation workflow

**Critical Gaps:**
- ⚠️ **Cloud Tasks auto-escalation NOT IMPLEMENTED** (TODO comment at line 60)
- ⚠️ `GET /incidents` and `GET /incidents/:id` return stubs (TODO at lines 96, 121)
- ⚠️ No driver assignment validation (can report for any trip)
- ⚠️ No trip status validation (can create incident for completed trip)
- ⚠️ GPS coordinates captured but never used

**High-Priority Fixes:**
1. Implement Cloud Tasks auto-escalation (+10 mins unresolved)
2. Complete listIncidents() and getIncident() stubs
3. Validate trip is ACTIVE and driver is assigned
4. Add indexes for `(reportedById)`, `(escalationLevel)`, `(tripId)`

---

Full analysis above details state machine, error codes, integrations, and risks.
