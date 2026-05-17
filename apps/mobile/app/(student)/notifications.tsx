import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

import { colors, spacingExtended, student, touch, typography } from '../../constants/theme';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

// ── Design Tokens ──
const ds = student;

// ── Icons ──
const MapPinIcon = ({ color = ds.primary }: { color?: string }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M12 13a3 3 0 100-6 3 3 0 000 6z" stroke={color} strokeWidth={1.8} />
    <Path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const PhoneIcon = ({ color = ds.primary }: { color?: string }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CheckIcon = ({ color = colors.success.text }: { color?: string }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M20 6L9 17l-5-5" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const BellIcon = ({ color = ds.primary }: { color?: string }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M13.73 21a2 2 0 01-3.46 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const BackIcon = () => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Path d="M19 12H5M5 12l7-7M5 12l7 7" stroke={ds.textInk} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function NotificationsScreen() {
  return (
    <ScreenErrorBoundary screenName="Notifications">
      <NotificationsContent />
    </ScreenErrorBoundary>
  );
}

function NotificationsContent() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [activeTab, setActiveTab] = useState<'All' | 'Trips' | 'System'>('All');
  const [allRead, setAllRead] = useState(false);
  const todayEntering = reduceMotion ? undefined : FadeInDown.duration(400);
  const yesterdayEntering = reduceMotion ? undefined : FadeInDown.duration(400).delay(100);
  const hasUnread = !allRead;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={8}
        >
          <BackIcon />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
        <TouchableOpacity
          disabled={!hasUnread}
          onPress={() => setAllRead(true)}
          accessibilityLabel="Mark all notifications as read"
          accessibilityRole="button"
          accessibilityState={{ disabled: !hasUnread }}
          activeOpacity={touch.feedbackOpacity}
        >
          <Text style={[s.markReadText, !hasUnread && s.markReadDisabled]}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabsWrap}>
        <View style={s.tabsContainer}>
          {['All', 'Trips', 'System'].map((tab) => (
            <TouchableOpacity 
              key={tab} 
              style={[s.tab, activeTab === tab && s.activeTab]}
              onPress={() => setActiveTab(tab as any)}
              activeOpacity={0.8}
              accessibilityLabel={`${tab} notifications`}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab }}
            >
              <Text style={[s.tabText, activeTab === tab && s.activeTabText]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        
        {/* TODAY */}
        <Animated.View entering={todayEntering}>
          <Text style={s.sectionHeader}>TODAY</Text>
          
          <View style={s.card}>
            <View style={[s.iconCircle, { backgroundColor: ds.iconWrapBg }]}>
              <MapPinIcon color={ds.iconMuted} />
            </View>
            <View style={s.cardContent}>
              <View style={s.cardTopRow}>
                <Text style={s.cardTitle}>Bus is 3 min away</Text>
                {hasUnread ? <View style={s.unreadDot} /> : null}
                <View style={s.cardSpacer} />
                <Text style={s.cardTime}>8:11</Text>
              </View>
              <Text style={s.cardDesc}>Arrive at Anna Nagar West by 8:14...</Text>
            </View>
          </View>

          <View style={s.card}>
            <View style={[s.iconCircle, { backgroundColor: colors.info.bg }]}>
              <PhoneIcon color={colors.info.text} />
            </View>
            <View style={s.cardContent}>
              <View style={s.cardTopRow}>
                <Text style={s.cardTitle}>Driver Ravi</Text>
                {hasUnread ? <View style={s.unreadDot} /> : null}
                <View style={s.cardSpacer} />
                <Text style={s.cardTime}>7:58</Text>
              </View>
              <Text style={s.cardDesc}>Running 2 min late due to traffic</Text>
            </View>
          </View>
        </Animated.View>

        {/* YESTERDAY */}
        <Animated.View entering={yesterdayEntering} style={s.yesterdaySection}>
          <Text style={s.sectionHeader}>YESTERDAY</Text>
          
          <View style={s.card}>
            <View style={[s.iconCircle, { backgroundColor: colors.success.bg }]}>
              <CheckIcon />
            </View>
            <View style={s.cardContent}>
              <View style={s.cardTopRow}>
                <Text style={[s.cardTitle, { color: ds.textInk }]}>Checked in successfully</Text>
                <View style={s.cardSpacer} />
                <Text style={s.cardTime}>8:14</Text>
              </View>
              <Text style={s.cardDesc}>Boarded TN-01-AB-1234 at 8:14 AM</Text>
            </View>
          </View>

          <View style={s.card}>
            <View style={[s.iconCircle, { backgroundColor: colors.warning.bg }]}>
              <BellIcon color={colors.warning.text} />
            </View>
            <View style={s.cardContent}>
              <View style={s.cardTopRow}>
                <Text style={[s.cardTitle, { color: ds.textInk }]}>Route changes for tomorrow</Text>
                <View style={s.cardSpacer} />
                <Text style={s.cardTime}>6:30</Text>
              </View>
              <Text style={s.cardDesc}>School assembly: bus departs early</Text>
            </View>
          </View>
        </Animated.View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ds.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacingExtended.screen,
    paddingVertical: 16,
  },
  backBtn: {
    minWidth: touch.minSize,
    minHeight: touch.minSize,
    justifyContent: 'center',
    marginRight: 16,
  },
  headerTitle: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 24,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },
  markReadText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: ds.textMuted,
  },
  markReadDisabled: {
    color: ds.textGhost,
  },
  
  // Tabs
  tabsWrap: {
    alignItems: 'center',
    marginBottom: spacingExtended.section,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: ds.border,
    borderRadius: 24,
    padding: 4,
  },
  tab: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  activeTab: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  tabText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.medium,
    color: ds.textMuted,
  },
  activeTabText: {
    color: ds.textInk,
    fontWeight: typography.weights.bold,
  },

  // Content
  scrollContent: {
    paddingHorizontal: spacingExtended.screen,
    paddingBottom: 40,
  },
  yesterdaySection: {
    marginTop: spacingExtended.section,
  },
  sectionHeader: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
    letterSpacing: 1.2,
    marginBottom: 12,
    marginLeft: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: ds.cardBg,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    shadowColor: colors.black,
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardSpacer: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.error.text,
    marginLeft: 6,
    marginTop: 2,
  },
  cardTime: {
    fontFamily: typography.family,
    fontSize: 11,
    color: ds.textGhost,
  },
  cardDesc: {
    fontFamily: typography.family,
    fontSize: 13,
    color: ds.textMuted,
  },
});
