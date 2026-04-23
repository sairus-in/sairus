import { logger } from './logger';

export const sendPasswordResetEmail = async (email: string, name: string, token: string): Promise<void> => {
  // In Phase 1, we just log this. Later connect to Resend, Sendgrid, etc.
  logger.info({
    event: 'send_password_reset_email'
  });
}

export const sendInviteEmail = async (email: string, name: string, token: string): Promise<void> => {
  logger.info({
    event: 'send_invite_email'
  });
}
