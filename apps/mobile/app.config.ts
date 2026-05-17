import type { ConfigContext, ExpoConfig } from 'expo/config';

type AppEnv = 'development' | 'preview' | 'production';
const EAS_PROJECT_ID = '9d5b661d-5ef1-4afe-9fe8-a5659a794746';
const EXPO_OWNER = 'sais-organization';

function getEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function getAppEnv(): AppEnv {
  const value = getEnv('APP_ENV');
  if (value === 'preview' || value === 'production') {
    return value;
  }

  return 'development';
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = getAppEnv();
  const expoOwner = getEnv('EXPO_OWNER') ?? EXPO_OWNER;
  const projectId = getEnv('EXPO_PUBLIC_PROJECT_ID') ?? EAS_PROJECT_ID;
  const iosBundleIdentifier = getEnv('EXPO_IOS_BUNDLE_IDENTIFIER') ?? 'com.collegebus.app';
  const androidPackage = getEnv('EXPO_ANDROID_PACKAGE') ?? 'com.collegebus.app';

  return {
    ...config,
    name: 'College Bus',
    slug: 'college-bus',
    version: '1.0.0',
    runtimeVersion: {
      policy: 'appVersion',
    },
    scheme: 'busapp',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#356C8F',
    },
    ios: {
      supportsTablet: false,
      bundleIdentifier: iosBundleIdentifier,
      infoPlist: {
        NSCameraUsageDescription:
          "Camera is used to scan the QR code displayed on the driver's screen for attendance check-in.",
        NSLocationWhenInUseUsageDescription:
          'Location is used to verify you are near the bus stop during check-in.',
        NSLocationAlwaysUsageDescription:
          'Background location is used to track bus position during active trips (drivers only).',
        UIBackgroundModes: ['location', 'remote-notification'],
      },
    },
    android: {
      package: androidPackage,
      adaptiveIcon: {
        backgroundColor: '#356C8F',
        foregroundImage: './assets/android-icon-foreground.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
      ],
    },
    plugins: [
      'expo-dev-client',
      'expo-router',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow College Bus to use your location to track the bus during trips.',
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      [
        'expo-camera',
        {
          cameraPermission: 'Allow College Bus to access your camera to scan QR codes for check-in.',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/android-icon-monochrome.png',
          color: '#356C8F',
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      appEnv,
      eas: projectId
        ? {
            projectId,
          }
        : undefined,
    },
    updates: projectId
      ? {
          url: `https://u.expo.dev/${projectId}`,
          enabled: false,
          fallbackToCacheTimeout: 0,
        }
      : {
          enabled: false,
          fallbackToCacheTimeout: 0,
        },
    ...(expoOwner ? { owner: expoOwner } : {}),
  };
};
