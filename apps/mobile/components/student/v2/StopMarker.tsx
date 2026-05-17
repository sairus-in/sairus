import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker } from 'react-native-maps';
import { brand } from '../../../constants/brand';

interface StopMarkerProps {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sequence: number;
  passed: boolean;
  isMyStop: boolean;
}

/**
 * Stop marker component - small dot for regular stops, larger pin for student's stop.
 */
export function StopMarker({
  id,
  name,
  lat,
  lon,
  sequence,
  passed,
  isMyStop,
}: StopMarkerProps) {
  const coordinate = { latitude: lat, longitude: lon };

  if (isMyStop) {
    // Student's own stop - larger pin with label
    return (
      <Marker
        coordinate={coordinate}
        tracksViewChanges={false}
        anchor={{ x: 0.5, y: 1 }}
      >
        <View style={styles.myStopContainer}>
          <View style={styles.myStopPin}>
            <Text style={styles.myStopLabel}>{name}</Text>
          </View>
          <View style={styles.myStopPoint} />
        </View>
      </Marker>
    );
  }

  // Regular stop
  return (
    <Marker
      coordinate={coordinate}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View
        style={[
          styles.stopDot,
          passed ? styles.passedDot : styles.upcomingDot,
        ]}
      />
    </Marker>
  );
}

const styles = StyleSheet.create({
  stopDot: {
    borderRadius: 5,
  },
  passedDot: {
    width: 8,
    height: 8,
    backgroundColor: brand.neutral[400],
  },
  upcomingDot: {
    width: 10,
    height: 10,
    backgroundColor: brand.blue[600],
    borderWidth: 2,
    borderColor: 'white',
  },
  myStopContainer: {
    alignItems: 'center',
  },
  myStopPin: {
    backgroundColor: brand.blue[600],
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: -4,
  },
  myStopLabel: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  myStopPoint: {
    width: 12,
    height: 12,
    backgroundColor: brand.blue[600],
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'white',
  },
});