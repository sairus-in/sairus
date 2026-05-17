import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Switch, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

import { useAuth } from '../../store/auth.store';
import { useLanguage } from '../../i18n';
import { typography, spacingExtended } from '../../constants/theme';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { performLogout } from '../../lib/logout';

// ── Design Tokens ──
const ds = {
  bg: '#BFE6FF',
  cardBg: '#FFFFFF',
  textInk: '#1A1A1C',
  textMuted: '#565656',
  textGhost: '#C9C9C9',
  primary: '#356C8F',
  successBg: '#E8F5E9',
  successText: '#4CAF50',
  border: '#E9E9E9',
  iconBg: '#BFE6FF',
  avatarBg: '#FFFFFF',
  danger: '#D32F2F',
};

// ── Icons ──
const BellIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M13.73 21a2 2 0 01-3.46 0" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ChatIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const SunIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={1.8} />
    <Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const CrosshairIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={1.8} />
    <Path d="M12 8v8M8 12h8" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const UserIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={1.8} />
    <Path d="M5 20c0-3.31 3.13-6 7-6s7 2.69 7 6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const WarningIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 9v4M12 17h.01" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const PhoneIcon = ({ color = ds.primary }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const LogoutIcon = ({ color = ds.danger }) => (
  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
    <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ChevronRight = () => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M9 18l6-6-6-6" stroke={ds.textGhost} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

export default function ProfileScreen() {
  return (
    <ScreenErrorBoundary screenName="StudentProfile">
      <ProfileContent />
    </ScreenErrorBoundary>
  );
}

function ProfileContent() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const { lang, toggleLanguage, t } = useLanguage();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [sosEnabled, setSosEnabled] = useState(true);

  const handleSignOut = () => {
    Alert.alert(
      t('profile.signOut'),
      t('profile.signOutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.signOut'),
          style: 'destructive',
          onPress: async () => {
            try {
              await performLogout();
              analytics.track('user_logout', { role: 'STUDENT' });
              router.replace('/(auth)/login');
            } catch (err) {
              analytics.error(err as Error, { context: 'logout_failed' });
              await performLogout().catch(() => {});
              router.replace('/(auth)/login');
            }
          },
        },
      ],
    );
  };

  const userName = user?.name || 'Arjun Kumar';
  const avatarInitials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const phone = user?.phone || '+91 98765 43210';
  const rollNumber = user?.rollNumber || 'STU-2847';

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent}>

        {/* Header */}
        <Animated.View entering={FadeInDown.duration(400)} style={s.header}>
          <Text style={s.headerTitle}>Profile</Text>
        </Animated.View>

        {/* Profile Card */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={s.profileCard}>
          <View style={s.avatarWrap}>
            <Text style={s.avatarText}>{avatarInitials}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{userName}</Text>
            <Text style={s.profileMeta}>{phone}</Text>
            <Text style={s.profileMeta}>{rollNumber}</Text>
          </View>
          <TouchableOpacity style={s.editBtn} activeOpacity={0.7}>
            <Text style={s.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* PREFERENCES */}
        <Animated.View entering={FadeInDown.duration(400).delay(200)}>
          <Text style={s.sectionHeader}>PREFERENCES</Text>
          <View style={s.cardGroup}>
            <View style={s.row}>
              <View style={s.rowIcon}><BellIcon /></View>
              <Text style={s.rowLabel}>Notifications</Text>
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ false: '#E0E0E0', true: ds.successText }}
                thumbColor="#FFFFFF"
                style={{ transform: [{ scale: 0.9 }] }}
              />
            </View>
            <View style={s.divider} />
            <TouchableOpacity style={s.row} onPress={toggleLanguage} activeOpacity={0.7}>
              <View style={s.rowIcon}><ChatIcon /></View>
              <Text style={s.rowLabel}>Language</Text>
              <View style={s.rowRight}>
                <Text style={s.rowValue}>{lang === 'ta' ? 'தமிழ்' : 'English'}</Text>
                <ChevronRight />
              </View>
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity style={s.row} activeOpacity={0.7}>
              <View style={s.rowIcon}><SunIcon /></View>
              <Text style={s.rowLabel}>Display</Text>
              <View style={s.rowRight}>
                <Text style={s.rowValue}>Light</Text>
                <ChevronRight />
              </View>
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity style={s.row} activeOpacity={0.7}>
              <View style={s.rowIcon}><CrosshairIcon /></View>
              <Text style={s.rowLabel}>Notify me when</Text>
              <View style={s.rowRight}>
                <ChevronRight />
              </View>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* FAMILY */}
        <Animated.View entering={FadeInDown.duration(400).delay(300)}>
          <Text style={s.sectionHeader}>FAMILY</Text>
          <View style={s.cardGroup}>
            <TouchableOpacity style={s.row} activeOpacity={0.7}>
              <View style={s.rowIcon}><UserIcon /></View>
              <Text style={s.rowLabel}>Trusted contacts</Text>
              <View style={s.rowRight}>
                <Text style={s.rowValue}>2 contacts</Text>
                <ChevronRight />
              </View>
            </TouchableOpacity>
            <View style={s.divider} />
            <View style={s.row}>
              <View style={s.rowIcon}><WarningIcon /></View>
              <Text style={s.rowLabel}>Emergency SOS</Text>
              <Switch
                value={sosEnabled}
                onValueChange={setSosEnabled}
                trackColor={{ false: '#E0E0E0', true: ds.successText }}
                thumbColor="#FFFFFF"
                style={{ transform: [{ scale: 0.9 }] }}
              />
            </View>
          </View>
        </Animated.View>

        {/* ACCOUNT */}
        <Animated.View entering={FadeInDown.duration(400).delay(400)}>
          <Text style={s.sectionHeader}>ACCOUNT</Text>
          <View style={s.cardGroup}>
            <TouchableOpacity style={s.row} activeOpacity={0.7}>
              <View style={s.rowIcon}><PhoneIcon /></View>
              <Text style={s.rowLabel}>Help & Support</Text>
              <ChevronRight />
            </TouchableOpacity>
            <View style={s.divider} />
            <TouchableOpacity style={s.row} onPress={handleSignOut} activeOpacity={0.7}>
              <View style={s.rowIcon}><LogoutIcon /></View>
              <Text style={[s.rowLabel, { color: ds.danger }]}>Sign out</Text>
            </TouchableOpacity>
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
  scrollContent: {
    paddingHorizontal: spacingExtended.screen,
    paddingBottom: 100,
  },
  header: {
    paddingVertical: 16,
    marginBottom: 8,
  },
  headerTitle: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },

  // Profile Card
  profileCard: {
    backgroundColor: ds.cardBg,
    borderRadius: 28,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: ds.avatarBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontFamily: typography.family,
    fontSize: 20,
    fontWeight: typography.weights.bold,
    color: ds.primary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontFamily: typography.family,
    fontSize: 18,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
    marginBottom: 4,
  },
  profileMeta: {
    fontFamily: typography.family,
    fontSize: 12,
    color: ds.textMuted,
    marginTop: 2,
  },
  editBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: ds.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  editBtnText: {
    fontFamily: typography.family,
    fontSize: 13,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },

  // Sections
  sectionHeader: {
    fontFamily: typography.family,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
    letterSpacing: 1.2,
    marginBottom: 12,
    marginLeft: 8,
  },
  cardGroup: {
    backgroundColor: ds.cardBg,
    borderRadius: 24,
    paddingVertical: 8,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ds.iconBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rowLabel: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.medium,
    color: ds.textInk,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowValue: {
    fontFamily: typography.family,
    fontSize: 14,
    color: ds.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: '#F5F5F5',
    marginLeft: 68,
    marginRight: 16,
  },
});
