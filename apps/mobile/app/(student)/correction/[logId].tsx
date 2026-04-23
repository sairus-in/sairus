import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { ListLoadingSkeleton } from '../../../components/shared/LoadingState';
import { ScreenErrorState } from '../../../components/shared/ScreenErrorState';
import { t } from '../../../i18n';
import { studentService } from '../../../services/student.service';

export default function CorrectionScreen() {
  const router = useRouter();
  const { logId } = useLocalSearchParams<{ logId: string }>();
  const [reason, setReason] = useState('');

  // USER_DATA: an attendance log is student-specific and may change briefly while corrections are pending.
  const { data: logData, isLoading, error, refetch } = useQuery({
    queryKey: ['attendance-log', logId],
    queryFn: () => studentService.getAttendanceLog(logId!),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: () => studentService.submitCorrection({
      attendanceId: logId!,
      reason,
    }),
    onSuccess: () => {
      Alert.alert('Submitted', 'Your correction request has been submitted.');
      router.back();
    },
  });

  const isValid = reason.trim().length >= 10;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('correction.title')}</Text>
        </View>
        <ListLoadingSkeleton rows={4} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <ScreenErrorState
        title="Correction form unavailable"
        message={error instanceof Error ? error.message : 'Unable to load attendance details.'}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backBtn}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('correction.title')}</Text>
      </View>

      <View style={styles.content}>
        {logData ? (
          <View style={styles.incidentCard}>
            <Text style={styles.incidentDate}>{logData.date}</Text>
            <Text style={styles.incidentMeta}>
              Bus {logData.busNumber} - {logData.tripType}
            </Text>
          </View>
        ) : null}

        {typeof logData?.distanceToBus === 'number' ? (
          <View style={styles.evidenceCard}>
            <Text style={styles.evidenceText}>
              {t('correction.gpsEvidence', {
                busDist: String(logData.distanceToBus || 0),
                stopDist: String(logData.distanceToStop || 0),
              })}
            </Text>
          </View>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder={t('correction.reasonPlaceholder')}
          placeholderTextColor={colors.text.muted}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {reason.length > 0 && reason.length < 10 ? (
          <Text style={styles.hint}>{t('correction.minChars')}</Text>
        ) : null}

        {mutation.error ? (
          <Text style={styles.errorText}>
            {mutation.error instanceof Error ? mutation.error.message : 'Unable to submit correction right now.'}
          </Text>
        ) : null}

        <TouchableOpacity
          style={[styles.submitBtn, !isValid && styles.submitDisabled]}
          onPress={() => mutation.mutate()}
          disabled={!isValid || mutation.isPending}
          activeOpacity={0.8}
        >
          {mutation.isPending ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.submitText}>{t('correction.submit')}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.reviewNote}>{t('correction.reviewNote')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  backBtn: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.brand.primary,
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: typography.family,
    fontSize: typography.sizes.h1,
    fontWeight: typography.weights.bold,
    color: colors.text.primary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  incidentCard: {
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand.primary,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  incidentDate: {
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.medium,
    color: colors.text.primary,
  },
  incidentMeta: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.text.muted,
    marginTop: 2,
  },
  evidenceCard: {
    backgroundColor: colors.warning.bg,
    borderWidth: 1,
    borderColor: colors.warning.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  evidenceText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.warning.text,
  },
  input: {
    backgroundColor: colors.card.bg,
    borderWidth: 1,
    borderColor: colors.card.border,
    borderRadius: radii.input,
    padding: spacing.md,
    marginTop: spacing.md,
    fontFamily: typography.family,
    fontSize: typography.sizes.body,
    color: colors.text.primary,
    minHeight: 100,
  },
  hint: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.text.muted,
    marginTop: spacing.micro,
  },
  errorText: {
    fontFamily: typography.family,
    fontSize: typography.sizes.small,
    color: colors.error.text,
    marginTop: spacing.sm,
  },
  submitBtn: {
    backgroundColor: colors.button.primary.bg,
    paddingVertical: 15,
    borderRadius: radii.button,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontFamily: typography.family,
    fontSize: 15,
    fontWeight: typography.weights.semibold,
    color: colors.white,
  },
  reviewNote: {
    fontFamily: typography.family,
    fontSize: typography.sizes.micro,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
