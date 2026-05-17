// brand.ts — Mobile design tokens v2
//
// This is the single source of truth for visual tokens in the redesigned mobile app.
// It coexists with the legacy `theme.ts` until every screen migrates over.
// See DESIGN.md at the repo root for the full system.

export const brand = {
  blue: {
    50: '#BFE6FF',
    100: '#A8DDFF',
    200: '#85C7F2',
    300: '#76BFEF',
    400: '#67C0F9',
    500: '#5CB5EF',
    600: '#4D95C3',
    700: '#356C8F',
    800: '#225373',
    900: '#103E5B',
  },
  deep: {
    500: '#327DAD',
    600: '#3E7AA1',
    700: '#115E8F',
    800: '#1B435C',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#F8F8F8',
    100: '#F3EFE6',
    200: '#EFEFE7',
    300: '#E9E9E9',
    400: '#D9D9D9',
    500: '#C9C9C9',
    600: '#ADADAD',
  },
  ink: {
    900: '#101010',
    800: '#2A2218',
    700: '#424242',
    600: '#4E4E4E',
    500: '#565656',
    400: '#5D5D5D',
  },
  success: {
    fg: '#5A9268',
    bg: '#B1D1B7',
  },
  accent: {
    warm: '#FF9274',
    warmSoft: '#FFB5A2',
    warmTint: '#F1CBC1',
  },
} as const;

// Gradient definitions. RN StyleSheet can't render multi-stop gradients; consumers
// use these with `react-native-svg`'s <LinearGradient> or with `expo-linear-gradient`.
export const gradients = {
  // Diagonal dark gloss for the attendance card. 216deg sweep — top-right to bottom-left.
  // Matches Group 145's paint0_linear_202_600.
  darkGloss: {
    angle: 216,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 0.464, color: '#404040' },
      { offset: 0.508, color: '#535353' },
      { offset: 0.553, color: '#666666' },
      { offset: 0.577, color: '#4D4D4D' },
      { offset: 0.977, color: '#000000' },
    ],
  },
  // Wordmark gradient for "SCHOOLDAYS" / "SEC25IT291" — soft pastel sweep.
  softPastel: {
    angle: 110,
    stops: [
      { offset: 0, color: '#FFFFFF' },
      { offset: 0.36, color: '#90A9E9' },
      { offset: 0.64, color: '#E0AEF9' },
      { offset: 1, color: '#999999' },
    ],
  },
  // Subtle vertical canvas gradient sitting under the starburst.
  appCanvas: {
    angle: 180,
    stops: [
      { offset: 0, color: '#5CB5EF' },
      { offset: 0.5, color: '#4D95C3' },
      { offset: 1, color: '#356C8F' },
    ],
  },
} as const;

export const space = {
  micro: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 38,
  pill: 999,
} as const;

export const elevation = {
  card: {
    shadowColor: '#101010',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardHover: {
    shadowColor: '#101010',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 8,
  },
  tabBar: {
    shadowColor: '#101010',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 12,
  },
  button: {
    shadowColor: '#356C8F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
} as const;

// Pill presets — semantic colors only. Don't add a "primary brand pill" preset; the
// design uses bare blue text for that pattern, not a pill.
export const pill = {
  onTime: {
    bg: brand.neutral[0],
    border: brand.success.bg,
    text: brand.success.fg,
    dot: brand.success.fg,
  },
  scheduled: {
    bg: brand.neutral[0],
    border: brand.accent.warmSoft,
    text: brand.accent.warm,
    dot: brand.accent.warm,
  },
  gpsWeak: {
    bg: brand.neutral[0],
    border: brand.accent.warmSoft,
    text: brand.accent.warm,
    dot: brand.accent.warm,
  },
  completed: {
    bg: brand.neutral[0],
    border: brand.neutral[400],
    text: brand.ink[500],
    dot: brand.neutral[600],
  },
  noTrip: {
    bg: brand.neutral[50],
    border: brand.neutral[400],
    text: brand.ink[500],
    dot: brand.neutral[600],
  },
} as const;

export type BrandColor = typeof brand;
export type GradientSpec = typeof gradients[keyof typeof gradients];
