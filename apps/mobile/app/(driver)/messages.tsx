// app/(driver)/messages.tsx — Admin messages list
// HARDENED v3:
//   - All hardcoded hex → theme tokens
//   - ScreenErrorBoundary wrapping
import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrip } from '../../store/trip.store';
import { colors, typography, spacing, radii } from '../../constants/theme';
import { EmptyState } from '../../components/shared/EmptyState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

export default function MessagesScreen() {
  return (
    <ScreenErrorBoundary screenName="DriverMessages">
      <MessagesContent />
    </ScreenErrorBoundary>
  );
}

function MessagesContent() {
  const router = useRouter();
  const adminMessages = useTrip((s) => s.adminMessages);
  const reversedMessages = useMemo(() => [...adminMessages].reverse(), [adminMessages]);
  const renderItem = useCallback(({ item }: { item: typeof reversedMessages[number] }) => (
    <View style={[styles.messageCard, item.isUrgent && styles.urgentCard]}>
      <Text style={styles.messageBody}>{item.body}</Text>
      <Text style={styles.messageTime}>
        {new Date(item.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  ), []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Admin Messages</Text>
      </View>

      {adminMessages.length === 0 ? (
        <EmptyState title="No messages" subtitle="Messages from the transport office will appear here" />
      ) : (
        <FlashList
          data={reversedMessages}
          keyExtractor={(item) => `${item.receivedAt}:${item.body}`}
          estimatedItemSize={96}
          removeClippedSubviews={adminMessages.length > 20}
          contentContainerStyle={{ padding: spacing.xl }}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  back: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.brand.primary, marginBottom: spacing.md,
  },
  title: {
    fontFamily: typography.family, fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold, color: colors.text.primary,
  },
  messageCard: {
    backgroundColor: colors.card.bg, borderWidth: 1, borderColor: colors.card.border,
    borderRadius: radii.sm, padding: spacing.md, marginBottom: spacing.xs,
  },
  urgentCard: {
    borderLeftWidth: 3, borderLeftColor: colors.error.text,
  },
  messageBody: {
    fontFamily: typography.family, fontSize: typography.sizes.body,
    color: colors.text.primary,
  },
  messageTime: {
    fontFamily: typography.family, fontSize: typography.sizes.micro,
    color: colors.text.muted, marginTop: spacing.micro,
  },
});
