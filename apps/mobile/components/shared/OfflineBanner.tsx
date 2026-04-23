// components/shared/OfflineBanner.tsx — Slides down when offline, green flash on reconnect
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { t } from '../../i18n';

export function OfflineBanner() {
  const { isConnected, wasOffline } = useNetworkStatus();
  const translateY = useRef(new Animated.Value(-60)).current;

  const show = !isConnected || wasOffline;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: show ? 0 : -60,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [show]);

  if (!show && !wasOffline) return null;

  return (
    <Animated.View
      style={[
        styles.banner,
        { transform: [{ translateY }] },
        wasOffline && isConnected ? styles.online : styles.offline,
      ]}
    >
      <Text style={styles.text}>
        {wasOffline && isConnected ? t('common.backOnline') : t('common.offline')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  offline: {
    backgroundColor: colors.warning.bg,
  },
  online: {
    backgroundColor: colors.success.bg,
  },
  text: {
    fontFamily: typography.family,
    fontWeight: typography.weights.medium,
    fontSize: typography.sizes.small,
    color: colors.text.primary,
  },
});
