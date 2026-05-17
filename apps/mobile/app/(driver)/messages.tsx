// app/(driver)/messages.tsx — Admin messages list
import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTrip } from '../../store/trip.store';
import { typography } from '../../constants/theme';
import { EmptyState } from '../../components/shared/EmptyState';
import { ScreenErrorBoundary } from '../../components/shared/ScreenErrorBoundary';

const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  msgBg: '#FFFFFF',
  urgentBg: '#FEF3C7',
  urgentText: '#78350F',
  link: '#356C8F',
};

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
    <View style={[s.messageCard, item.isUrgent && s.urgentCard]}>
      <Text style={[s.messageBody, item.isUrgent && s.urgentBody]}>{item.body}</Text>
      <Text style={[s.messageTime, item.isUrgent && s.urgentTime]}>
        {new Date(item.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  ), []);

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Admin Messages</Text>
      </View>

      {adminMessages.length === 0 ? (
        <EmptyState
          title="No messages"
          subtitle="Messages from the transport office will appear here"
        />
      ) : (
        <FlashList
          data={reversedMessages}
          keyExtractor={(item) => `${item.receivedAt}:${item.body}`}
          estimatedItemSize={96}
          removeClippedSubviews={adminMessages.length > 20}
          contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 12, paddingBottom: 40 }}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 16,
    gap: 10,
  },
  back: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: '500',
    color: C.link,
  },
  title: {
    fontFamily: typography.family,
    fontSize: 26,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: -0.5,
  },
  separator: {
    height: 8,
  },
  messageCard: {
    backgroundColor: C.msgBg,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  urgentCard: {
    backgroundColor: C.urgentBg,
  },
  messageBody: {
    fontFamily: typography.family,
    fontSize: 15,
    color: C.ink,
    lineHeight: 22,
  },
  urgentBody: {
    color: C.urgentText,
  },
  messageTime: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.ghost,
  },
  urgentTime: {
    color: C.urgentText,
    opacity: 0.6,
  },
});
