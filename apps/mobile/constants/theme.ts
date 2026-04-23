// Design system — single source of truth for all visual tokens
// From the claude-opus-prompt.md design specification

export const colors = {
  // Brand
  brand: {
    primary: '#1E3A8A',
    light: '#EEF2FF',
    mid: '#4F46E5',
  },

  // Semantic status
  success: { text: '#16A34A', bg: '#DCFCE7', border: '#BBF7D0' },
  warning: { text: '#D97706', bg: '#FEF9C3', border: '#FDE68A' },
  error: { text: '#DC2626', bg: '#FEE2E2', border: '#FECACA' },
  info: { text: '#2563EB', bg: '#DBEAFE', border: '#BFDBFE' },
  neutral: { text: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB' },

  // Buttons
  button: {
    primary: { bg: '#1a1a1a', text: '#FFFFFF' },
    brand: { bg: '#1E3A8A', text: '#FFFFFF' },
    destructive: { bg: '#DC2626', text: '#FFFFFF' },
    outline: { bg: 'transparent', border: '#E2E8F0', text: '#374151' },
    ghost: { text: '#1E3A8A' },
  },

  // Surface
  surface: '#FAFAF8',
  card: { bg: '#FFFFFF', border: '#F0EDE6' },

  // Text
  text: {
    primary: '#111827',
    secondary: '#6B7280',
    muted: '#9CA3AF',
  },

  // Tab bar
  tab: {
    active: '#1E3A8A',
    inactive: '#9CA3AF',
    bg: '#FFFFFF',
    border: '#F3F4F6',
  },

  // Kiosk (dark theme)
  kiosk: {
    bg: '#111111',
    card: '#1E1E1E',
    border: '#2A2A2A',
    textPrimary: '#FFFFFF',
    textSecondary: '#888888',
    textMuted: '#555555',
    accent: '#6366F1',
  },

  // Base — use these instead of hardcoding '#FFFFFF' / '#000000'
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const typography = {
  family: 'PlusJakartaSans',
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
  sizes: {
    display: 28,
    h1: 22,
    h2: 18,
    h3: 16,
    body: 14,
    small: 13,
    caption: 12,
    micro: 11,
    label: 10,
  },
} as const;

export const spacing = {
  micro: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
} as const;

export const radii = {
  none: 0,
  lg: 20,
  md: 16,
  sm: 12,
  button: 14,
  pill: 999,
  input: 12,
  sheet: 20,
  toast: 12,
} as const;

// Status pill presets
export const statusPill = {
  PRESENT: { bg: colors.success.bg, text: colors.success.text },
  ABSENT: { bg: colors.error.bg, text: colors.error.text },
  LATE_BOARD: { bg: colors.warning.bg, text: colors.warning.text },
  EXCUSED: { bg: colors.info.bg, text: colors.info.text },
  OFFLINE: { bg: colors.warning.bg, text: colors.warning.text },
  NOT_STARTED: { bg: colors.neutral.bg, text: colors.neutral.text },
} as const;
