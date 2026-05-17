import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { brand, elevation, space } from '../../../constants/brand';
import { type } from '../../../constants/typography';

interface HomeHeaderProps {
  greeting: string;
  name: string;
  date: string;
  initial: string;
  unreadCount?: number;
}

// Top of the home screen — "Hello / Kristen", bell with star badge, avatar, date.
// Reads from props only; no data fetching here.
export function HomeHeader({ greeting, name, date, initial, unreadCount = 0 }: HomeHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.row}>
      <View style={styles.greetingBlock}>
        <Text style={styles.hello} accessibilityRole="header">
          {greeting}
        </Text>
        <Text style={styles.name}>{name}</Text>
      </View>

      <View style={styles.right}>
        <Pressable
          onPress={() => router.push('/(student)/notifications')}
          style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          hitSlop={8}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Path
              d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"
              stroke={brand.ink[900]}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M13.73 21a2 2 0 01-3.46 0"
              stroke={brand.ink[900]}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          {unreadCount > 0 ? (
            <View style={styles.bellBadge}>
              <Svg width={10} height={10} viewBox="0 0 24 24">
                <Path
                  d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"
                  fill={brand.ink[900]}
                />
              </Svg>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.avatarColumn}>
          <Pressable
            onPress={() => router.push('/(student)/profile')}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Profile"
            hitSlop={4}
          >
            <Svg width={44} height={44} viewBox="0 0 44 44">
              <Circle cx={22} cy={22} r={22} fill={brand.neutral[0]} />
            </Svg>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </Pressable>
          <Text style={styles.date}>{date}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  greetingBlock: {
    flex: 1,
    paddingTop: 4,
  },
  hello: {
    ...type.display.xl,
    color: brand.ink[900],
  },
  name: {
    ...type.body.lg,
    color: brand.neutral[0],
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: brand.neutral[0],
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.card,
  },
  bellBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  avatarColumn: {
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.card,
  },
  avatarInitial: {
    position: 'absolute',
    ...type.display.lg,
    fontSize: 20,
    color: brand.ink[900],
  },
  date: {
    ...type.body.xs,
    color: brand.neutral[0],
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
});
