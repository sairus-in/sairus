import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { brand, gradients, radius } from '../../constants/brand';

interface GlossCardProps {
  width: number;
  height: number;
  children?: React.ReactNode;
  /** Override the default 38px corner radius. */
  cornerRadius?: number;
  style?: ViewStyle;
}

// Dark gloss surface — diagonal multi-stop gradient + soft inner stroke glow.
// Matches the design's Group 145 attendance stats card.
// Content is rendered above the gloss via absolute positioning.
export function GlossCard({
  width,
  height,
  children,
  cornerRadius = radius['2xl'],
  style,
}: GlossCardProps) {
  const spec = gradients.darkGloss;

  return (
    <View style={[styles.wrapper, { width, height }, style]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFillObject}>
        <Defs>
          <SvgLinearGradient id="dark-gloss" x1="100%" y1="0%" x2="0%" y2="100%">
            {spec.stops.map((stop, i) => (
              <Stop key={i} offset={`${stop.offset * 100}%`} stopColor={stop.color} />
            ))}
          </SvgLinearGradient>
        </Defs>

        {/* Outer surface — the gloss */}
        <Rect
          x={1}
          y={1}
          width={width - 2}
          height={height - 2}
          rx={cornerRadius}
          fill="url(#dark-gloss)"
          stroke={brand.neutral[600]}
          strokeWidth={2}
        />

        {/* Inner soft stroke — gives the edge an inner-glow feel. RN-SVG can't do
            feGaussianBlur as a layered filter reliably across iOS+Android, so this is
            a lighter inner stroke at lower opacity. */}
        <Rect
          x={14}
          y={14}
          width={width - 28}
          height={height - 28}
          rx={cornerRadius - 10}
          fill="none"
          stroke="rgba(93, 93, 93, 0.45)"
          strokeWidth={5}
        />
      </Svg>

      <View style={styles.content} pointerEvents="box-none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
});
