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
import { typography } from '../../../constants/theme';
import { ListLoadingSkeleton } from '../../../components/shared/LoadingState';
import { ScreenErrorState } from '../../../components/shared/ScreenErrorState';
import { t } from '../../../i18n';
import { studentService } from '../../../services/student.service';

const C = {
  bg: '#BFE6FF',
  ink: '#1A1A1C',
  muted: '#565656',
  ghost: '#C9C9C9',
  border: '#E9E9E9',
  card: '#356C8F',
  cardText: '#FFFFFF',
  cardMuted: 'rgba(255, 255, 255, 0.7)',
  inputBg: '#FFFFFF',
  evidenceBg: '#FEF3C7',
  evidenceText: '#78350F',
  errorText: '#991B1B',
  btnBg: '#356C8F',
  btnText: '#FFFFFF',
  link: '#356C8F',
};

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
      <SafeAreaView style={s.container}>
        <View style={s.headerBlock}>
          <Text style={s.title}>{t('correction.title')}</Text>
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
    <SafeAreaView style={s.container}>
      <View style={s.layout}>

        {/* Header */}
        <View style={s.headerBlock}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>{t('correction.title')}</Text>
        </View>

        {/* Attendance log — dark card */}
        {logData ? (
          <View style={s.logCard}>
            <Text style={s.logDate}>{logData.date}</Text>
            <Text style={s.logMeta}>Bus {logData.busNumber} · {logData.tripType}</Text>
          </View>
        ) : null}

        {/* GPS evidence — amber tint, no border */}
        {typeof logData?.distanceToBus === 'number' ? (
          <View style={s.evidenceCard}>
            <Text style={s.evidenceText}>
              {t('correction.gpsEvidence', {
                busDist: String(logData.distanceToBus || 0),
                stopDist: String(logData.distanceToStop || 0),
              })}
            </Text>
          </View>
        ) : null}

        {/* Reason input */}
        <TextInput
          style={s.input}
          placeholder={t('correction.reasonPlaceholder')}
          placeholderTextColor={C.ghost}
          value={reason}
          onChangeText={setReason}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          accessibilityLabel="Correction reason"
          accessibilityHint="Describe why you believe your attendance should be corrected"
        />

        {/* Validation hint */}
        {reason.length > 0 && reason.length < 10 ? (
          <Text style={s.hint}>{t('correction.minChars')}</Text>
        ) : null}

        {/* Mutation error */}
        {mutation.error ? (
          <Text style={s.errorText}>
            {mutation.error instanceof Error ? mutation.error.message : 'Unable to submit correction right now.'}
          </Text>
        ) : null}

        {/* Submit */}
        <TouchableOpacity
          style={[s.btn, (!isValid || mutation.isPending) && s.btnDisabled]}
          onPress={() => mutation.mutate()}
          disabled={!isValid || mutation.isPending}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('correction.submit')}
          accessibilityState={{ disabled: !isValid || mutation.isPending, busy: mutation.isPending }}
        >
          {mutation.isPending
            ? <ActivityIndicator color={C.btnText} />
            : <Text style={s.btnLabel}>{t('correction.submit')}</Text>
          }
        </TouchableOpacity>

        <Text style={s.reviewNote}>{t('correction.reviewNote')}</Text>

      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  layout: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 16,
  },

  // Header
  headerBlock: {
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

  // Attendance log card — dark, no side-stripe
  logCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 18,
    gap: 4,
  },
  logDate: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.cardText,
  },
  logMeta: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.cardMuted,
  },

  // GPS evidence — amber tint, no border
  evidenceCard: {
    backgroundColor: C.evidenceBg,
    borderRadius: 12,
    padding: 14,
  },
  evidenceText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.evidenceText,
    lineHeight: 20,
  },

  // Input
  input: {
    backgroundColor: C.inputBg,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 14,
    padding: 14,
    fontFamily: typography.family,
    fontSize: 15,
    color: C.ink,
    minHeight: 110,
  },

  // Feedback
  hint: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.ghost,
    marginTop: -4,
  },
  errorText: {
    fontFamily: typography.family,
    fontSize: 13,
    color: C.errorText,
  },

  // Submit
  btn: {
    backgroundColor: C.btnBg,
    height: 54,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnLabel: {
    fontFamily: typography.family,
    fontSize: 16,
    fontWeight: '600',
    color: C.btnText,
  },
  reviewNote: {
    fontFamily: typography.family,
    fontSize: 12,
    color: C.ghost,
    textAlign: 'center',
  },
});
