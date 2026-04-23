import { describe, expect, it } from 'vitest';
import {
  getDateKey,
  getMinutesSinceMidnightIST,
  getTodayDateKey,
  getTomorrowDateKey,
  getYesterdayDateKey,
  minutesToTimeString,
  timeStringToMinutes,
} from './time.utils';

describe('time utils', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToTimeString(435)).toBe('07:15');
  });

  it('converts HH:MM back to minutes', () => {
    expect(timeStringToMinutes('17:30')).toBe(1050);
  });

  it('derives IST date keys safely around UTC midnight', () => {
    const utcEvening = new Date('2026-03-24T18:45:00.000Z');

    expect(getDateKey(utcEvening)).toBe('2026-03-25');
    expect(getTodayDateKey(utcEvening)).toBe('2026-03-25');
    expect(getYesterdayDateKey(utcEvening)).toBe('2026-03-24');
  });

  it('derives tomorrow date keys in IST', () => {
    const utcMorning = new Date('2026-03-24T06:00:00.000Z');
    expect(getTomorrowDateKey(utcMorning)).toBe('2026-03-25');
  });

  it('computes IST minutes since midnight', () => {
    const sample = new Date('2026-03-24T03:45:00.000Z');
    expect(getMinutesSinceMidnightIST(sample)).toBe(555);
  });
});
