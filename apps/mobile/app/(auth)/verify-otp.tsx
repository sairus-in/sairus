// app/(auth)/verify-otp.tsx - 6-digit OTP verification
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import { authService } from '../../services/auth.service';
import { clearPhoneAuthSession, sendPhoneOtp, verifyPhoneOtp } from '../../lib/phone-auth';
import { normalizeMobileProfile } from '../../lib/mobile-profile';
import { ApiError } from '../../lib/api.client';
import { getOrCreateDeviceId } from '../../lib/session-storage';
import { useAuth } from '../../store/auth.store';

export default function VerifyOTPScreen() {
  const params = useLocalSearchParams<{ phone: string; verificationId: string }>();
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(30);
  const [verificationId, setVerificationId] = useState(params.verificationId ?? '');
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const setAuthenticatedSession = useAuth(s => s.setAuthenticatedSession);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => setResendTimer((value) => value - 1), 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const code = otp.join('');
  const isComplete = code.length === 6;

  const handleDigitChange = (value: string, index: number) => {
    const nextValue = value.length > 1 ? value[value.length - 1] : value;
    const nextOtp = [...otp];
    nextOtp[index] = nextValue;
    setOtp(nextOtp);
    setError(null);

    if (nextValue && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (event: any, index: number) => {
    if (event.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (!isComplete || !verificationId) return;
    setLoading(true);
    setError(null);

    try {
      const firebaseToken = await verifyPhoneOtp(verificationId, code);
      const deviceId = await getOrCreateDeviceId();

      const response = await authService.login({
        firebaseToken,
        deviceId,
      });

      await setAuthenticatedSession(normalizeMobileProfile(response.user), {
        token: response.token,
        deviceId,
      });
      await clearPhoneAuthSession().catch(() => {});
    } catch (err: unknown) {
      const codeOrError = err instanceof ApiError ? err.code : (err as { code?: string }).code;

      if (codeOrError === 'auth/invalid-verification-code' || codeOrError === 'auth/invalid-verification-id') {
        setError(t('auth.incorrectOtp', { attempts: '2' }));
      } else if (codeOrError === 'auth/session-expired' || codeOrError === 'auth/code-expired') {
        setError(t('auth.otpExpired'));
      } else if (codeOrError === 'USER_NOT_REGISTERED') {
        setError(t('auth.unregisteredPhone'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    if (resendTimer > 0 || !params.phone) return;

    setLoading(true);
    setError(null);

    void sendPhoneOtp(params.phone, true)
      .then((nextVerificationId) => {
        setVerificationId(nextVerificationId);
        setResendTimer(30);
      })
      .catch((err: any) => {
        if (err.code === 'auth/too-many-requests' || err.code === 'auth/quota-exceeded') {
          setError(t('auth.tooManyAttempts'));
          return;
        }

        setError(t('common.error'));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  const maskedPhone = params.phone
    ? `${params.phone.slice(0, 4)}XX ${params.phone.slice(6)}`
    : '';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>{t('auth.enterOtp')}</Text>
        <Text style={styles.subtitle}>{t('auth.sentTo', { phone: maskedPhone })}</Text>

        <View style={styles.otpRow}>
          {otp.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
              value={digit}
              onChangeText={(value) => handleDigitChange(value, index)}
              onKeyPress={(event) => handleKeyPress(event, index)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          ))}
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, !isComplete && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={!isComplete || loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={colors.button.primary.text} />
          ) : (
            <Text style={styles.buttonText}>{t('auth.verify')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleResend}
          disabled={resendTimer > 0 || loading}
          style={styles.resend}
        >
          <Text style={[styles.resendText, (resendTimer > 0 || loading) && styles.resendDisabled]}>
            {resendTimer > 0
              ? t('auth.resendIn', { seconds: String(resendTimer) })
              : t('auth.resendOtp')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  inner: {
    flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl,
  },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: colors.text.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, textAlign: 'center',
    marginTop: spacing.xs, marginBottom: spacing['2xl'],
  },
  otpRow: {
    flexDirection: 'row', justifyContent: 'center', gap: spacing.xs,
  },
  otpBox: {
    width: 48, height: 56, borderWidth: 1.5, borderColor: colors.card.border,
    borderRadius: radii.input, textAlign: 'center',
    fontSize: typography.sizes.h1, fontWeight: typography.weights.bold,
    fontFamily: typography.family, color: colors.text.primary,
    backgroundColor: colors.card.bg,
  },
  otpBoxFilled: { borderColor: colors.brand.primary },
  error: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.error.text, textAlign: 'center', marginTop: spacing.md,
  },
  button: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    borderRadius: radii.button, alignItems: 'center',
    marginTop: spacing.xl, minHeight: 50,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
  resend: { marginTop: spacing.lg, alignItems: 'center' },
  resendText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium, color: colors.brand.primary,
  },
  resendDisabled: { color: colors.text.muted },
});
