// store/trip.store.ts — Driver kiosk state (Zustand, not persisted)
import { create } from 'zustand';

interface WaitRequest {
  studentName: string;
  etaMinutes: number;
  receivedAt: number;
}

interface AdminMessage {
  body: string;
  isUrgent: boolean;
  receivedAt: number;
}

interface LastToast {
  name: string;
  status: 'PRESENT' | 'LATE_BOARD';
  distanceToStop: number;
  time: number;
}

interface TripStore {
  // QR state
  qrToken: string | null;
  qrExpiresAt: number | null;

  // Counts
  boardedCount: number;
  expectedCount: number;

  // Current stop tracking
  currentStopName: string;
  nextStopName: string | null;

  // Toasts + banners
  lastToast: LastToast | null;
  waitRequests: WaitRequest[];
  adminMessages: AdminMessage[];

  // Socket status
  socketStatus: 'connected' | 'disconnected' | 'reconnecting';

  // Actions
  setQR: (token: string, expiresAt: number) => void;
  setBoardedCount: (count: number | ((prev: number) => number)) => void;
  setExpectedCount: (count: number) => void;
  setCurrentStop: (name: string) => void;
  setNextStop: (name: string | null) => void;
  setLastToast: (toast: LastToast | null) => void;
  addWaitRequest: (req: WaitRequest) => void;
  addAdminMessage: (msg: AdminMessage) => void;
  setSocketStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  reset: () => void;
}

const initialState = {
  qrToken: null as string | null,
  qrExpiresAt: null as number | null,
  boardedCount: 0,
  expectedCount: 0,
  currentStopName: '',
  nextStopName: null as string | null,
  lastToast: null as LastToast | null,
  waitRequests: [] as WaitRequest[],
  adminMessages: [] as AdminMessage[],
  socketStatus: 'disconnected' as const,
};

export const useTripStore = create<TripStore>()(
  (set: (partial: Partial<TripStore> | ((state: TripStore) => Partial<TripStore>)) => void) => ({
    ...initialState,

    setQR: (token: string, expiresAt: number) => set({ qrToken: token, qrExpiresAt: expiresAt }),
    setBoardedCount: (countOrFn: number | ((prev: number) => number)) =>
      set((state: TripStore) => ({
        boardedCount: typeof countOrFn === 'function' ? countOrFn(state.boardedCount) : countOrFn,
      })),
    setExpectedCount: (count: number) => set({ expectedCount: count }),
    setCurrentStop: (name: string) => set({ currentStopName: name }),
    setNextStop: (name: string | null) => set({ nextStopName: name }),
    setLastToast: (toast: LastToast | null) => set({ lastToast: toast }),
    addWaitRequest: (req: WaitRequest) =>
      set((state: TripStore) => ({ waitRequests: [...state.waitRequests, req] })),
    addAdminMessage: (msg: AdminMessage) =>
      set((state: TripStore) => ({ adminMessages: [...state.adminMessages, msg] })),
    setSocketStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => set({ socketStatus: status }),
    reset: () => set(initialState),
  }),
);

// Type-safe selector helper for Zustand v4
// Usage: useTrip(s => s.qrToken) instead of useTripStore((s) => s.qrToken)
export function useTrip<T>(selector: (state: TripStore) => T): T {
  return useTripStore(selector as any) as T;
}
