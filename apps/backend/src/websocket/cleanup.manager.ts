export class SocketCleanupManager {
  private timers = new Map<string, NodeJS.Timeout>();

  scheduleCleanup(socketId: string, fn: () => Promise<void>, delayMs = 5000) {
    this.cancelCleanup(socketId); // Always cancel existing before scheduling
    const t = setTimeout(async () => {
      await fn();
      this.timers.delete(socketId);
    }, delayMs);
    this.timers.set(socketId, t);
  }

  cancelCleanup(socketId: string) {
    const t = this.timers.get(socketId);
    if (t) { clearTimeout(t); this.timers.delete(socketId); }
  }

  get activeTimerCount() { return this.timers.size; } // For monitoring
}
