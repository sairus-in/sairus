import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { brand, elevation, radius, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';

type TabKey = 'profile' | 'map' | 'home' | 'announcements' | 'settings';

interface HomeTabBarProps {
  active: TabKey;
}

interface TabSpec {
  key: TabKey;
  label: string;
  path: string;
  icon: (active: boolean) => React.ReactNode;
}

function PersonIcon({ active }: { active: boolean }) {
  const color = active ? brand.ink[900] : brand.ink[500];
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={1.8} />
      <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function MapPinIcon({ active }: { active: boolean }) {
  const color = active ? brand.ink[900] : brand.ink[500];
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={9} r={2.5} stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

function HomeIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2v-9z"
        stroke={brand.neutral[0]}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function AnnouncementIcon({ active }: { active: boolean }) {
  const color = active ? brand.ink[900] : brand.ink[500];
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={1.8} />
      <Path d="M9.5 16V8h2.5l4 8V8" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  const color = active ? brand.ink[900] : brand.ink[500];
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={1.8} />
      <Path
        d="M19.4 15a1.7 1.7 0 00.4 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.4 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.4l-.1.1A2 2 0 114.2 17l.1-.1a1.7 1.7 0 00.4-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.4-1.9L4.1 7A2 2 0 117 4.2l.1.1a1.7 1.7 0 001.9.4H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.4l.1-.1A2 2 0 1119.8 7l-.1.1a1.7 1.7 0 00-.4 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const tabs: TabSpec[] = [
  { key: 'profile', label: 'Profile', path: '/(student)/profile', icon: (a) => <PersonIcon active={a} /> },
  { key: 'map', label: 'Map', path: '/(student)/map', icon: (a) => <MapPinIcon active={a} /> },
  { key: 'home', label: 'Home', path: '/(student)/', icon: () => <HomeIcon /> },
  {
    key: 'announcements',
    label: 'Announcements',
    path: '/(student)/notifications',
    icon: (a) => <AnnouncementIcon active={a} />,
  },
  { key: 'settings', label: 'Settings', path: '/(student)/profile', icon: (a) => <SettingsIcon active={a} /> },
];

// Bottom tab bar with a raised center home button. Icons: profile, map, home (raised),
// announcements, settings. Center home gets haptic feedback on press.
export function HomeTabBar({ active }: HomeTabBarProps) {
  const router = useRouter();

  const handlePress = (tab: TabSpec) => {
    if (tab.key === 'home') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    if (tab.key !== active) {
      router.push(tab.path as never);
    }
  };

  return (
    <View style={styles.outer} pointerEvents="box-none">
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          if (tab.key === 'home') {
            return (
              <Pressable
                key={tab.key}
                onPress={() => handlePress(tab)}
                style={({ pressed }) => [styles.centerSlot, pressed && { transform: [{ scale: 0.94 }] }]}
                accessibilityRole="button"
                accessibilityLabel="Home"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.centerButton}>{tab.icon(true)}</View>
              </Pressable>
            );
          }
          return (
            <Pressable
              key={tab.key}
              onPress={() => handlePress(tab)}
              style={({ pressed }) => [styles.slot, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: isActive }}
              hitSlop={4}
            >
              {tab.icon(isActive)}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.md,
    paddingBottom: space.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: brand.neutral[0],
    borderRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    height: 70,
    ...elevation.tabBar,
  },
  slot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSlot: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: brand.ink[900],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    ...elevation.button,
    shadowColor: brand.ink[900],
  },
});
