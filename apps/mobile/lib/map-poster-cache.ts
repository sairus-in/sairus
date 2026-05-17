import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

const POSTER_DIR = `${FileSystem.cacheDirectory}map-posters/`;
const METADATA_KEY = 'map-poster-metadata';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MapViewType = any;

/**
 * Map poster cache for saving/loading map snapshots.
 * Used for the TripCard mini-map preview and quick map display.
 */
interface PosterMetadata {
  uri: string;
  savedAt: number;
}

interface PosterCache {
  [busId: string]: PosterMetadata;
}

/**
 * Save a map snapshot to cache.
 * @param busId - The bus ID to save under
 * @param mapRef - Reference to the MapView
 */
export async function saveMapPoster(
  busId: string,
  mapRef: React.RefObject<MapViewType>,
): Promise<void> {
  try {
    // Ensure cache directory exists
    const dirInfo = await FileSystem.getInfoAsync(POSTER_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(POSTER_DIR, { intermediates: true });
    }

    // Get the map's snapshot
    const map = mapRef.current;
    if (!map || !('takeSnapshot' in map)) {
      return;
    }

    // takeSnapshot is available on MapView
    const snapshot = await map.takeSnapshot({
      format: 'png',
      quality: 0.6,
      result: 'file',
    });

    if (!snapshot) return;

    // Move to our cache dir with busId
    const posterPath = `${POSTER_DIR}${busId}.png`;
    await FileSystem.moveAsync({
      from: snapshot,
      to: posterPath,
    });

    // Update metadata
    const metadata = await getPosterMetadata();
    metadata[busId] = {
      uri: posterPath,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
  } catch (error) {
    console.warn('Failed to save map poster:', error);
  }
}

/**
 * Load a cached map poster.
 * @param busId - The bus ID to load
 * @returns The poster URI and saved timestamp, or null if not found/expired
 */
export async function loadMapPoster(
  busId: string,
): Promise<{ uri: string; savedAt: number } | null> {
  try {
    const metadata = await getPosterMetadata();
    const poster = metadata[busId];

    if (!poster) {
      return null;
    }

    // Check if file still exists
    const fileInfo = await FileSystem.getInfoAsync(poster.uri);
    if (!fileInfo.exists) {
      // Clean up stale metadata
      delete metadata[busId];
      await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
      return null;
    }

    // Check if poster is recent (5 minutes)
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() - poster.savedAt > fiveMinutes) {
      // Poster expired, clean up
      await clearMapPoster(busId);
      return null;
    }

    return poster;
  } catch (error) {
    console.warn('Failed to load map poster:', error);
    return null;
  }
}

/**
 * Clear a specific bus poster from cache.
 * @param busId - The bus ID to clear
 */
export async function clearMapPoster(busId: string): Promise<void> {
  try {
    const metadata = await getPosterMetadata();
    const poster = metadata[busId];

    if (poster) {
      // Delete the file
      const fileInfo = await FileSystem.getInfoAsync(poster.uri);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(poster.uri, { idempotent: true });
      }

      // Remove from metadata
      delete metadata[busId];
      await AsyncStorage.setItem(METADATA_KEY, JSON.stringify(metadata));
    }
  } catch (error) {
    console.warn('Failed to clear map poster:', error);
  }
}

/**
 * Get all poster metadata from storage.
 */
async function getPosterMetadata(): Promise<PosterCache> {
  try {
    const data = await AsyncStorage.getItem(METADATA_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}