import { env } from './env';
import { circuitExecute } from './redis-circuit';
import { logger } from './logger';

/**
 * MSG91 SMS Client
 * Triggered by the notifications service to dispatch critical alerts like
 * breakdown SOS texts or login OTPs.
 */
export async function sendSms(phone: string, templateId: string, variables: Record<string, string>) {
  if (!env.MSG91_AUTH_KEY) {
    logger.info({
      event: 'msg91_mock_sms',
      source: 'SYSTEM',
      meta: { templateId },
    });
    return true;
  }
  const authKey = env.MSG91_AUTH_KEY;

  return circuitExecute(
    async () => {
      const response = await fetch('https://api.msg91.com/api/v5/flow/', {
        method: 'POST',
        headers: {
          authkey: authKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: templateId,
          recipients: [
            {
              mobiles: phone,
              ...variables,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`MSG91 API error: ${response.statusText}`);
      }

      return await response.json();
    },
    'allow_degraded',
    async () => {
      logger.warn({
        event: 'msg91_sms_degraded',
        source: 'SYSTEM',
        meta: { templateId },
      });
      return false;
    },
    'msg91-sms',
  );
}
