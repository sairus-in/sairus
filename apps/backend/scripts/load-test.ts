#!/usr/bin/env node
/**
 * Load Testing Script for College Bus System
 * Simulates 6000+ users to verify system capacity
 *
 * Usage: npx tsx scripts/load-test.ts --users=6000 --duration=300
 */

import { Command } from 'commander';
import axios from 'axios';
import { randomInt } from 'crypto';
import pLimit from 'p-limit';

const program = new Command();

program
  .option('-u, --users <number>', 'number of concurrent users', '6000')
  .option('-d, --duration <seconds>', 'test duration in seconds', '300')
  .option('-r, --ramp-up <seconds>', 'ramp up time', '60')
  .option('--api-url <url>', 'API base URL', 'http://localhost:3000')
  .option('--checkpoint-interval <seconds>', 'checkpoint interval', '30');

program.parse();
const options = program.opts();

const CONFIG = {
  users: parseInt(options.users),
  duration: parseInt(options.duration),
  rampUp: parseInt(options.rampUp),
  apiUrl: options.apiUrl,
  checkpointInterval: parseInt(options.checkpointInterval)
};

// Metrics tracking
const metrics = {
  requestsSent: 0,
  requestsSucceeded: 0,
  requestsFailed: 0,
  totalLatency: 0,
  latencies: [] as number[],
  errors: new Map<string, number>(),
  startTime: Date.now()
};

// Test scenarios
const SCENARIOS = {
  // Students checking in (morning peak)
  studentCheckin: {
    weight: 40,
    fn: simulateStudentCheckin
  },
  // GPS updates from buses
  driverGPS: {
    weight: 35,
    fn: simulateDriverGPS
  },
  // Students viewing home screen
  studentHome: {
    weight: 20,
    fn: simulateStudentHome
  },
  // Admin dashboard
  adminDashboard: {
    weight: 5,
    fn: simulateAdminDashboard
  }
};

// Rate limiter - max 100 concurrent requests
const limit = pLimit(100);

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          COLLEGE BUS SYSTEM - LOAD TEST                       ║
╠═══════════════════════════════════════════════════════════════╣
║ Target Users:      ${CONFIG.users.toString().padEnd(45)}║
║ Duration:          ${CONFIG.duration}s${''.padEnd(45)}║
║ Ramp Up:           ${CONFIG.rampUp}s${''.padEnd(45)}║
║ API URL:           ${CONFIG.apiUrl.padEnd(45)}║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Health check
  console.log('Checking API health...');
  try {
    const health = await axios.get(`${CONFIG.apiUrl}/v1/ready`);
    console.log('✅ API is healthy:', health.data);
  } catch (err) {
    console.error('❌ API health check failed:', err.message);
    process.exit(1);
  }

  // Start metrics reporter
  const metricsInterval = setInterval(printMetrics, 10000);

  // Ramp up users
  const usersPerSecond = CONFIG.users / CONFIG.rampUp;
  const activeUsers: Promise<void>[] = [];

  console.log(`\n🚀 Ramping up ${CONFIG.users} users over ${CONFIG.rampUp}s...\n`);

  for (let i = 0; i < CONFIG.users; i++) {
    activeUsers.push(simulateUser(i));

    if (i % 10 === 0) {
      await new Promise(r => setTimeout(r, 1000 / usersPerSecond * 10));
    }
  }

  // Wait for duration
  await new Promise(r => setTimeout(r, CONFIG.duration * 1000));

  // Cleanup
  clearInterval(metricsInterval);

  // Final report
  printFinalReport();
}

async function simulateUser(userId: number) {
  const endTime = Date.now() + (CONFIG.duration * 1000);

  while (Date.now() < endTime) {
    // Pick scenario based on weight
    const scenario = pickScenario();

    await limit(async () => {
      const start = Date.now();
      try {
        await scenario.fn(userId);
        recordSuccess(Date.now() - start);
      } catch (err: any) {
        recordError(err.response?.status || err.message);
      }
    });

    // Random think time between requests
    await sleep(randomInt(1000, 5000));
  }
}

function pickScenario() {
  const rand = Math.random() * 100;
  let cumulative = 0;

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    cumulative += scenario.weight;
    if (rand <= cumulative) {
      return scenario;
    }
  }

  return SCENARIOS.studentHome;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO SIMULATIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function simulateStudentCheckin(userId: number) {
  const studentId = `student_${userId % 6000}`;

  // 1. Get home data
  await axios.get(`${CONFIG.apiUrl}/v1/student/home`, {
    headers: { Authorization: `Bearer ${getMockToken(studentId)}` }
  });

  // 2. Attempt check-in (60% success rate)
  if (Math.random() < 0.6) {
    await axios.post(
      `${CONFIG.apiUrl}/v1/attendance/check-in`,
      {
        tripId: `trip_${randomInt(1, 180)}`,
        qrToken: generateMockQR(),
        lat: 12.9 + Math.random() * 0.1,
        lng: 77.6 + Math.random() * 0.1
      },
      { headers: { Authorization: `Bearer ${getMockToken(studentId)}` } }
    );
  }
}

async function simulateDriverGPS(userId: number) {
  const driverId = `driver_${userId % 180}`;
  const busId = `bus_${userId % 180}`;

  // Simulate GPS ping every 3 seconds
  await axios.post(
    `${CONFIG.apiUrl}/v1/gps/ping`,
    {
      busId,
      lat: 12.9 + Math.random() * 0.1,
      lng: 77.6 + Math.random() * 0.1,
      speed: randomInt(0, 60),
      heading: randomInt(0, 360),
      timestamp: Date.now()
    },
    { headers: { Authorization: `Bearer ${getMockToken(driverId)}` } }
  );
}

async function simulateStudentHome(userId: number) {
  const studentId = `student_${userId % 6000}`;

  await axios.get(`${CONFIG.apiUrl}/v1/student/home`, {
    headers: { Authorization: `Bearer ${getMockToken(studentId)}` }
  });
}

async function simulateAdminDashboard(userId: number) {
  const adminId = `admin_${userId % 20}`;

  // Dashboard stats
  await axios.get(`${CONFIG.apiUrl}/v1/admin/live/dashboard`, {
    headers: { Authorization: `Bearer ${getMockToken(adminId)}` }
  });

  // Active trips
  await axios.get(`${CONFIG.apiUrl}/v1/admin/live/trips/active`, {
    headers: { Authorization: `Bearer ${getMockToken(adminId)}` }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

function getMockToken(userId: string): string {
  // In real test, you'd use actual JWTs
  return Buffer.from(JSON.stringify({ sub: userId, iat: Date.now() })).toString('base64');
}

function generateMockQR(): string {
  return `qr_${Date.now()}_${randomInt(1000, 9999)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function recordSuccess(latency: number) {
  metrics.requestsSent++;
  metrics.requestsSucceeded++;
  metrics.totalLatency += latency;
  metrics.latencies.push(latency);

  // Keep only last 1000 latencies for percentile calc
  if (metrics.latencies.length > 1000) {
    metrics.latencies.shift();
  }
}

function recordError(error: string) {
  metrics.requestsSent++;
  metrics.requestsFailed++;
  metrics.errors.set(error, (metrics.errors.get(error) || 0) + 1);
}

function printMetrics() {
  const elapsed = (Date.now() - metrics.startTime) / 1000;
  const rps = (metrics.requestsSent / elapsed).toFixed(2);
  const avgLatency = metrics.totalLatency / metrics.requestsSucceeded || 0;
  const errorRate = ((metrics.requestsFailed / metrics.requestsSent) * 100).toFixed(2);

  // Calculate percentiles
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  console.clear();
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    LOAD TEST METRICS                          ║
╠═══════════════════════════════════════════════════════════════╣
║ Time Elapsed:     ${elapsed.toFixed(1).padEnd(10)}s                                          ║
║ Requests/sec:      ${rps.padEnd(10)}                                          ║
║ Total Requests:   ${metrics.requestsSent.toString().padEnd(10)}                                          ║
║ Success Rate:      ${((metrics.requestsSucceeded / metrics.requestsSent) * 100).toFixed(1).padEnd(10)}%                                         ║
║ Error Rate:        ${errorRate.padEnd(10)}%                                         ║
╠═══════════════════════════════════════════════════════════════╣
║ LATENCY DISTRIBUTION                                          ║
║ Average:           ${avgLatency.toFixed(0).padEnd(10)}ms                                         ║
║ p50:               ${p50.toFixed(0).padEnd(10)}ms                                         ║
║ p95:               ${p95.toFixed(0).padEnd(10)}ms                                         ║
║ p99:               ${p99.toFixed(0).padEnd(10)}ms                                         ║
╚═══════════════════════════════════════════════════════════════╝
`);

  // Show top errors
  if (metrics.errors.size > 0) {
    console.log('Top Errors:');
    const sortedErrors = [...metrics.errors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    sortedErrors.forEach(([error, count]) => {
      console.log(`  ${error}: ${count}`);
    });
  }
}

function printFinalReport() {
  const elapsed = (Date.now() - metrics.startTime) / 1000;
  const rps = (metrics.requestsSent / elapsed).toFixed(2);
  const avgLatency = metrics.totalLatency / metrics.requestsSucceeded || 0;

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 LOAD TEST FINAL REPORT                        ║
╠═══════════════════════════════════════════════════════════════╣
║ Duration:          ${elapsed.toFixed(1).padEnd(10)}s                                          ║
║ Total Requests:     ${metrics.requestsSent.toString().padEnd(10)}                                          ║
║ Successful:        ${metrics.requestsSucceeded.toString().padEnd(10)}                                          ║
║ Failed:            ${metrics.requestsFailed.toString().padEnd(10)}                                          ║
║ Requests/sec:      ${rps.padEnd(10)}                                          ║
║ Avg Latency:       ${avgLatency.toFixed(0).padEnd(10)}ms                                         ║
╠═══════════════════════════════════════════════════════════════╣
║                        RESULT                                 ║
║ ${metrics.requestsFailed === 0 ? '✅ ALL TESTS PASSED' :
     avgLatency < 500 ? '⚠️  PASSED WITH WARNINGS' :
     '❌ TESTS FAILED'}                                           ║
╚═══════════════════════════════════════════════════════════════╝
`);

  process.exit(metrics.requestsFailed > metrics.requestsSent * 0.01 ? 1 : 0);
}

main().catch(console.error);
