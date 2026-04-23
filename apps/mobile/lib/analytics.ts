// lib/analytics.ts
// HARDENED v3: Strictly typed tracking to prevent silent logging failures.
// CI enforces that every useMutation has an adjacent analytics.track call.

interface AnalyticsEvent {
  // Check-in funnel
  'checkin_attempt':              { gpsState: string };
  'checkin_success':              { status: 'PRESENT' | 'LATE_BOARD'; gpsState: string };
  'checkin_failure':              { error: string; gpsState: string };
  'checkin_low_trust':            { gpsState: string; accuracy: number | null }; // NEW v3
  'checkin_queued_offline':       {};
  'checkin_queue_synced':         {};
  'checkin_queue_expired':        { age: number };
  'checkin_queue_trip_expired':   {};
  'checkin_queue_max_retries':    { code: string };
  'queue_duplicate_prevented':    {};
  'queue_parallel_flush_start':   { count: number }; // NEW v3
  'queue_item_unexpected_error':  {}; // NEW v3

  // Scanner
  'scanner_opened':               {};
  'scanner_gps_timeout':          {};
  'scanner_camera_permission_denied': {};

  // Network
  'network_offline_detected':     {};
  'network_online_restored':      {};

  // Queue integrity
  'queue_corruption_detected':    {};
  'queue_read_failure':           {};
  'queue_found_on_startup':       { count: number };

  // Kiosk
  'kiosk_socket_dead_polling_started': {};
  'kiosk_qr_refresh_missed':      {};

  // Auth + cold start
  'warm_cache_started':           {}; // NEW v3
  'cold_start_cache_miss':        {}; // NEW v3

  // Error boundaries
  'home_screen_crash':            { error: string };
  'error_boundary_state_cleared': { screen: string }; // NEW v3

  'gps_offline_shown_to_student': {};

  // Delegation
  'delegation_check_success':     { tripId: string };
  'delegation_activated':         { type: string };
  'delegation_ended':             { tripId: string };

  // Corrections & Self Reports
  'correction_request_submitted': {};
  'self_report_submitted':        { tripId: string; wasOnBus: boolean };
  'self_report_failed':           { tripId: string; reason: string };
  'self_report_queued_offline':   { tripId: string; wasOnBus: boolean };
  'self_report_failed_expired':   { tripId: string };

  // Driver actions
  'driver_end_trip_initiated':    { tripId: string };
  'driver_end_trip_success':      { tripId: string };
  'breakdown_reported':           { tripId: string; incidentType: string };

  // Profile
  'user_logout':                  { role: string };
}

export const analytics = {
  track: <T extends keyof AnalyticsEvent>(
    event: T,
    properties?: AnalyticsEvent[T]
  ) => {
    if (__DEV__) {
      console.log('[ANALYTICS]', event, properties || {});
      return;
    }
    // Production: your analytics provider here (e.g. PostHog, Amplitude, Firebase)
    // posthog.capture(event, properties)
  },

  error: (error: Error, context?: Record<string, string>) => {
    if (__DEV__) {
      console.error('[ERROR]', error.message, context || {});
      return;
    }
    // Production: Sentry or Crashlytics
    // Sentry.captureException(error, { extra: context })
  },
};
