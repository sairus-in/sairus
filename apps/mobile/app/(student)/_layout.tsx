// app/(student)/_layout.tsx — Bottom tab navigator with warm design
import { Tabs } from 'expo-router';
import Svg, { Path, Circle } from 'react-native-svg';
import { typography } from '../../constants/theme';

// ── Design tokens consistent with auth screens ──
const tabColors = {
  bg: '#BFE6FF',
  active: '#1A1A1C',
  inactive: '#C9C9C9',
  border: '#E9E9E9',
} as const;

const hiddenRouteOptions = {
  href: null,
  tabBarStyle: { display: 'none' as const },
};

// ── Tab icons (SVG, not Lucide, to match screenshot exactly) ──
function HomeIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M9 21V12h6v9" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MapIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 13a3 3 0 100-6 3 3 0 000 6z"
        stroke={color}
        strokeWidth={1.8}
      />
      <Path
        d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function HistoryIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.8} />
      <Path d="M12 7v5l3 3" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ProfileIcon({ color, size }: { color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={1.8} />
      <Path
        d="M5 20c0-3.31 3.13-6 7-6s7 2.69 7 6"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function StudentLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: tabColors.active,
        tabBarInactiveTintColor: tabColors.inactive,
        tabBarStyle: {
          backgroundColor: tabColors.bg,
          borderTopWidth: 1,
          borderTopColor: tabColors.border,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontFamily: typography.family,
          fontSize: 10,
          fontWeight: typography.weights.medium,
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <HomeIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <MapIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => <HistoryIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <ProfileIcon color={color} size={size} />,
        }}
      />
      {/* Hide tab bar on secondary and full-screen routes */}
      <Tabs.Screen name="scanner" options={hiddenRouteOptions} />
      <Tabs.Screen name="checkin-success" options={hiddenRouteOptions} />
      <Tabs.Screen name="checkin-fail" options={hiddenRouteOptions} />
      <Tabs.Screen name="verify-arrival" options={hiddenRouteOptions} />
      <Tabs.Screen name="self-report-prompt" options={hiddenRouteOptions} />
      <Tabs.Screen name="notifications" options={hiddenRouteOptions} />
      <Tabs.Screen name="correction/[logId]" options={hiddenRouteOptions} />
    </Tabs>
  );
}
