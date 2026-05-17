import React from 'react';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import type { TextStyle } from 'react-native';
import { gradients } from '../../constants/brand';

interface GradientTextProps {
  children: string;
  /**
   * One of the named gradient keys. Defaults to `softPastel` which is the wordmark gradient.
   */
  gradient?: keyof typeof gradients;
  /** Pixel width to allocate for the SVG — should accommodate the rendered text. */
  width: number;
  /** Pixel height. */
  height: number;
  /** Font style — fontFamily + fontSize + letterSpacing. fontWeight is ignored by RN-SVG. */
  style?: TextStyle;
  /** Text anchor — `start | middle | end`. Defaults to start. */
  anchor?: 'start' | 'middle' | 'end';
  testID?: string;
}

// Renders text filled with a multi-stop linear gradient via react-native-svg.
// React Native has no `background-clip: text` equivalent so this is the canonical
// way to ship gradient-filled type. Used for wordmarks like "SCHOOLDAYS" / section codes.
export function GradientText({
  children,
  gradient = 'softPastel',
  width,
  height,
  style,
  anchor = 'start',
  testID,
}: GradientTextProps) {
  const spec = gradients[gradient];
  const gradientId = `grad-${gradient}-${children.length}`;

  // Convert angle to x1/y1/x2/y2. Angle 110° means a 110° rotation clockwise from horizontal.
  const rad = (spec.angle * Math.PI) / 180;
  const x2 = Math.cos(rad);
  const y2 = Math.sin(rad);

  const x = anchor === 'start' ? 0 : anchor === 'middle' ? width / 2 : width;

  return (
    <Svg width={width} height={height} testID={testID}>
      <Defs>
        <LinearGradient
          id={gradientId}
          x1={x2 < 0 ? '100%' : '0%'}
          y1={y2 < 0 ? '100%' : '0%'}
          x2={x2 < 0 ? '0%' : '100%'}
          y2={y2 < 0 ? '0%' : '100%'}
        >
          {spec.stops.map((stop, i) => (
            <Stop key={i} offset={`${stop.offset * 100}%`} stopColor={stop.color} />
          ))}
        </LinearGradient>
      </Defs>
      <SvgText
        x={x}
        y={height * 0.78}
        textAnchor={anchor === 'start' ? 'start' : anchor === 'middle' ? 'middle' : 'end'}
        fontFamily={style?.fontFamily}
        fontSize={style?.fontSize}
        letterSpacing={(style?.letterSpacing as number) ?? 0}
        fill={`url(#${gradientId})`}
      >
        {children}
      </SvgText>
    </Svg>
  );
}
