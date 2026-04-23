# Uber-Scale System Design for College Bus Management

## Research Summary: How Uber/Ola Handle Real-Time Tracking

### Key Patterns from Uber Architecture

#### 1. H3 Hexagonal Spatial Indexing
Uber uses **H3** (Hexagonal Hierarchical Spatial Index) instead of simple geohashes:
- **Advantage**: Uniform distance in all directions (geohash varies by latitude)
- **k-ring searches**: Efficiently find all buses within N hexagons
- **Hierarchy**: Zoom from coarse to fine granularity

**Implementation for Your System:**
```typescript
// packages/shared/src/utils/geo.utils.ts
import * as h3 from 'h3-js';

// Convert lat/lng to H3 index (resolution 9 = ~200m hexagons)
export const getH3Index = (lat: number, lng: number): string => {
  return h3.latLngToCell(lat, lng, 9);
};

// Get all neighboring hexagons (k-ring = 1 means immediate neighbors)
export const getNearbyHexagons = (lat: number, lng: number, k: number = 1): string[] => {
  const index = getH3Index(lat, lng);
  return h3.gridDisk(index, k); // Returns ~7 hexagons for k=1
};

// Check if student is within search radius using H3
export const isWithinH3Range = (
  studentLat: number,
  studentLng: number,
  busLat: number,
  busLng: number,
  maxK: number = 2
): boolean => {
  const studentH3 = getH3Index(studentLat, studentLng);
  const busH3 = getH3Index(busLat, busLng);
  const nearbyHexagons = h3.gridDisk(studentH3, maxK);
  return nearbyHexagons.includes(busH3);
};
```

#### 2. Streaming-First Architecture (Kafka-like with Redis Streams)

**Current Flow:**
```
Driver App → API → PostgreSQL → (polling)
```

**Optimized Flow:**
```
Driver App → API → Redis Streams → Consumers → PostgreSQL (async)
                        ↓
                   Redis Pub/Sub → Real-time clients
```

**Implementation:**
```typescript
// apps/backend/src/lib/streaming.ts
import { redis } from './redis';

// Stream for GPS updates (like Kafka topic)
const GPS_STREAM = 'gps:stream';
const CONSUMER_GROUP = 'gps-processors';

export const addGPSUpdate = async (data: GPSPayload) => {
  // XADD gps:stream * driverId 123 lat 12.34 lng 56.78
  await redis.xadd(GPS_STREAM, '*',
    'driverId', data.driverId,
    'lat', data.lat.toString(),
    'lng', data.lng.toString(),
    'timestamp', Date.now().toString(),
    'speed', data.speed?.toString() || '0'
  );

  // Also update hot index for immediate queries
  await updateHotIndex(data);
};

// Consumer group for processing
export const startGPSConsumer = () => {
  const consumer = redis.duplicate();

  // Create consumer group if not exists
  consumer.xgroup('CREATE', GPS_STREAM, CONSUMER_GROUP, '$', 'MKSTREAM')
    .catch(() => {/* already exists */});

  // Read from stream
  setInterval(async () => {
    const messages = await consumer.xreadgroup(
      'GROUP', CONSUMER_GROUP, 'processor-1',
      'COUNT', 100,
      'BLOCK', 5000,
      'STREAMS', GPS_STREAM, '>'
    );

    if (messages) {
      for (const [, entries] of messages) {
        for (const [id, fields] of entries) {
          await processGPSUpdate(fields);
          await consumer.xack(GPS_STREAM, CONSUMER_GROUP, id);
        }
      }
    }
  }, 100);
};

const processGPSUpdate = async (fields: Record<string, string>) => {
  // Update Firebase RTDB for real-time clients
  await updateFirebaseLocation(fields);

  // Batch insert to PostgreSQL for persistence
  await batchInsertToPostgres(fields);
};
```

#### 3. Multi-Tier Location Storage (Hot/Warm/Cold)

| Tier | Storage | Retention | Use Case |
|------|---------|-----------|----------|
| **Hot** | Redis (TTL 5 min) | Real-time | Live bus positions |
| **Warm** | Redis Timeseries | 24 hours | Recent history, analytics |
| **Cold** | PostgreSQL + Parquet | 90 days | Long-term storage, reports |
| **Archive** | Cloud Storage | Indefinite | Compliance, ML training |

```typescript
// Tiered storage implementation
export const storeLocation = async (data: GPSPayload) => {
  const { driverId, lat, lng, timestamp } = data;
  const h3Index = getH3Index(lat, lng);
  const minute = Math.floor(timestamp / 60000);

  // HOT: Redis with 5 min TTL
  await redis.setex(
    `bus:${driverId}:location`,
    300, // 5 minutes
    JSON.stringify({ lat, lng, timestamp, h3Index })
  );

  // WARM: Redis TimeSeries for 24h analytics
  await redis.tsadd(
    `ts:bus:${driverId}:lat`,
    timestamp,
    lat
  );
  await redis.tsadd(
    `ts:bus:${driverId}:lng`,
    timestamp,
    lng
  );

  // Also store in stream for batch processing
  await redis.xadd('gps:cold-storage', '*',
    'driverId', driverId,
    'lat', lat.toString(),
    'lng', lng.toString(),
    'h3', h3Index,
    'minute', minute.toString()
  );
};
```

---

## Redis Optimizations for Geospatial Data

### 1. Pipeline Operations (10x throughput boost)

```typescript
// BAD: Individual operations
for (const bus of buses) {
  await redis.geoadd('fleet', bus.lng, bus.lat, bus.id);
}

// GOOD: Pipelined
const pipeline = redis.pipeline();
for (const bus of buses) {
  pipeline.geoadd('fleet', bus.lng, bus.lat, bus.id);
}
await pipeline.exec();
```

### 2. Connection Pooling

```typescript
// apps/backend/src/lib/redis.ts
import Redis from 'ioredis';

// Connection pool for high throughput
export const redis = new Redis(process.env.REDIS_URL!, {
  // Pool settings
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,

  // Connection pool
  connectionName: 'bus-backend',

  // Retry strategy
  retryStrategy: (times) => {
    const delay = Math.min(Math.exp(times), 20000);
    return delay;
  },

  // For workers, never give up
  reconnectOnError: (err) => {
    const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED'];
    return targetErrors.some(e => err.message.includes(e));
  }
});

// Separate connection for Pub/Sub
export const redisPub = redis.duplicate();
export const redisSub = redis.duplicate();
```

### 3. Geospatial Query Optimization

```typescript
// Use GEOSEARCH (Redis 6.2+) instead of deprecated GEORADIUS
export const findNearbyBuses = async (
  lat: number,
  lng: number,
  radiusKm: number
): Promise<BusLocation[]> => {
  // BYRADIUS for circular search
  const results = await redis.geosearch(
    'fleet',
    'FROMLONLAT', lng, lat,
    'BYRADIUS', radiusKm, 'km',
    'WITHDIST',    // Include distance
    'WITHCOORD',   // Include coordinates
    'COUNT', 50    // Limit results
  );

  return results.map(([id, dist, [lng, lat]]) => ({
    id,
    distance: parseFloat(dist),
    lat: parseFloat(lat),
    lng: parseFloat(lng)
  }));
};

// For map viewport queries, use BYBOX
export const findBusesInViewport = async (
  minLng: number,
  maxLng: number,
  minLat: number,
  maxLat: number
): Promise<BusLocation[]> => {
  const width = maxLng - minLng;
  const height = maxLat - minLat;
  const centerLng = (minLng + maxLng) / 2;
  const centerLat = (minLat + maxLat) / 2;

  return redis.geosearch(
    'fleet',
    'FROMLONLAT', centerLng, centerLat,
    'BYBOX', width, height, 'km',
    'WITHCOORD'
  );
};
```

### 4. Redis Memory Optimization

```typescript
// Use hashes for compact storage
export const storeCompactBusStatus = async (busId: string, status: BusStatus) => {
  // HSET bus:123 status ACTIVE lat 12.34 lng 56.78 lastUpdate 1234567890
  await redis.hset(`bus:${busId}:status`, {
    s: status.status[0],           // Single letter codes
    la: status.lat.toFixed(5),     // Reduced precision
    ln: status.lng.toFixed(5),
    t: Math.floor(Date.now() / 1000).toString(36) // Base36 timestamp
  });
  await redis.expire(`bus:${busId}:status`, 300);
};

// Compression for large lists
import { compress, decompress } from 'lz4';

export const storeCompressedHistory = async (busId: string, history: GPSPoint[]) => {
  const compressed = compress(Buffer.from(JSON.stringify(history)));
  await redis.setex(
    `bus:${busId}:history`,
    86400, // 24 hours
    compressed.toString('base64')
  );
};
```

---

## Backend Job Reliability Patterns

### 1. BullMQ Production Configuration

```typescript
// apps/backend/src/lib/queue.ts
import { Queue, Worker, Job } from 'bullmq';
import { redis } from './redis';

// High-reliability queue configuration
export const createReliableQueue = (name: string) => {
  return new Queue(name, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 1000, // Start at 1s, then 2s, 4s, 8s...
      },
      removeOnComplete: {
        age: 86400, // Keep completed jobs for 24h
        count: 1000
      },
      removeOnFail: {
        age: 604800 // Keep failed jobs for 7 days
      }
    }
  });
};

// Worker with crash recovery
export const createReliableWorker = (
  queueName: string,
  processor: (job: Job) => Promise<void>
) => {
  const worker = new Worker(queueName, processor, {
    connection: redis,
    concurrency: 10,
    lockDuration: 30000, // 30s lock
    stalledInterval: 15000, // Check stalled every 15s
    maxStalledCount: 2, // Retry stalled jobs twice
  });

  // Event handlers for monitoring
  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
    // Alert on repeated failures
    if (job && job.attemptsMade >= job.opts.attempts) {
      alertOnJobFailure(queueName, job, err);
    }
  });

  worker.on('stalled', (jobId) => {
    console.warn(`Job ${jobId} stalled - possible crash`);
  });

  return worker;
};

// Job with checkpoint for long-running tasks
export const processWithCheckpoint = async (
  job: Job,
  items: any[],
  processFn: (item: any) => Promise<void>
) => {
  const checkpointKey = `checkpoint:${job.id}`;
  const checkpoint = await redis.get(checkpointKey);
  let startIndex = 0;

  if (checkpoint) {
    startIndex = parseInt(checkpoint);
    console.log(`Resuming job ${job.id} from index ${startIndex}`);
  }

  for (let i = startIndex; i < items.length; i++) {
    await processFn(items[i]);

    // Save checkpoint every 10 items
    if ((i + 1) % 10 === 0) {
      await redis.setex(checkpointKey, 3600, (i + 1).toString());
      await job.updateProgress(Math.round((i / items.length) * 100));
    }
  }

  // Clean up checkpoint
  await redis.del(checkpointKey);
};
```

### 2. Dead Letter Queue Pattern

```typescript
// apps/backend/src/lib/dead-letter.ts
export class DeadLetterHandler {
  private dlq: Queue;
  private mainQueue: Queue;

  constructor(mainQueue: Queue) {
    this.mainQueue = mainQueue;
    this.dlq = new Queue(`${mainQueue.name}:dlq`, { connection: redis });
  }

  async handleFailedJob(job: Job, error: Error) {
    if (job.attemptsMade >= job.opts.attempts) {
      await this.dlq.add('failed-job', {
        originalJob: job.toJSON(),
        reason: error.message,
        stack: error.stack,
        failedAt: new Date().toISOString()
      }, {
        jobId: `dlq:${job.id}` // Preserve original ID
      });

      // Alert immediately
      await sendAlert(`Job ${job.name} failed permanently`, {
        jobId: job.id,
        error: error.message
      });
    }
  }

  // Manual retry from DLQ
  async retryFromDLQ(count: number = 10): Promise<number> {
    const failedJobs = await this.dlq.getWaiting(0, count);
    let retried = 0;

    for (const job of failedJobs) {
      try {
        const { originalJob } = job.data;

        // Retry with fresh attempts
        await this.mainQueue.add(originalJob.name, originalJob.data, {
          jobId: originalJob.id,
          attempts: 5,
          priority: 1 // High priority for retries
        });

        await job.remove();
        retried++;
      } catch (err) {
        console.error(`Failed to retry job ${job.id}:`, err);
      }
    }

    return retried;
  }
}
```

---

## Docker & Container Optimization

### 1. Optimized Dockerfile (Already Created - Enhanced)

```dockerfile
# apps/backend/Dockerfile (Production-Optimized)

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/backend/package.json ./apps/backend/

RUN npm install -g pnpm@9
RUN pnpm install --frozen-lockfile --prod=false

# Stage 2: Builder
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

RUN npm install -g pnpm@9

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

COPY packages/shared ./packages/shared
COPY apps/backend ./apps/backend

# Build with maximum optimizations
ENV NODE_ENV=production
RUN pnpm --filter shared build
RUN cd apps/backend && npx prisma generate
RUN pnpm --filter backend build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Security: Non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init curl

# Copy only necessary files
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/dist ./dist
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/node_modules ./node_modules
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/package.json ./
COPY --from=builder --chown=fastify:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=fastify:nodejs /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=builder --chown=fastify:nodejs /app/packages/shared/package.json ./packages/shared/

# Prisma files for migrations
COPY --from=builder --chown=fastify:nodejs /app/apps/backend/src/db/prisma ./prisma

USER fastify

EXPOSE 3000

# Multi-layer health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/v1/ready || exit 1

# Signal handling
ENTRYPOINT ["dumb-init", "--"]

# Graceful shutdown
CMD ["node", "dist/server.js"]
```

### 2. Docker Compose for Production

```yaml
# infra/docker/docker-compose.prod.yml
version: '3.8'

services:
  backend:
    build:
      context: ../..
      dockerfile: apps/backend/Dockerfile
    restart: unless-stopped
    stop_grace_period: 30s
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - JWT_SECRET=${JWT_SECRET}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/v1/ready"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
    command: redis-server /usr/local/etc/redis/redis.conf
    deploy:
      resources:
        limits:
          memory: 256M

volumes:
  redis_data:
```

### 3. Redis Configuration for Production

```conf
# infra/docker/redis.conf
# Memory optimization
maxmemory 200mb
maxmemory-policy allkeys-lru

# Persistence
save 900 1
save 300 10
save 60 10000

# AOF for durability
appendonly yes
appendfsync everysec
no-appendfsync-on-rewrite no

# Performance
tcp-keepalive 300
timeout 0

# Security
protected-mode yes
```

---

## Admin Panel Superpowers

### 1. Real-Time Operations Dashboard

```typescript
// apps/admin/src/pages/ops/CommandCenter.tsx
export const CommandCenter = () => {
  const { trips, alerts, stats } = useOpsData();
  const { socket } = useAdminSocket();

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Live Fleet Map */}
      <div className="col-span-8">
        <FleetMap
          trips={trips}
          alerts={alerts}
          onBusClick={handleBusSelect}
        />
      </div>

      {/* Ops Event Rail */}
      <div className="col-span-4">
        <OpsEventRail events={alerts} />

        {/* Quick Actions */}
        <QuickActionsPanel>
          <EmergencyStopButton />
          <MassNotifyButton />
          <RerouteButton />
        </QuickActionsPanel>
      </div>
    </div>
  );
};
```

### 2. Capability-Based Access Control

```typescript
// apps/admin/src/lib/capabilities.ts
export const CAPABILITIES = {
  // Super Admin
  SYSTEM_CONFIG: 'system:config',
  USER_MANAGEMENT: 'user:manage',

  // Transport Officer
  FLEET_CONTROL: 'fleet:control',        // Can stop/start buses
  EMERGENCY_BROADCAST: 'broadcast:emergency',
  ROUTE_MODIFY: 'route:modify',

  // Coordinator
  TRIP_SUPERVISE: 'trip:supervise',
  ATTENDANCE_OVERRIDE: 'attendance:override',
  INCIDENT_MANAGE: 'incident:manage',

  // Read-only
  VIEW_DASHBOARD: 'view:dashboard',
  VIEW_REPORTS: 'view:reports',
} as const;

// Capability hierarchy
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  TRANSPORT_OFFICER: Object.values(CAPABILITIES),
  COORDINATOR: [
    CAPABILITIES.TRIP_SUPERVISE,
    CAPABILITIES.ATTENDANCE_OVERRIDE,
    CAPABILITIES.INCIDENT_MANAGE,
    CAPABILITIES.VIEW_DASHBOARD,
    CAPABILITIES.VIEW_REPORTS,
  ],
  // ... other roles
};

// Component wrapper
export const RequireCapability = ({
  capability,
  children,
  fallback = <AccessDenied />
}: RequireCapabilityProps) => {
  const { user } = useAuth();
  const hasCapability = ROLE_CAPABILITIES[user.role]?.includes(capability);

  return hasCapability ? <>{children}</> : fallback;
};
```

### 3. Emergency Controls

```typescript
// Emergency stop all buses
export const emergencyStopAll = async (reason: string) => {
  await api.post('/v1/admin/emergency/stop-all', {
    reason,
    initiatedBy: user.id,
    timestamp: new Date().toISOString()
  });

  // Notify all drivers via FCM
  await sendBroadcastNotification({
    title: 'EMERGENCY STOP',
    body: `All buses must stop immediately. Reason: ${reason}`,
    priority: 'high',
    data: { screen: 'emergency-stop', reason }
  });
};

// Mass reroute
export const massReroute = async (affectedRoutes: string[], detour: DetourInfo) => {
  await api.post('/v1/admin/ops/mass-reroute', {
    routes: affectedRoutes,
    detour,
    effectiveImmediately: true
  });
};
```

---

## Performance Monitoring & SRE

### 1. Structured Logging

```typescript
// apps/backend/src/lib/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label })
  },
  base: {
    service: 'bus-backend',
    version: process.env.GIT_SHA,
    environment: process.env.NODE_ENV
  },
  // Redact sensitive fields
  redact: ['req.headers.authorization', 'req.body.password', 'req.body.otp']
});

// Request logging middleware
export const requestLogger = async (req, reply) => {
  const startTime = Date.now();

  req.log.info({
    req: {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    }
  }, 'request started');

  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;

    req.log.info({
      res: {
        statusCode: reply.statusCode,
        durationMs: duration
      },
      // SLO tracking
      slo: {
        path: req.routerPath,
        met: duration < getSLOForPath(req.routerPath)
      }
    }, 'request completed');
  });
};
```

### 2. Custom Metrics

```typescript
// apps/backend/src/lib/metrics.ts
import { Counter, Histogram, Registry } from 'prom-client';

const register = new Registry();

// Custom metrics
export const checkinCounter = new Counter({
  name: 'checkin_total',
  help: 'Total check-in attempts',
  labelNames: ['status', 'reason'],
  registers: [register]
});

export const checkinLatency = new Histogram({
  name: 'checkin_duration_seconds',
  help: 'Check-in request duration',
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register]
});

export const gpsPingCounter = new Counter({
  name: 'gps_pings_total',
  help: 'Total GPS pings received',
  labelNames: ['bus_id'],
  registers: [register]
});

// Usage in code
export const recordCheckin = async (result: CheckinResult) => {
  checkinCounter.inc({
    status: result.success ? 'success' : 'failure',
    reason: result.reason || 'none'
  });
};
```

---

## Summary: Key Recommendations

| Priority | Action | Impact |
|----------|--------|--------|
| 🔴 High | Implement H3 spatial indexing | 10x faster geospatial queries |
| 🔴 High | Add Redis Streams for GPS | Sub-second real-time updates |
| 🔴 High | Tiered storage (Hot/Warm/Cold) | 80% cost reduction |
| 🟡 Medium | BullMQ checkpoint jobs | Zero data loss on crashes |
| 🟡 Medium | Pipeline Redis operations | 10x throughput boost |
| 🟡 Medium | Admin capability system | Security & control |
| 🟢 Low | Docker multi-stage build | 70% smaller images |
| 🟢 Low | Structured logging | Better observability |

## Sources
- [Uber Real-Time Tracking Architecture](https://awstip.com/architecting-an-uber-scale-real-time-tracking-dispatch-system-e448426681d5)
- [Redis Geospatial Best Practices](https://redis.io/blog/create-a-real-time-vehicle-tracking-system-with-redis/)
- [BullMQ Production Patterns](https://docs.bullmq.io/guide/going-to-production)
- [Docker Node.js Optimization](https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker)
