// Design system — single source of truth for all visual tokens
// From the claude-opus-prompt.md design specification

export const colors = {
  // Brand
  brand: {
    primary: '#356C8F',
    light: '#BFE6FF',
    mid: '#4D95C3',
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
    brand: { bg: '#356C8F', text: '#FFFFFF' },
    destructive: { bg: '#DC2626', text: '#FFFFFF' },
    outline: { bg: 'transparent', border: '#E2E8F0', text: '#374151' },
    ghost: { text: '#356C8F' },
  },

  // Surface
  surface: '#FAFAF8',
  card: { bg: '#FFFFFF', border: '#E9E9E9' },

  // Text
  text: {
    primary: '#111827',
    secondary: '#6B7280',
    muted: '#9CA3AF',
  },

  // Tab bar
  tab: {
    active: '#356C8F',
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
    accent: '#5CB5EF',
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

// Student app extended palette (sourced from home-screen brand.ts blue family)
export const student = {
  // Backgrounds
  bg: '#BFE6FF', // Light blue canvas (was warm cream)
  cardBg: '#FFFFFF',
  sheetSecondaryBg: '#BFE6FF',

  // Text
  textInk: '#1A1A1C',
  textMuted: '#565656',
  textGhost: '#C9C9C9',

  // Brand accents
  primary: '#356C8F', // Brand blue (was dark warm brown)
  primaryText: '#FFFFFF',

  // Status colors
  successBg: '#E8F5E9',
  successText: '#2E7D32',
  warningBg: '#FFF3E0',
  warningText: '#E65100',
  errorBg: '#FCE4EC',
  errorText: '#C62828',

  // Borders
  border: '#E9E9E9',

  // Icon backgrounds
  iconWrapBg: '#BFE6FF',
  iconWrapBgAlt: '#BFE6FF',
  iconMuted: '#356C8F',
  iconAlert: '#D84315',

  // Avatar
  avatarBg: '#FFFFFF',

  // Map specific
  mapBg: '#F3EFE6',
  busMarkerBg: '#356C8F',
} as const;

export const login = {
  bg: student.bg,
  iconBg: student.textInk,
  iconFg: student.primaryText,
  heading: student.textInk,
  subtitle: student.textMuted,
  inputBg: student.cardBg,
  inputBorder: student.border,
  inputBorderFocus: '#356C8F',
  inputText: student.textInk,
  inputPlaceholder: student.textGhost,
  prefixText: '#3A3A3D',
  prefixDivider: student.border,
  buttonBg: student.primary,
  buttonText: student.primaryText,
  buttonDisabledBg: student.primary,
  footerText: student.textMuted,
  footerLink: student.textInk,
  errorText: '#A6423A',
  errorBg: '#F4E1DF',
} as const;

// Animation timing tokens (based on ui-ux-pro-max guidelines)
export const motion = {
  // Micro-interactions (150-300ms)
  duration: {
    fastest: 150,
    fast: 200,
    normal: 300,
    slow: 400,
  },
  // Easing curves
  easing: {
    enter: 'ease-out',
    exit: 'ease-in',
    spring: 'spring',
  },
} as const;

// Touch target standards (44pt minimum per ui-ux-pro-max)
export const touch = {
  minSize: 44,
  feedbackOpacity: 0.7, // Standard activeOpacity
  feedbackScale: 0.95,
} as const;

// Spacing extended scale (supplements base spacing)
export const spacingExtended = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  screen: 20, // Standard screen horizontal padding
  card: 16, // Standard card padding
  section: 24, // Section spacing
} as const;
