// app/(student)/_layout.tsx — 4-tab navigator
import { Tabs } from 'expo-router';
import { colors, typography } from '../../constants/theme';

export default function StudentLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.tab.active,
        tabBarInactiveTintColor: colors.tab.inactive,
        tabBarStyle: {
          backgroundColor: colors.tab.bg,
          borderTopWidth: 1,
          borderTopColor: colors.tab.border,
          height: 56,
          paddingBottom: 6,
        },
        tabBarLabelStyle: {
          fontFamily: typography.family,
          fontSize: 11,
          fontWeight: typography.weights.medium,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* Hide tab bar on these full-screen routes */}
      <Tabs.Screen name="scanner" options={{ href: null }} />
      <Tabs.Screen name="checkin-success" options={{ href: null }} />
      <Tabs.Screen name="checkin-fail" options={{ href: null }} />
      <Tabs.Screen name="verify-arrival" options={{ href: null }} />
      <Tabs.Screen name="correction" options={{ href: null }} />
    </Tabs>
  );
}
