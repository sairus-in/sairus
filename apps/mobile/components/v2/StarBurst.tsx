import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { brand } from '../../constants/brand';

interface StarBurstProps {
  size?: number;
  opacity?: number;
  rotation?: number;
}

// Three concentric layered stars in the brand blues, traced from real star.svg.
// Pure decoration — no semantics. Receivers position with absolute placement.
export function StarBurst({ size = 240, opacity = 1, rotation = 0 }: StarBurstProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="-95 -76 336 324"
      style={{ opacity, transform: [{ rotate: `${rotation}deg` }] }}
      pointerEvents="none"
    >
      <Path
        d="M121.678 -43.3014L75.9156 32.7648L135.285 99.8446L47.633 79.7763L1.87073 155.843L-6.53894 67.3734L-94.1909 47.3051L-11.7364 12.6965L-20.1461 -75.7727L39.2233 -8.69282L121.678 -43.3014Z"
        fill={brand.blue[50]}
      />
      <Path
        d="M96.7395 -21.7758L63.2774 33.845L106.689 82.8948L42.5967 68.2205L9.13469 123.841L2.98543 59.1513L-61.1071 44.477L-0.815039 19.1707L-6.96431 -45.5193L36.4475 3.53051L96.7395 -21.7758Z"
        fill={brand.blue[300]}
      />
      <Path
        d="M77.1937 -5.0784L53.6804 34.6569L85.2427 70.3183L39.1483 59.2146L15.6349 98.9499L10.6604 52.3522L-35.4339 41.2485L7.586 23.5532L2.61149 -23.0445L34.1738 12.6169L77.1937 -5.0784Z"
        fill={brand.blue[600]}
      />
    </Svg>
  );
}
