# Pagination Contract

> Every list endpoint in this API follows exactly one of these three patterns.
> No exceptions. No hybrid shapes. No "pagination-like metadata" on unpaginated lists.

---

## The Three Patterns

### 1. `ok(data)` — No Pagination

Use when the dataset is **bounded by the problem domain** and will never grow beyond a practical limit.

```ts
return reply.send(ok(data, request.id));
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "requestId": "...",
  "timestamp": "..."
}
```

**Examples:**
| Endpoint | Why unbounded |
|---|---|
| `GET /admin/trips/:id/students` | Capped by bus capacity (~60 students) |
| `GET /admin/trips/:id/timeline` | Single trip's event log is finite |
| `GET /admin/live/alerts` | Redis sorted set, hardcoded top-50 |
| `GET /admin/ops/gps-outages` | Active outages only — bounded by active trips |
| `GET /admin/ops/import-sessions` | Hardcoded `take: 50` |
| `GET /admin/messages` | Capped by `limit` param; no total count available |
| `GET /driver/route-stops` | Route stops bounded by college geography |
| `GET /fleet/buses` | Fleet is bounded (180 buses) |

---

### 2. `okList(data, pagination)` — Offset Pagination

Use when the dataset is **unbounded and grows over time** AND clients need to jump to arbitrary pages.

```ts
return reply.send(okList(items, buildPagination(page, limit, total), request.id));
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 25,
    "total": 843,
    "hasMore": true
  },
  "requestId": "...",
  "timestamp": ""
}
```

**Query params:**
```
GET /admin/corrections?page=1&limit=25
GET /admin/incidents?status=REPORTED&page=2&limit=50
```

**Rules:**
- `page` is 1-based, defaults to `1`
- `limit` is capped at `100`
- A separate `count()` query must run to get `total`
- Both `page` and `limit` must be accepted as query params

**Examples:**
| Endpoint | Why unbounded |
|---|---|
| `GET /admin/corrections` | Corrections accumulate forever |
| `GET /admin/incidents` | Incident history grows indefinitely |
| `GET /admin/ops/gps-outage-corrections` | GPS outage corrections accumulate |
| `GET /admin/live/trips/active` | Redis set grows across the day |
| `GET /attendance/history` | Student history is unbounded |
| `GET /users` | Students/staff grow over time |

---

### 3. Cursor Pagination — Not Yet Applied

Use when the dataset is **LARGE_DATASET** (>10K rows) and offset pagination becomes slow.

```ts
// Query: ?after=cursor_id&limit=50
// Response: same okList shape but pagination contains nextCursor
return reply.send(okList(items, {
  page: 1,
  limit: 50,
  total: null,           // unknown for cursor pagination
  hasMore: !!nextCursor, // true/false
}, request.id));
```

**Planned for:**
- `GET /admin/audit-log` — grows to millions of rows; offset becomes slow past page 100+

---

## NEVER Do These

### 1. No fake pagination
```ts
// BAD — lies about having pages
return okList(data, buildPagination(1, 100, data.length));

// GOOD — honest
return ok(data);
```

### 2. No hybrid shapes
```ts
// BAD — returns both a list and a total, but total = returned.length
return okList(data, buildPagination(1, data.length, data.length));

// GOOD
return ok(data);
```

### 3. No missing `total`
```ts
// BAD — client can't calculate pages
return okList(data, { page: 1, limit: 50, total: data.length });

// GOOD — real count
return okList(data, buildPagination(page, limit, total));
```

### 4. No pagination on single-object lookups
```ts
// BAD — single resource doesn't need pages
return okList([item], buildPagination(1, 1, 1));
// GOOD
return ok(item);
```

---

## Decision Framework

Before adding pagination to any endpoint, answer these:

1. **Can this dataset grow beyond ~100 items?** If yes → paginate.
2. **Does the client need to jump to arbitrary pages?** If yes → offset pagination. If scanning forward only → cursor pagination.
3. **Is this a single resource or singleton lookup?** If yes → `ok()`.
4. **Is this data bounded by the problem domain?** If yes → `ok()`.

### Data Size Thresholds

| Size | Pattern | Examples |
|---|---|---|
| 1 (single object) | `ok()` | `/trips/:id`, `/users/me` |
| < 100 (bounded) | `ok()` | Trip students, route stops, active outages |
| Growing / unbounded | `okList()` | Corrections, incidents, history |
| Large dataset (>10K) | Cursor | Audit logs |

---

## Implementation Checklist

When adding a new list endpoint:

- [ ] Classify the data type: SMALL_FIXED / GROWING_LIST / LARGE_DATASET
- [ ] SMALL_FIXED → return `ok(data)`
- [ ] GROWING_LIST → add `page` + `limit` query params, run `count()`, return `okList()`
- [ ] LARGE_DATASET → use cursor pagination
- [ ] No pagination metadata unless pages actually exist
- [ ] `requestId` always passed to `ok()` / `okList()`
- [ ] `buildPagination()` used for offset pagination (not manual objects)
- [ ] `limit` capped at a maximum (e.g., 100)

---

## Why Fake Pagination Is a Contract Bug

Returning `okList(data, buildPagination(1, data.length, data.length))` where all data is always returned:

1. **Lies to clients** — they think they have pages when there's only one
2. **Inflates response size** — sends pagination metadata for no reason
3. **Creates false expectations** — clients write pagination UI for a list that never paginates
4. **Blocks future scaling** — when the list grows, the API contract already pretends pagination exists

Fix: use `ok()` for bounded lists. Add real pagination when the list actually needs it.
