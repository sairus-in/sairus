// app/(auth)/login.tsx - Phone number entry screen
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { sendPhoneOtp } from '../../lib/phone-auth';

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = phone.replace(/\D/g, '').length === 10;

  const handleSendOTP = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const verificationId = await sendPhoneOtp(cleanPhone);

      router.push({
        pathname: '/(auth)/verify-otp',
        params: { phone: cleanPhone, verificationId },
      });
    } catch (err: any) {
      if (err.code === 'auth/invalid-phone-number') {
        setError(t('auth.invalidPhone'));
      } else if (err.code === 'auth/too-many-requests' || err.code === 'auth/quota-exceeded') {
        setError(t('auth.tooManyAttempts'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.logoArea}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoIcon}>Bus</Text>
          </View>
          <Text style={styles.appName}>{t('auth.appName')}</Text>
        </View>

        <View style={styles.inputArea}>
          <Text style={styles.label}>{t('auth.phoneLabel')}</Text>
          <View style={styles.inputRow}>
            <View style={styles.prefix}>
              <Text style={styles.prefixText}>+91</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="98765 43210"
              placeholderTextColor={colors.text.muted}
              keyboardType="phone-pad"
              maxLength={12}
              value={phone}
              onChangeText={(text) => {
                setPhone(text);
                setError(null);
              }}
              autoFocus
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, !isValid && styles.buttonDisabled]}
            onPress={handleSendOTP}
            disabled={!isValid || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.button.primary.text} />
            ) : (
              <Text style={styles.buttonText}>{t('auth.sendOtp')}</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footnote}>{t('auth.registeredOnly')}</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  logoArea: {
    alignItems: 'center',
    marginBottom: spacing['3xl'],
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand.light,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoIcon: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.bold,
    color: colors.brand.primary,
  },
  appName: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
    letterSpacing: -0.5,
  },
  inputArea: {
    width: '100%',
  },
  label: {
    fontFamily: typography.family,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.input,
    overflow: 'hidden',
  },
  prefix: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.neutral.bg,
    borderRightWidth: 1,
    borderRightColor: colors.card.border,
  },
  prefixText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
  },
  input: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: typography.sizes.h2,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  error: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.error.text,
    marginTop: spacing.xs,
  },
  button: {
    backgroundColor: colors.button.primary.bg,
    paddingVertical: 15,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    width: '100%',
    minHeight: 50,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.button.primary.text,
  },
  footnote: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
