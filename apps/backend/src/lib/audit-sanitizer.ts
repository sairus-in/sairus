/**
 * AUDIT LOG SANITIZER
 *
 * Masks sensitive fields in audit log before/after data before
 * it is returned from the API or written to the audit trail.
 *
 * WHY THIS EXISTS:
 *   The audit log stores the full entity state before and after every change.
 *   This means a password change stores the old password HASH in before.passwordHash.
 *   If audit logs are breached, those hashes are offline-crackable.
 *
 *   Additionally, FCM tokens would allow an attacker to send push notifications—
 *   effectively impersonating the server.
 *
 * RULE:
 *   Any field in this list is replaced with '[REDACTED]'.
 *   This happens before the audit log entry is returned from GET endpoints.
 */

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordHash',
  'hashedPassword',
  'firebaseToken',
  'fcmToken',
  'refreshToken',
  'accessToken',
  'apiKey',
  'secret',
  'mfaSecret',
  'sessionToken',
  'resetToken',
  'inviteToken',
  'confirmationToken',
  'privateKey',
  'webhookSecret',
  'jwtToken',
  'verificationCode',
  'otp',
  'totpSecret',
]);

/**
 * Recursively mask sensitive fields in an audit log snapshot.
 * Returns a new object — never mutates the original.
 *
 * @param data The before/after snapshot from the audit log
 * @returns    A sanitized copy safe to return in API responses
 */
export function sanitizeAuditData(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeAuditData);
  }

  if (typeof data === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_FIELD_NAMES.has(key) && value != null) {
        copy[key] = '[REDACTED]';
      } else {
        copy[key] = sanitizeAuditData(value);
      }
    }
    return copy;
  }

  return data;
}

/**
 * Sanitize an array of audit log entries as returned by Prisma.
 * Call this on the entries array before passing to okList().
 */
export function sanitizeAuditEntries<T extends { before?: unknown; after?: unknown }>(
  entries: T[],
): T[] {
  return entries.map((entry) => ({
    ...entry,
    before: entry.before !== undefined ? sanitizeAuditData(entry.before) : undefined,
    after: entry.after !== undefined ? sanitizeAuditData(entry.after) : undefined,
  }));
}
