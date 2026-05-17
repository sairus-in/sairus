import React, { useCallback, useMemo, useRef } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { PROVIDER_DEFAULT } from 'react-native-maps';

import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';
import { AtmosphericBackground } from '../../components/v2/AtmosphericBackground';
import { HomeHeader } from '../../components/student/v2/HomeHeader';
import { TripCard } from '../../components/student/v2/TripCard';
import { WaitNotifyPill } from '../../components/student/v2/WaitNotifyPill';
import { AttendanceGlossCard } from '../../components/student/v2/AttendanceGlossCard';
import { HomeTabBar } from '../../components/student/v2/HomeTabBar';
import { brand, space } from '../../constants/brand';
import { useStudentHome } from '../../hooks/useStudentHome';
import { useStudentSocket } from '../../hooks/useStudentSocket';
import { useStudentAuth } from '../../hooks/useOptimizedAuth';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH - space.md * 2;

function getGreeting(date: Date): string {
  const h = date.getHours();
  if (h < 12) return 'Hello';
  if (h < 17) return 'Hello';
  return 'Hello';
}

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function getInitial(name: string | null | undefined): string {
  if (!name) return 'S';
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : 'S';
}

function StudentHomeScreen() {
  const router = useRouter();
  const auth = useStudentAuth();
  const home = useStudentHome();
  const warmMapRef = useRef<MapView>(null);

  const screenState = home.data?.screenState ?? { status: 'no_trip' as const };
  const trip = home.trip;
  const history = home.transport?.history ?? null;
  const studentName = auth.user?.name ?? home.student?.name ?? '—';
  const sectionCode = home.student?.rollNumber ?? home.student?.department ?? 'STUDENT';
  const stopName = home.student?.stopName ?? null;
  const routeId = home.student?.routeId ?? undefined;

  // Derive socket subscription targets from current trip state.
  const tripId =
    screenState.status === 'trip_active' ||
    screenState.status === 'checked_in' ||
    screenState.status === 'trip_upcoming'
      ? screenState.tripId
      : undefined;
  const busId =
    screenState.status === 'trip_active' || screenState.status === 'checked_in'
      ? screenState.busId
      : undefined;

  useStudentSocket({ tripId, busId, routeId });

  const handleScanPress = useCallback(() => {
    router.push('/(student)/scanner');
  }, [router]);

  const handleNotifyPress = useCallback(() => {
    router.push('/(student)/self-report-prompt');
  }, [router]);

  const canCheckIn =
    screenState.status === 'trip_active' ? screenState.canCheckIn : false;

  const greeting = useMemo(() => getGreeting(new Date()), []);
  const today = useMemo(() => formatDate(new Date()), []);
  const initial = getInitial(studentName);

  const alerts = home.alerts;
  const unread =
    alerts && typeof alerts === 'object' && 'yesterdayAbsent' in alerts
      ? Number(alerts.yesterdayAbsent) + Number(alerts.substituteAssigned)
      : 0;

  return (
    <View style={styles.root}>
      <AtmosphericBackground />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={home.isRefetching}
              onRefresh={home.refetch}
              tintColor={brand.neutral[0]}
            />
          }
        >
          <HomeHeader
            greeting={greeting}
            name={studentName.split(' ')[0] ?? studentName}
            date={today}
            initial={initial}
            unreadCount={unread}
          />

          <TripCard
            trip={trip}
            screenState={screenState}
            stopName={stopName}
            canCheckIn={canCheckIn}
            onScanPress={handleScanPress}
          />

          <View style={styles.notifyWrap}>
            <WaitNotifyPill onPress={handleNotifyPress} />
          </View>

          <View style={styles.glossWrap}>
            <AttendanceGlossCard
              name={studentName.toLowerCase()}
              sectionCode={sectionCode ?? 'STUDENT'}
              attendancePercent={history?.percentage ?? null}
              leaveRemaining={null}
              odLeft={null}
              width={CARD_WIDTH}
            />
          </View>
        </ScrollView>
      </SafeAreaView>

      <HomeTabBar active="home" />

      {/* Pre-warmed hidden MapView for faster map load */}
      {(screenState.status === 'trip_active' || screenState.status === 'trip_upcoming') && (
        <View style={styles.warmMapContainer} pointerEvents="none">
          <MapView
            ref={warmMapRef}
            provider={PROVIDER_DEFAULT}
            style={styles.warmMap}
            initialRegion={{
              latitude: 12.9716,
              longitude: 77.5946,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          />
        </View>
      )}
    </View>
  );
}

export default function StudentHomeRoute() {
  return (
    <ScreenErrorBoundary screenName="StudentHome">
      <StudentHomeScreen />
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: brand.blue[600],
  },
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  notifyWrap: {
    marginTop: space.md,
  },
  warmMapContainer: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  warmMap: {
    width: 1,
    height: 1,
  },
  glossWrap: {
    marginTop: space.md,
  },
});
