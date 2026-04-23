# Data Console Routing - Optimization Guide

## Overview

The admin panel now features **clean, centralized routing logic** with two distinct workspaces:

### 1. **Data Console** (`/` routes)
Administrative data management workspace for CRUD operations:
- `/corrections` - Review attendance corrections
- `/students` - Manage student records
- `/routes` - Edit transportation routes
- `/buses` - Manage fleet
- `/drivers` - Manage driver information
- `/attendance` - View attendance reports
- `/security` - Manage security settings

### 2. **Live Operations** (`/ops/*` routes)
Real-time monitoring and incident management:
- `/ops/dashboard` - Operations dashboard
- `/ops/fleet` - Live GPS fleet tracking
- `/ops/incidents` - Incident management
- `/ops/messages` - Communication center
- `/ops/operations` - Operations center
- `/ops/outages` - GPS outage queue
- `/ops/audit-log` - Audit logging

---

## Architecture

### Files & Responsibilities

| File | Purpose |
|------|---------|
| `config/routing.config.ts` | ✅ Single source of truth for all routes |
| `App.tsx` | Route definitions & capability-based access control |
| `shells/AdminDataShell.tsx` | Data console navigation & layout |
| `shells/LiveOpsShell.tsx` | Live ops navigation & layout |
| `components/shared/RequireCapability.tsx` | Access control wrapper |
| `utils/routing-debug.ts` | Debugging utilities for routing issues |

### Route Definition Flow

```
routing.config.ts (Route definitions)
    ↓
App.tsx (Route matching & capability checks)
    ↓
RequireCapability (Access control)
    ↓
Shell Component (Layout & Outlet)
    ↓
Page Component (Rendered content)
```

---

## Key Design Decisions

### 1. **Centralized Route Configuration**
All routes are defined in `routing.config.ts`:
- **Benefits**: Easy to add/remove routes without changing App.tsx
- **Single source of truth**: Capabilities match between config and routes
- **Self-documenting**: Route structure is immediately visible

### 2. **Capability-Based Access Control**
Routes are protected at two levels:
- **RouteConfig**: Each route specifies required capability
- **RequireCapability**: Component enforces capability check at render time

### 3. **Default Route Logic**
The `getDefaultRoute()` function intelligently selects first accessible route:
- Ensures users always land on a page they can access
- Falls back to security settings if no routes available
- Works for both data console and live ops

### 4. **Wildcard Fallback**
- **Data Console**: Unmatched routes redirect to first accessible data console route
- **Global**: Unauthenticated users redirect to login
- Prevents users from reaching 404 pages

---

## How to Use the Routing System

### Adding a New Route

1. **Add to `routing.config.ts`**:
```typescript
const DATA_CONSOLE_ROUTES: RouteConfig[] = [
  // ... existing routes
  {
    path: '/new-section',
    label: 'New Section',
    capability: 'canManageNewSection',
    section: 'data-console',
  },
];
```

2. **Add capability to `Capabilities` type** in `lib/capabilities.ts`:
```typescript
export interface Capabilities {
  // ... existing capabilities
  canManageNewSection: boolean;
}
```

3. **Add route in `App.tsx`**:
```typescript
<Route path="/new-section" element={
  <RequireCapability capability="canManageNewSection">
    <NewSectionPage />
  </RequireCapability>
} />
```

4. **Import & lazy-load the page**:
```typescript
const NewSectionPage = lazy(() => 
  import('./pages/new-section/NewSectionPage').then(
    (module) => ({ default: module.NewSectionPage })
  )
);
```

5. **Optionally update capability seeds** in backend auth service

Navigation will automatically include the new route if user has the capability!

---

## Common Issues & Solutions

### Navigation Not Working

**Symptom**: Clicking nav items doesn't navigate

**Debugging**:
```typescript
import { debugRoutingAccess } from '../utils/routing-debug';

// In your component useEffect:
useEffect(() => {
  debugRoutingAccess(user?.id || 'unknown', capabilities, 'data-console');
}, [user, capabilities]);
```

**Common causes**:
1. User doesn't have capability for the route → Check backend user_role_capabilities
2. Route path mismatch → Verify `to` attribute matches route path exactly
3. NavLink not matching → Ensure no trailing slashes mismatches

### "Security Screen Only Opens"

**Symptom**: Only security page renders

**Likely causes**:
1. User only has `canViewSecuritySettings` capability
2. Other routes are blocked by RequireCapability
3. Route definition mismatch

**Solution**:
```typescript
// Debug what routes are accessible
import { listAllRoutes } from '../utils/routing-debug';
listAllRoutes(); // Shows all routes in console
```

### Invalid Route Redirects

**Symptom**: Navigating to wrong URL bounces around

**Solution**:
- Data console invalid routes now redirect to first accessible route
- Global wildcard catches anything else and redirects to login/default

---

## Testing Routes

### Manual Testing Checklist

- [ ] Can navigate between all accessible data console routes
- [ ] Cannot access routes without required capability (shows access denied)
- [ ] Navigating to `/` redirects to first accessible route
- [ ] Invalid data console routes redirect within section
- [ ] Invalid global routes redirect to login (if not auth) or default

### Using Debug Utilities

```typescript
import { 
  debugRoutingAccess, 
  debugRouteMatch, 
  listAllRoutes,
  validateRoute 
} from '../utils/routing-debug';

// See all routes
listAllRoutes();

// Check user's accessible routes
debugRoutingAccess(userId, capabilities, 'data-console');

// Validate a specific route exists
validateRoute('/students'); // returns true/false

// Check if current route matches capabilities
debugRouteMatch(pathname, capabilities);
```

---

## Performance Optimizations

1. **Lazy Loading**: All pages are dynamically imported
   - Reduces initial bundle size
   - Routes load on-demand

2. **Memoized Filtering**: Navigation items are filtered efficiently
   - Filter only runs when capabilities change
   - No unnecessary re-renders

3. **Route Matching**: React Router v6 optimizes route matching
   - No unnecessary traversal
   - Fast path resolution

---

## Future Enhancements

- [ ] Add breadcrumb navigation for context
- [ ] Implement route-level analytics
- [ ] Add keyboard shortcuts for route navigation
- [ ] Create route-based permission audit reports
- [ ] Add route transition animations
- [ ] Implement deep-linking with state preservation

---

## Related Documentation

- **Capabilities System**: See `lib/capabilities.ts`
- **Auth Store**: See `store/auth.store.ts`
- **Backend Route Protection**: See API authentication layer
