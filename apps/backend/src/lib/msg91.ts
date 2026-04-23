import { env } from './env';

/**
 * MSG91 SMS Client
 * Triggered by the notifications service to dispatch critical alerts like
 * breakdown SOS texts or login OTPs.
 */
export async function sendSms(phone: string, templateId: string, variables: Record<string, string>) {
  if (!env.MSG91_AUTH_KEY) {
    console.log(`[Mock MSG91] SMS would have been sent to ${phone} using template ${templateId}`);
    return true;
  }

  try {
    const response = await fetch('https://api.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: {
        authkey: env.MSG91_AUTH_KEY,
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
  } catch (error) {
    console.error('MSG91 Send SMS failed:', error);
    throw error;
  }
}
