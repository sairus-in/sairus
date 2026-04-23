import { AppError } from './errors';

// Pre-computed at module load — O(1) lookup for both checks
const COMMON_PASSWORDS = new Set([
  'password', 'Password1', 'Password123', 'Password@123',
  'Admin@123', 'Admin1234', 'Admin@2024', 'Admin@2025', 'Admin@2026',
  'Welcome1', 'Welcome@1', 'College@123', 'Transport@1',
  'Qwerty123', 'Qwerty@1', '123456789', '12345678',
  'Letmein1', 'Changeme1', 'Changeme@1',
  'Passw0rd', 'P@ssword1', 'P@ssw0rd',
  'Summer2024', 'Winter2024', 'Spring2024', 'Summer2025', 'Winter2025',
  'January@1', 'Monday@123', 'Sunday@123',
  'India@123', 'Chennai@1', 'College1', 'Campus@1',
]);

// Pre-compute lowercased Set at startup — O(1) case-insensitive check
const COMMON_PASSWORDS_LOWER = new Set(
  [...COMMON_PASSWORDS].map(p => p.toLowerCase())
);

export const validateAdminPassword = (password: string): void => {
  if (password.length < 12) {
    throw new AppError('Password must be at least 12 characters', 400, 'PASSWORD_TOO_SHORT');
  }

  // O(1) exact match
  if (COMMON_PASSWORDS.has(password)) {
    throw new AppError('This password is too common. Please choose a more unique password.', 400, 'PASSWORD_TOO_COMMON');
  }

  // O(1) case-insensitive match
  if (COMMON_PASSWORDS_LOWER.has(password.toLowerCase())) {
    throw new AppError('This password is too common. Please choose a more unique password.', 400, 'PASSWORD_TOO_COMMON');
  }
};
