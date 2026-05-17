// typography.ts — Mobile type system v2
//
// Font families are loaded in app/_layout.tsx via expo-font + @expo-google-fonts.
// Morne and Bahnschrift are user-supplied OTF/TTF files in assets/fonts/.
// See DESIGN.md "Typography" section and assets/fonts/README.md for setup.

import type { TextStyle } from 'react-native';

// Font family names. These exact strings are what gets registered in expo-font
// and what `fontFamily` references in TextStyle objects.
export const fontFamily = {
  // Inter — default for everything
  inter: 'Inter_500Medium',
  interRegular: 'Inter_400Regular',
  interMedium: 'Inter_500Medium',
  interSemibold: 'Inter_600SemiBold',
  interBold: 'Inter_700Bold',
  interExtrabold: 'Inter_800ExtraBold',

  // Morne — display only, for the ETA hero block
  morne: 'Morne',

  // Bahnschrift — big numeric stats
  bahnschrift: 'Bahnschrift',
  bahnschriftSemibold: 'Bahnschrift-SemiBold',

  // Ubuntu Mono — codes
  ubuntuMono: 'UbuntuMono_400Regular',
  ubuntuMonoBold: 'UbuntuMono_700Bold',
} as const;

// Type ramp — paired family + size + weight + line-height presets.
// Each preset is a complete TextStyle so consumers don't reassemble the pieces.
export const type = {
  display: {
    xl: {
      fontFamily: fontFamily.interExtrabold,
      fontSize: 44,
      lineHeight: 48,
      letterSpacing: -1,
    } satisfies TextStyle,
    lg: {
      fontFamily: fontFamily.interBold,
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.5,
    } satisfies TextStyle,
  },
  eta: {
    hero: {
      fontFamily: fontFamily.morne,
      fontSize: 72,
      lineHeight: 76,
      letterSpacing: -2,
    } satisfies TextStyle,
    unit: {
      fontFamily: fontFamily.morne,
      fontSize: 24,
      lineHeight: 28,
      letterSpacing: -0.5,
    } satisfies TextStyle,
    label: {
      fontFamily: fontFamily.morne,
      fontSize: 14,
      lineHeight: 18,
    } satisfies TextStyle,
  },
  stat: {
    value: {
      fontFamily: fontFamily.bahnschriftSemibold,
      fontSize: 32,
      lineHeight: 36,
      letterSpacing: -0.5,
    } satisfies TextStyle,
  },
  code: {
    md: {
      fontFamily: fontFamily.ubuntuMonoBold,
      fontSize: 13,
      lineHeight: 16,
      letterSpacing: 0.4,
    } satisfies TextStyle,
    sm: {
      fontFamily: fontFamily.ubuntuMono,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.4,
    } satisfies TextStyle,
  },
  body: {
    lg: {
      fontFamily: fontFamily.interMedium,
      fontSize: 18,
      lineHeight: 24,
    } satisfies TextStyle,
    md: {
      fontFamily: fontFamily.interMedium,
      fontSize: 14,
      lineHeight: 20,
    } satisfies TextStyle,
    sm: {
      fontFamily: fontFamily.interMedium,
      fontSize: 13,
      lineHeight: 18,
    } satisfies TextStyle,
    xs: {
      fontFamily: fontFamily.interSemibold,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.3,
    } satisfies TextStyle,
  },
} as const;

// Local fonts (Morne, Bahnschrift) live in a separate file that the user fills in
// once they drop the TTF files. The bundler only resolves `local-fonts.ts` lazily,
// so until that file ships the real require()s the app still boots with system fallback.
//
// See: apps/mobile/constants/local-fonts.ts and apps/mobile/assets/fonts/README.md
