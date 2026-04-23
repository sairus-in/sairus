// app/(student)/scanner.tsx — QR Scanner (full screen, no tab bar)
// HARDENED v3:
//   - GPS accuracy threshold guard before scan fires (> 150m = low-trust warn)
//   - isOptimistic lock check prevents double-scan while server is in-flight
//   - Camera permission: guides to Settings after permanent denial
//   - try/catch on mutateAsync prevents screen hanging on throw
//   - All colors from theme tokens (no hardcoded hex)
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCheckin } from '../../hooks/useCheckin';
import { useStudentHome } from '../../hooks/useStudentHome';
import { useAuth } from '../../store/auth.store';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';
import * as Haptics from 'expo-haptics';
import { analytics } from '../../lib/analytics';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

// GPS accuracy threshold — above this we submit as low-trust
const LOW_TRUST_ACCURACY_THRESHOLD_M = 150;

export default function ScannerScreen() {
  return (
    <ScreenErrorBoundary screenName="Scanner">
      <ScannerContent />
    </ScreenErrorBoundary>
  );
}

function ScannerContent() {
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _params = useLocalSearchParams<{ isUnassigned?: string }>();
  const user = useAuth((s) => s.user);
  const checkin = useCheckin();

  // Read current optimistic state — if already optimistically checked in, block scan
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

  // Pre-fetch location on mount
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
    // Guard 1: already processing a scan (debounce)
    if (scanned) return;

    // Guard 2: student already checked in optimistically — prevent double-scan flicker
    if (isAlreadyOptimistic) {
      setScanned(false);
      router.replace('/(student)/');
      return;
    }

    setScanned(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Get location (use pre-fetched or fetch now)
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
      // Unexpected throw from mutateAsync — reset scan lock so user can retry
      analytics.error(err as Error, { context: 'scanner_qr_unexpected' });
      setScanned(false);
    }
  };

  // --- Permission states ---
  if (!permission) {
    // Camera permission loading
    return <ActivityIndicator style={{ flex: 1 }} color={colors.brand.primary} />;
  }

  if (!permission.granted) {
    // canAskAgain: expo-camera type may not expose it officially but it exists at runtime
    const canAsk = (permission as any).canAskAgain !== false;
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionWrap}>
          <Text style={styles.permissionIcon}>📷</Text>
          <Text style={styles.permissionTitle}>{t('scanner.cameraNeeded')}</Text>
          <Text style={styles.permissionBody}>
            {canAsk
              ? 'We need camera access to scan the QR code on the bus.'
              : 'Camera access was denied. Open Settings to enable it.'}
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={canAsk ? requestPermission : () => Linking.openSettings()}
          >
            <Text style={styles.primaryButtonText}>
              {canAsk ? t('scanner.allowCamera') : 'Open Settings'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
            <Text style={styles.cancelText}>{t('scanner.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      {/* Camera */}
      <View style={styles.cameraWrap}>
        <CameraView
          style={styles.camera}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        {/* Scan frame overlay */}
        <View style={styles.overlay}>
          <View style={[
            styles.scanFrame,
            isLowAccuracy && { borderColor: colors.warning.text },
          ]} />
        </View>

        {scanned && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator color={colors.white} size="large" />
            <Text style={styles.processingText}>{t('scanner.processing')}</Text>
          </View>
        )}
      </View>

      {/* Instructions */}
      <View style={styles.bottom}>
        <Text style={styles.instruction}>
          {isAlreadyOptimistic
            ? 'Your check-in is already being recorded…'
            : t('scanner.pointAt')}
        </Text>

        {/* GPS status rows */}
        {!locationReady && (
          <Text style={styles.locationHint}>{t('scanner.fetchingLocation')}</Text>
        )}
        {locationReady && isLowAccuracy && (
          <View style={styles.accuracyWarn}>
            <Text style={styles.accuracyWarnText}>
              GPS accuracy is low — check-in will be flagged for review
            </Text>
          </View>
        )}

        {/* Stop info card */}
        {user?.routeAssignment && (
          <View style={styles.stopCard}>
            <Text style={styles.stopText}>
              {t('scanner.yourStop', {
                stop: user.routeAssignment.stop.name,
                bus: 'your bus',
              })}
            </Text>
          </View>
        )}

        <TouchableOpacity onPress={() => router.back()} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>{t('scanner.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.black },
  backBtn: {
    position: 'absolute', top: 50, left: spacing.xl, zIndex: 10,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center', alignItems: 'center',
  },
  backText: { fontSize: 18, color: colors.text.primary },
  cameraWrap: { flex: 0.6, overflow: 'hidden', position: 'relative' },
  camera: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  scanFrame: {
    width: 220, height: 220,
    borderWidth: 3, borderColor: colors.success.text,
    borderRadius: 16,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  processingText: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.white, marginTop: spacing.sm,
  },
  bottom: {
    flex: 0.4, paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
    alignItems: 'center', backgroundColor: colors.surface,
  },
  instruction: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.text.secondary, textAlign: 'center',
  },
  locationHint: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.warning.text, marginTop: spacing.xs,
  },
  accuracyWarn: {
    backgroundColor: colors.warning.bg,
    borderRadius: radii.sm,
    padding: spacing.xs,
    marginTop: spacing.xs,
    width: '100%',
  },
  accuracyWarnText: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.warning.text, textAlign: 'center',
  },
  stopCard: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.sm, padding: spacing.md, marginTop: spacing.lg, width: '100%',
  },
  stopText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    color: colors.text.secondary, textAlign: 'center',
  },
  cancelBtn: { marginTop: spacing.lg },
  cancelText: {
    fontFamily: typography.family, fontSize: typography.sizes.small,
    fontWeight: typography.weights.medium, color: colors.text.muted,
  },
  // --- Permission screen ---
  permissionWrap: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl,
  },
  permissionIcon: { fontSize: 48, marginBottom: spacing.md },
  permissionTitle: {
    fontFamily: typography.family, fontSize: typography.sizes.h2,
    fontWeight: typography.weights.semibold, color: colors.text.primary,
    marginBottom: spacing.sm, textAlign: 'center',
  },
  permissionBody: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.secondary, textAlign: 'center',
    marginBottom: spacing.lg, lineHeight: 22,
  },
  primaryButton: {
    backgroundColor: colors.button.primary.bg, paddingVertical: 15,
    paddingHorizontal: spacing.xl, borderRadius: radii.button,
  },
  primaryButtonText: {
    fontFamily: typography.family, fontSize: 15,
    fontWeight: typography.weights.semibold, color: colors.button.primary.text,
  },
});
