// DEV ONLY — floating role-switcher overlay.
// Mounted in the root layout, gated behind __DEV__, zero production footprint.
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useAuth } from '../../store/auth.store';
import { DEV_FIXTURES, DEV_ROLE_LABELS, type DevRole } from '../../lib/dev-fixtures';

const ROLES: DevRole[] = ['student', 'student-no-route', 'driver'];

export function DevRoleOverlay() {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<DevRole | null>(null);

  const currentUser = useAuth(s => s.user);
  const setAuthenticatedSession = useAuth(s => s.setAuthenticatedSession);
  const clearUser = useAuth(s => s.clearUser);

  const panelScale = useSharedValue(0.85);
  const panelOpacity = useSharedValue(0);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ scale: panelScale.value }],
    opacity: panelOpacity.value,
  }));

  const toggle = () => {
    if (!open) {
      panelScale.value = withSpring(1, { damping: 14, stiffness: 260 });
      panelOpacity.value = withTiming(1, { duration: 150 });
    } else {
      panelScale.value = withTiming(0.85, { duration: 120 });
      panelOpacity.value = withTiming(0, { duration: 120 });
    }
    setOpen(v => !v);
  };

  const switchRole = async (role: DevRole) => {
    setSwitching(role);
    await setAuthenticatedSession(DEV_FIXTURES[role], {
      token: `dev_token_${role}_${Date.now()}`,
      deviceId: 'dev_device_001',
    });
    setSwitching(null);
    setOpen(false);
    panelScale.value = 0.85;
    panelOpacity.value = 0;
  };

  const logout = async () => {
    await clearUser();
    setOpen(false);
    panelScale.value = 0.85;
    panelOpacity.value = 0;
  };

  const currentRole = currentUser?.role ?? 'none';
  const currentRoleLabel =
    currentUser?.role === 'STUDENT' && !currentUser.routeAssignment
      ? DEV_ROLE_LABELS['student-no-route']
      : currentUser?.role === 'STUDENT'
        ? DEV_ROLE_LABELS['student']
        : currentUser?.role === 'DRIVER'
          ? DEV_ROLE_LABELS['driver']
          : 'Not logged in';

  return (
    <View style={s.anchor} pointerEvents="box-none">
      {/* Expanded panel */}
      {open && (
        <Animated.View style={[s.panel, panelStyle]}>
          <Text style={s.panelHeader}>DEV</Text>
          <Text style={s.currentRoleLabel}>Now: {currentRoleLabel}</Text>

          <View style={s.divider} />

          {ROLES.map((role) => {
            const isActive =
              currentRole === 'STUDENT' && role === 'student' && !!currentUser?.routeAssignment ||
              currentRole === 'STUDENT' && role === 'student-no-route' && !currentUser?.routeAssignment ||
              currentRole === 'DRIVER' && role === 'driver';

            return (
              <TouchableOpacity
                key={role}
                style={[s.roleRow, isActive && s.roleRowActive]}
                onPress={() => switchRole(role)}
                disabled={!!switching}
                activeOpacity={0.7}
              >
                {switching === role
                  ? <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 6 }} />
                  : <View style={[s.dot, isActive && s.dotActive]} />
                }
                <Text style={[s.roleText, isActive && s.roleTextActive]}>
                  {DEV_ROLE_LABELS[role]}
                </Text>
              </TouchableOpacity>
            );
          })}

          <View style={s.divider} />

          <TouchableOpacity style={s.logoutRow} onPress={logout} disabled={!!switching} activeOpacity={0.7}>
            <Text style={s.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Floating badge */}
      <TouchableOpacity style={s.badge} onPress={toggle} activeOpacity={0.8}>
        <Text style={s.badgeText}>{open ? '✕' : 'DEV'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  anchor: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 48 : 24,
    right: 16,
    alignItems: 'flex-end',
    zIndex: 9999,
  },
  badge: {
    backgroundColor: '#356C8F',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
    marginTop: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  panel: {
    backgroundColor: '#1A1714',
    borderRadius: 16,
    padding: 14,
    minWidth: 180,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
    transformOrigin: 'bottom right',
  },
  panelHeader: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 4,
  },
  currentRoleLabel: {
    color: '#C9C9C9',
    fontSize: 11,
  },
  divider: {
    height: 1,
    backgroundColor: '#356C8F',
    marginVertical: 10,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 8,
  },
  roleRowActive: {
    backgroundColor: '#356C8F',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#555',
  },
  dotActive: {
    backgroundColor: '#A3D977',
  },
  roleText: {
    color: '#C9C9C9',
    fontSize: 13,
    fontWeight: '500',
  },
  roleTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  logoutRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  logoutText: {
    color: '#E57373',
    fontSize: 12,
    fontWeight: '500',
  },
});
