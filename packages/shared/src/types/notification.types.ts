export const NOTIFICATION_TYPE = {
  BUS_STARTING_SOON: 'BUS_STARTING_SOON',
  BUS_APPROACHING_STOP: 'BUS_APPROACHING_STOP',
  ROUTE_CHANGED: 'ROUTE_CHANGED',
  BREAKDOWN_ALERT: 'BREAKDOWN_ALERT',
  BREAKDOWN_RESOLVED: 'BREAKDOWN_RESOLVED',
  ATTENDANCE_MARKED: 'ATTENDANCE_MARKED',
  CORRECTION_UPDATED: 'CORRECTION_UPDATED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  NO_DRIVER_ALERT: 'NO_DRIVER_ALERT',
  NEW_MESSAGE: 'NEW_MESSAGE',
  TRIP_SUMMARY: 'TRIP_SUMMARY',         // Coordinator receives at trip end
  ARRIVAL_VERIFICATION: 'ARRIVAL_VERIFICATION', // Student arrival gate check
  GPS_OFFLINE_DELEGATE_REQUEST: 'GPS_OFFLINE_DELEGATE_REQUEST',
  GPS_OFFLINE: 'GPS_OFFLINE',
  GPS_OUTAGE_ESCALATION: 'GPS_OUTAGE_ESCALATION',
  SELF_REPORT_PROMPT: 'SELF_REPORT_PROMPT',
  DELEGATE_WARNING: 'DELEGATE_WARNING',
  UNKNOWN: 'UNKNOWN',
  LATE_START: 'LATE_START',
} as const;

export type NotificationType = typeof NOTIFICATION_TYPE[keyof typeof NOTIFICATION_TYPE];

export const NOTIFICATION_CHANNEL = {
  PUSH: 'PUSH',
  SMS: 'SMS',
  IN_APP: 'IN_APP',
} as const;

export type NotificationChannel = typeof NOTIFICATION_CHANNEL[keyof typeof NOTIFICATION_CHANNEL];

export const PUSH_TOKEN_PROVIDER = {
  EXPO: 'EXPO',
  FCM: 'FCM',
} as const;

export type PushTokenProvider = typeof PUSH_TOKEN_PROVIDER[keyof typeof PUSH_TOKEN_PROVIDER];

export interface PushTokenRegistration {
  pushToken: string;
  pushTokenProvider: PushTokenProvider;
}

export interface NotificationPayload {
  title: string;
  body: string;
  type: NotificationType;
  metadata?: Record<string, unknown>; // allows numbers, booleans etc
}

export interface DirectMessage {
  id: string;
  senderId: string;
  receiverId: string;
  body: string;
  isRead: boolean;
  priority: 'NORMAL' | 'URGENT';
  threadContext?: string; // e.g., tripId or incidentId
  createdAt: string;
}
