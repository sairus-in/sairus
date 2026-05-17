// app/(auth)/login.tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import Svg, { Path, Circle } from 'react-native-svg';
import { typography } from '../../constants/theme';
import { t } from '../../i18n';
import { sendPhoneOtp } from '../../lib/phone-auth';

// ── Local tokens ─────────────────────────────────────────────────
const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  border: '#E9E9E9',
  borderFocus: '#356C8F',
  inputBg: '#FFFFFF',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  errorText: '#A6423A',
  errorBg: '#F4E1DF',
  link: '#356C8F',
  accent: '#356C8F',
};

// ── Bus SVG (no background box — clean mark) ─────────────────────
function BusMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 16V7a4 4 0 014-4h8a4 4 0 014 4v9a2 2 0 01-2 2H6a2 2 0 01-2-2z"
        stroke={C.accent}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M4 10h16" stroke={C.accent} strokeWidth={1.6} strokeLinecap="round" />
      <Circle cx="8" cy="17" r="1.5" fill={C.accent} />
      <Circle cx="16" cy="17" r="1.5" fill={C.accent} />
      <Path d="M8 3v3M16 3v3" stroke={C.accent} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

// ── Screen ───────────────────────────────────────────────────────
export default function LoginScreen() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const buttonScale = useSharedValue(1);
  const errorShake = useSharedValue(0);
  const inputBorder = useSharedValue(0);

  const isValid = phone.replace(/\D/g, '').length === 10;

  useEffect(() => {
    inputBorder.value = reduceMotion
      ? (isFocused ? 1 : 0)
      : withTiming(isFocused ? 1 : 0, { duration: 180 });
  }, [isFocused, inputBorder, reduceMotion]);

  const triggerShake = useCallback(() => {
    if (reduceMotion) return;
    errorShake.value = withSequence(
      withTiming(8, { duration: 50 }), withTiming(-8, { duration: 50 }),
      withTiming(6, { duration: 50 }), withTiming(-6, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [errorShake, reduceMotion]);

  const handleSendOTP = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    if (!reduceMotion) {
      buttonScale.value = withSequence(
        withSpring(0.97, { damping: 15, stiffness: 400 }),
        withSpring(1, { damping: 15, stiffness: 400 }),
      );
    }

    try {
      const clean = phone.replace(/\D/g, '');
      const verificationId = await sendPhoneOtp(clean);
      router.push({ pathname: '/(auth)/verify-otp', params: { phone: clean, verificationId } });
    } catch (err: any) {
      if (err.code === 'auth/invalid-phone-number') setError(t('auth.invalidPhone'));
      else if (err.code === 'auth/too-many-requests' || err.code === 'auth/quota-exceeded') setError(t('auth.tooManyAttempts'));
      else setError(t('common.error'));
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
    opacity: interpolate(buttonScale.value, [0.97, 1], [0.88, 1], Extrapolation.CLAMP),
  }));

  const inputStyle = useAnimatedStyle(() => ({
    borderColor: interpolate(inputBorder.value, [0, 1], [0, 1], Extrapolation.CLAMP) > 0.5
      ? C.borderFocus : C.border,
  }));

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: errorShake.value }],
  }));

  return (
    <SafeAreaView style={s.container}>
      <KeyboardAvoidingView style={s.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.layout}>

          {/* ── Brand mark ── */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(400).delay(60)}
            style={s.brandArea}
          >
            <BusMark size={36} />
            <View style={s.brandLine} />
          </Animated.View>

          {/* ── Heading block ── */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(140).springify().damping(18)}
            style={s.headingBlock}
          >
            <Text style={s.heading}>Sign in</Text>
            <Text style={s.subheading}>Enter your college phone number</Text>
          </Animated.View>

          {/* ── Input ── */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(220).springify().damping(18)}
          >
            <Animated.View style={[s.inputRow, inputStyle]}>
              <Text style={s.prefix}>+91</Text>
              <View style={s.prefixDivider} />
              <TextInput
                style={s.input}
                accessibilityLabel="Phone number"
                accessibilityHint="Enter your 10-digit mobile number"
                textContentType="telephoneNumber"
                placeholder="98765 43210"
                placeholderTextColor={C.ghost}
                keyboardType="phone-pad"
                maxLength={12}
                value={phone}
                onChangeText={text => { setPhone(text); setError(null); }}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                autoFocus
              />
            </Animated.View>
          </Animated.View>

          {/* ── Error ── */}
          {error && (
            <Animated.View style={[s.errorWrap, shakeStyle]}>
              <Text style={s.errorText}>{error}</Text>
            </Animated.View>
          )}

          {/* ── Button ── */}
          <Animated.View
            entering={reduceMotion ? undefined : FadeInDown.duration(500).delay(300).springify().damping(18)}
            style={{ marginTop: 12 }}
          >
            <Animated.View style={btnStyle}>
              <TouchableOpacity
                style={[s.btn, (!isValid || loading) && s.btnDisabled]}
                accessibilityLabel={loading ? 'Sending code' : 'Continue'}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isValid || loading, busy: loading }}
                onPress={handleSendOTP}
                disabled={!isValid || loading}
                activeOpacity={0.88}
              >
                {loading
                  ? <ActivityIndicator color={C.btnText} />
                  : <Text style={s.btnText}>Continue</Text>
                }
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>

          {/* ── Footer ── */}
          <Animated.Text
            entering={reduceMotion ? undefined : FadeIn.duration(400).delay(400)}
            style={s.footer}
          >
            By continuing you agree to our{' '}
            <Text style={s.footerLink}>Terms of Service</Text>
          </Animated.Text>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  inner: {
    flex: 1,
  },
  layout: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 0,
  },

  // Brand mark — horizontal rule separates identity from form
  brandArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 36,
  },
  brandLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },

  // Heading
  headingBlock: {
    marginBottom: 24,
    gap: 6,
  },
  heading: {
    fontFamily: typography.family,
    fontSize: 30,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.6,
  },
  subheading: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.muted,
  },

  // Phone input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.inputBg,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    height: 56,
    overflow: 'hidden',
  },
  prefix: {
    fontFamily: typography.family,
    fontSize: 17,
    fontWeight: '500',
    color: '#3A3A3D',
    paddingHorizontal: 18,
  },
  prefixDivider: {
    width: 1,
    height: 26,
    backgroundColor: C.border,
  },
  input: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 17,
    fontWeight: '500',
    color: C.ink,
    paddingHorizontal: 16,
    height: '100%',
  },

  // Error
  errorWrap: {
    backgroundColor: C.errorBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
  },
  errorText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.errorText,
    textAlign: 'center',
  },

  // Button
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.3,
  },
  btnText: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },

  // Footer
  footer: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.muted,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
  footerLink: {
    color: C.link,
    fontWeight: '500',
  },
});
