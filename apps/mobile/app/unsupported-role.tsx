import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../store/auth.store';
import { typography } from '../constants/theme';
import { performLogout } from '../lib/logout';

const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
};

export default function UnsupportedRoleScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const handleLogout = async () => {
    await performLogout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.layout}>
        <Text style={s.label}>Access restricted</Text>
        <Text style={s.title}>Role not supported</Text>
        <Text style={s.body}>
          {user?.role ?? 'This role'} doesn't have a mobile workflow yet.
          Please use the admin system or contact transport operations.
        </Text>
        <TouchableOpacity style={s.btn} onPress={handleLogout} activeOpacity={0.85}>
          <Text style={s.btnLabel}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
  },
  layout: {
    paddingHorizontal: 28,
    gap: 12,
  },
  label: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.muted,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 28,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },
  body: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
    lineHeight: 23,
    marginTop: 2,
  },
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  btnLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
});
