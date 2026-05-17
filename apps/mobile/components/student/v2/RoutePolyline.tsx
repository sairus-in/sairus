import React from 'react';
import { Polyline } from 'react-native-maps';
import type { LatLng } from 'react-native-maps';
import { brand } from '../../../constants/brand';

interface RoutePolylineProps {
  /**
   * Array of [lat, lon] coordinate pairs
   */
  polyline: Array<[number, number]>;
  /**
   * Index where the "passed" segment ends (i.e., first index of upcoming)
   */
  splitIndex?: number;
}

/**
 * Route polyline with two segments: past (gray) and upcoming (blue).
 */
export function RoutePolyline({ polyline, splitIndex }: RoutePolylineProps) {
  if (!polyline || polyline.length < 2) {
    return null;
  }

  // Convert [number, number][] to LatLng[]
  const toLatLng = (arr: Array<[number, number]>): LatLng[] =>
    arr.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));

  const pastSegments = splitIndex !== undefined && splitIndex > 0
    ? polyline.slice(0, splitIndex + 1)
    : [];
  const upcomingSegments = splitIndex !== undefined
    ? polyline.slice(splitIndex)
    : polyline;

  return (
    <>
      {/* Past segment - gray */}
      {pastSegments.length >= 2 && (
        <Polyline
          coordinates={toLatLng(pastSegments)}
          strokeColor={brand.neutral[400]}
          strokeWidth={4}
          lineCap="round"
          lineJoin="round"
        />
      )}

      {/* Upcoming segment - blue */}
      {upcomingSegments.length >= 2 && (
        <Polyline
          coordinates={toLatLng(upcomingSegments)}
          strokeColor={brand.blue[700]}
          strokeWidth={5}
          lineCap="round"
          lineJoin="round"
        />
      )}
    </>
  );
}