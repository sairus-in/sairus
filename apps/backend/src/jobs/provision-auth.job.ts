import { prisma } from '../lib/prisma';
import { firebaseAdmin } from '../lib/firebase';
import { logger } from '../lib/logger';

export async function processAuthProvisioning() {
  const users = await prisma.user.findMany({
    where: { authStatus: 'PENDING_PROVISIONING' },
    take: 50 // Chunk constraints avoiding Firebase Auth rate limits
  });

  if (!users.length) return { processed: 0, failed: 0 };

  const authReady = !!firebaseAdmin;
  let processed = 0;
  let failed = 0;

  for (const user of users) {
    try {
      let finalStatus = 'ACTIVE';

      if (authReady) {
        try {
          // Attempt default password mapping
          const password = `Welcome@${user.phone.slice(-4)}`;
          await firebaseAdmin!.auth().createUser({
            uid: user.id,
            phoneNumber: user.phone.startsWith('+') ? user.phone : `+91${user.phone}`,
            email: user.email || undefined,
            displayName: user.name,
            password
          });
          
          await firebaseAdmin!.auth().setCustomUserClaims(user.id, { role: user.role });
        } catch (e: any) {
          // Soft-fail on existing users mapping directly to ACTIVE assuming prior linkages
          if (e.code === 'auth/phone-number-already-exists' || e.code === 'auth/uid-already-exists' || e.code === 'auth/email-already-exists') {
            finalStatus = 'ACTIVE';
          } else {
            throw e;
          }
        }
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { 
          authStatus: finalStatus as any, 
          authProvisionError: null 
        }
      });
      processed++;
    } catch (e: any) {
      await prisma.user.update({
        where: { id: user.id },
        data: { 
          authStatus: 'AUTH_PROVISION_FAILED', 
          authProvisionError: e.message,
          authProvisionFailedAt: new Date()
        }
      });
      failed++;
      logger.error({ event: 'auth_provisioning_failed', userId: user.id }, e);
    }
  }

  return { processed, failed };
}
