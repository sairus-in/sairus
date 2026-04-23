// tasks/gps.task.ts — Background GPS task with delta compression
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../lib/api.client';
import {
  GPS_CONTEXT_KEY,
  GPS_HEARTBEAT_PREFIX,
  GPS_LAST_POS_KEY,
} from '../lib/persisted-cache';

const GPS_TASK_NAME = 'background-gps-task';

interface GPSContext {
  tripId: string;
  busId: string;
}

interface LastPosition {
  lat: number;
  lon: number;
}

/**
 * Calculate distance between two lat/lon points (Haversine, in metres).
 */
function getDistanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getGPSContext(): Promise<GPSContext | null> {
  const raw = await AsyncStorage.getItem(GPS_CONTEXT_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function getLastPosition(): Promise<LastPosition | null> {
  const raw = await AsyncStorage.getItem(GPS_LAST_POS_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function setLastPosition(pos: LastPosition): Promise<void> {
  await AsyncStorage.setItem(GPS_LAST_POS_KEY, JSON.stringify(pos));
}

// Define the background task
TaskManager.defineTask(GPS_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[GPS Task] Error:', error);
    return;
  }

  const locData = data as { locations: Location.LocationObject[] };
  if (!locData?.locations?.length) return;

  const location = locData.locations[0];
  const context = await getGPSContext();
  if (!context) return;

  const { lat, lon } = {
    lat: location.coords.latitude,
    lon: location.coords.longitude,
  };
  const speed = (location.coords.speed ?? 0) * 3.6; // m/s to km/h
  const heading = location.coords.heading ?? 0;
  const accuracy = location.coords.accuracy ?? 999;

  // Delta compression — skip if moved less than 5 metres
  const lastPos = await getLastPosition();
  if (lastPos) {
    const distance = getDistanceMetres(lastPos.lat, lastPos.lon, lat, lon);
    if (distance < 5) return;
  }

  // Write to backend directly - the Single Source of Truth [Hardened GPS Flow]
  try {
    await api.post('/v1/gps/ping', {
      busId: context.busId,
      tripId: context.tripId,
      lat,
      lon,
      speed,
      heading,
      accuracy,
      timestamp: location.timestamp,
    });
  } catch (apiErr) {
    console.warn('[GPS Task] API ping failed:', apiErr);
    // Even if it fails, we wait for the next tick (no local retry queue for live positional data)
  }

  // Update heartbeat
  await AsyncStorage.setItem(`${GPS_HEARTBEAT_PREFIX}${context.busId}`, String(Date.now()));
  await setLastPosition({ lat, lon });
});

/**
 * Start GPS tracking (called when driver starts trip).
 */
export async function startGPSTask(tripId: string, busId: string): Promise<void> {
  await AsyncStorage.setItem(GPS_CONTEXT_KEY, JSON.stringify({ tripId, busId }));

  await Location.startLocationUpdatesAsync(GPS_TASK_NAME, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 3000,
    distanceInterval: 5,
    foregroundService: {
      notificationTitle: `Bus — Trip Active`,
      notificationBody: 'GPS tracking is running',
      notificationColor: '#1E3A8A',
    },
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
  });
}

/**
 * Stop GPS tracking (called when driver ends trip).
 */
export async function stopGPSTask(): Promise<void> {
  const context = await getGPSContext();
  const taskRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK_NAME);
  if (taskRunning) {
    await Location.stopLocationUpdatesAsync(GPS_TASK_NAME);
  }
  await AsyncStorage.removeItem(GPS_CONTEXT_KEY);
  await AsyncStorage.removeItem(GPS_LAST_POS_KEY);
  if (context?.busId) {
    await AsyncStorage.removeItem(`${GPS_HEARTBEAT_PREFIX}${context.busId}`);
  }
}

export { GPS_TASK_NAME };
