import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../store/auth.store';
import { colors, spacing, typography, radii } from '../constants/theme';
import { performLogout } from '../lib/logout';

export default function UnsupportedRoleScreen() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const handleLogout = async () => {
    await performLogout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Role Not Supported</Text>
        <Text style={styles.body}>
          {user?.role ?? 'This role'} does not have a mobile workflow yet. Please use the admin system or contact transport operations.
        </Text>
        <TouchableOpacity style={styles.button} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.buttonText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.md,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
  },
  body: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.secondary,
    lineHeight: 22,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.button.primary.bg,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    color: colors.button.primary.text,
  },
});
