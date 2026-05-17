import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Dimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeInDown } from 'react-native-reanimated';
import Svg, { Path, Defs, Mask, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';

import { useCheckin } from '../../hooks/useCheckin';
import { useStudentHome } from '../../hooks/useStudentHome';
import { useAuth } from '../../store/auth.store';
import { typography, spacingExtended } from '../../constants/theme';
import { t } from '../../i18n';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

const { width, height } = Dimensions.get('window');

// ── Design Tokens ──
const ds = {
  bg: '#1A1A1C',
  cardBg: '#FFFFFF',
  textInk: '#1A1A1C',
  textMuted: '#565656',
  dangerBg: '#FCE4EC',
  dangerText: '#C62828',
  warningBg: '#FFF3E0',
  warningText: '#E65100',
  primary: '#356C8F',
};

const LOW_TRUST_ACCURACY_THRESHOLD_M = 150;

const BackIcon = ({ color = '#FFFFFF' }) => (
  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
    <Path d="M19 12H5M5 12l7-7M5 12l7 7" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const LocationWarnIcon = ({ color = ds.warningText }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 9v4M12 17h.01" stroke={color} strokeWidth={2} strokeLinecap="round" />
  </Svg>
);

// Draws the translucent dark overlay with a transparent hole in the middle
const CameraOverlay = () => {
  const holeSize = 260;
  const cx = width / 2;
  const cy = height * 0.4;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Mask id="mask">
            <Rect width="100%" height="100%" fill="white" />
            <Rect x={cx - holeSize/2} y={cy - holeSize/2} width={holeSize} height={holeSize} rx="32" fill="black" />
          </Mask>
        </Defs>
        <Rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#mask)" />
        {/* Reticle Brackets */}
        <Path d={`M ${cx - holeSize/2} ${cy - holeSize/2 + 30} v -10 a 20 20 0 0 1 20 -20 h 10`} stroke="#FFFFFF" strokeWidth={4} fill="none" />
        <Path d={`M ${cx + holeSize/2} ${cy - holeSize/2 + 30} v -10 a 20 20 0 0 0 -20 -20 h -10`} stroke="#FFFFFF" strokeWidth={4} fill="none" />
        <Path d={`M ${cx - holeSize/2} ${cy + holeSize/2 - 30} v 10 a 20 20 0 0 0 20 20 h 10`} stroke="#FFFFFF" strokeWidth={4} fill="none" />
        <Path d={`M ${cx + holeSize/2} ${cy + holeSize/2 - 30} v 10 a 20 20 0 0 1 -20 20 h -10`} stroke="#FFFFFF" strokeWidth={4} fill="none" />
      </Svg>
    </View>
  );
};


export default function ScannerScreen() {
  return (
    <ScreenErrorBoundary screenName="Scanner">
      <ScannerContent />
    </ScreenErrorBoundary>
  );
}

function ScannerContent() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const _params = useLocalSearchParams<{ isUnassigned?: string }>();
  const user = useAuth((s) => s.user);
  const checkin = useCheckin();

  const homeQuery = useStudentHome();
  const isAlreadyOptimistic: boolean =
    homeQuery.data?.transport?.attendance?.isOptimistic === true ||
    homeQuery.data?.transport?.attendance?.today === 'PRESENT' ||
    homeQuery.data?.transport?.attendance?.today === 'LATE_BOARD';

  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [isLowAccuracy, setIsLowAccuracy] = useState(false);
  const locationRef = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          locationRef.current = loc;
          const accuracy = loc.coords.accuracy ?? 999;
          setIsLowAccuracy(accuracy > LOW_TRUST_ACCURACY_THRESHOLD_M);
          setLocationReady(true);
        } catch {
          setLocationReady(false);
        }
      }
    })();
  }, []);

  const handleBarCodeScanned = async ({ data: qrToken }: { data: string }) => {
    if (scanned) return;
    if (isAlreadyOptimistic) {
      setScanned(false);
      router.replace('/(student)/');
      return;
    }

    setScanned(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    let location = locationRef.current;
    if (!location) {
      try {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      } catch {
        location = null;
      }
    }

    const accuracy = location?.coords.accuracy ?? 999;
    const isLowTrust = accuracy > LOW_TRUST_ACCURACY_THRESHOLD_M;

    if (isLowTrust) {
      analytics.track('checkin_low_trust', {
        gpsState: 'LOW_ACCURACY',
        accuracy,
      });
    }

    analytics.track('scanner_opened', {});

    try {
      const result = await checkin.mutateAsync({
        qrToken,
        lat: location?.coords.latitude ?? 0,
        lon: location?.coords.longitude ?? 0,
        accuracy,
        clientTimestamp: Date.now(),
        isLowTrust,
        gpsState: isLowTrust ? 'LOW_ACCURACY' : 'GOOD',
      });

      if (result.success && result.offline) {
        router.replace({
          pathname: '/(student)/checkin-success',
          params: { offline: 'true' },
        });
      } else if (result.success) {
        router.replace({
          pathname: '/(student)/checkin-success',
          params: {
            status: result.status ?? 'PRESENT',
            checkedInAt: result.checkedInAt ?? '',
            distanceToStop: String(result.distanceToStop ?? 0),
          },
        });
      } else {
        router.replace({
          pathname: '/(student)/checkin-fail',
          params: { reason: result.reason ?? 'UNKNOWN', ...(result.meta ?? {}) },
        });
      }
    } catch (err) {
      analytics.error(err as Error, { context: 'scanner_qr_unexpected' });
      setScanned(false);
    }
  };

  // --- Permission States ---
  if (!permission) {
    return <View style={s.container} />;
  }

  if (!permission.granted) {
    const canAsk = (permission as any).canAskAgain !== false;
    return (
      <SafeAreaView style={s.permissionContainer}>
        <Animated.View entering={FadeInDown.duration(400)} style={s.permCard}>
          <Text style={s.permIcon}>📷</Text>
          <Text style={s.permTitle}>Camera Access</Text>
          <Text style={s.permBody}>
            {canAsk
              ? 'We need camera access to scan the QR code to log your attendance.'
              : 'Camera access was denied. Please open Settings to enable it.'}
          </Text>
          <TouchableOpacity
            style={s.permBtn}
            onPress={canAsk ? requestPermission : () => Linking.openSettings()}
            activeOpacity={0.8}
          >
            <Text style={s.permBtnText}>
              {canAsk ? 'Allow Access' : 'Open Settings'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 24 }}>
            <Text style={s.permCancel}>Cancel</Text>
          </TouchableOpacity>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container}>

      {/* Full Screen Camera */}
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      <CameraOverlay />

      {/* Top Nav */}
      <SafeAreaView edges={['top']} style={s.topNav}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <BackIcon />
        </TouchableOpacity>
      </SafeAreaView>

      {/* Processing State */}
      {scanned && (
        <View style={s.processingOverlay}>
          <ActivityIndicator color="#FFFFFF" size="large" />
          <Text style={s.processingText}>{t('scanner.processing')}</Text>
        </View>
      )}

      {/* Floating Bottom Card */}
      <Animated.View entering={FadeInUp.duration(500).springify().damping(20)} style={[s.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={s.sheetTitle}>Scan to check in</Text>
        <Text style={s.sheetDesc}>
          {isAlreadyOptimistic
            ? 'Your check-in is already being recorded.'
            : 'Point your camera at the QR code on the driver app.'}
        </Text>

        {(!locationReady || isLowAccuracy) && (
          <View style={s.warnPill}>
            <LocationWarnIcon />
            <Text style={s.warnText}>
              {!locationReady ? 'Fetching location...' : 'Low GPS accuracy. May be flagged for review.'}
            </Text>
          </View>
        )}

        {user?.routeAssignment && (
          <View style={s.stopRow}>
            <Text style={s.stopRowLabel}>BOARDING AT</Text>
            <Text style={s.stopRowValue}>{user.routeAssignment.stop.name}</Text>
          </View>
        )}
      </Animated.View>

    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ds.bg,
  },
  topNav: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    paddingHorizontal: spacingExtended.screen,
    paddingTop: 16,
    zIndex: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  processingText: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
    marginTop: 16,
  },

  bottomSheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: ds.cardBg,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacingExtended.screen,
    paddingTop: 32,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
    elevation: 20,
    zIndex: 10,
  },
  sheetTitle: {
    fontFamily: typography.family,
    fontSize: 20,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
    marginBottom: 8,
  },
  sheetDesc: {
    fontFamily: typography.family,
    fontSize: 14,
    color: ds.textMuted,
    lineHeight: 20,
    marginBottom: 20,
  },
  warnPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ds.warningBg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  warnText: {
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    color: ds.warningText,
    marginLeft: 8,
  },
  stopRow: {
    backgroundColor: '#BFE6FF',
    padding: 16,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stopRowLabel: {
    fontFamily: typography.family,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
    letterSpacing: 1,
  },
  stopRowValue: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
  },

  // Permission screen
  permissionContainer: {
    flex: 1,
    backgroundColor: ds.bg,
    justifyContent: 'center',
    padding: 24,
  },
  permCard: {
    backgroundColor: ds.cardBg,
    borderRadius: 32,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 24,
  },
  permIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  permTitle: {
    fontFamily: typography.family,
    fontSize: 24,
    fontWeight: typography.weights.bold,
    color: ds.textInk,
    marginBottom: 12,
  },
  permBody: {
    fontFamily: typography.family,
    fontSize: 15,
    color: ds.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permBtn: {
    backgroundColor: ds.primary,
    paddingVertical: 16,
    width: '100%',
    borderRadius: 24,
    alignItems: 'center',
  },
  permBtnText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
  },
  permCancel: {
    fontFamily: typography.family,
    fontSize: 14,
    fontWeight: typography.weights.bold,
    color: ds.textMuted,
  },
});
