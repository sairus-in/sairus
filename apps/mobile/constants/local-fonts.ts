// Local font asset map. Fonts that ship from `apps/mobile/assets/fonts/` (not from
// @expo-google-fonts) are wired here.
//
// To enable Morne + Bahnschrift:
//   1. Drop the TTF files into apps/mobile/assets/fonts/ matching the README there.
//   2. Uncomment the require() entries below.
//   3. Restart the Metro bundler.
//
// While the entries are commented out, the app falls back to system fonts wherever
// Morne / Bahnschrift would be used. Visual identity is degraded but the app boots.

export const localFontAssets: Record<string, number> = {
  // Morne: require('../assets/fonts/Morne.ttf'),
  // Bahnschrift: require('../assets/fonts/Bahnschrift.ttf'),
  // 'Bahnschrift-SemiBold': require('../assets/fonts/Bahnschrift-SemiBold.ttf'),
};
