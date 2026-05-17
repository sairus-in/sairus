import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { brand } from '../../constants/brand';
import { StarBurst } from './StarBurst';

// Full-screen atmospheric canvas: vertical blue gradient + layered starburst pattern.
// Renders as the bottommost layer of every redesigned mobile screen.
//
// The pattern is hand-placed to match the home screen mockup — three large stars in
// the corners + one off-screen edge accent. Static; reduced-motion safe by default.
export function AtmosphericBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[brand.blue[500], brand.blue[600], brand.blue[700]]}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Top-left, peeking off the edge */}
      <View style={[styles.star, { top: -80, left: -90 }]}>
        <StarBurst size={300} rotation={18} opacity={0.85} />
      </View>

      {/* Top-right, near the avatar */}
      <View style={[styles.star, { top: -40, right: -70 }]}>
        <StarBurst size={260} rotation={-32} opacity={0.7} />
      </View>

      {/* Mid-right, partially behind the bus card */}
      <View style={[styles.star, { top: 280, right: -130 }]}>
        <StarBurst size={280} rotation={48} opacity={0.55} />
      </View>

      {/* Bottom-left, behind tab area */}
      <View style={[styles.star, { bottom: -90, left: -80 }]}>
        <StarBurst size={280} rotation={-12} opacity={0.55} />
      </View>

      {/* Bottom-right edge */}
      <View style={[styles.star, { bottom: 40, right: -100 }]}>
        <StarBurst size={220} rotation={68} opacity={0.4} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  star: {
    position: 'absolute',
  },
});
