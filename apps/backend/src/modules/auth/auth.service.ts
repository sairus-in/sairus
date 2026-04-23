import { firebaseAdmin } from '../../lib/firebase';
import { prisma } from '../../lib/prisma';
import { isProduction } from '../../lib/env';
import { Role } from 'shared';

export class AuthService {
  /**
   * Validates a Firebase ID Token and ensures the user exists in our local DB.
   * Syncs basic profile data if it's the first time logging in.
   */
  async verifyFirebaseToken(token: string) {
    if (!firebaseAdmin && isProduction) throw new Error('Firebase Admin not initialized');

    try {
      let phoneToFind = '';
      if (!isProduction && token.startsWith('MOCK_TEST_')) {
        phoneToFind = token.replace('MOCK_TEST_', '+91');
      } else {
        if (!firebaseAdmin) throw new Error('Firebase Admin not initialized');
        const decodedUser = await firebaseAdmin.auth().verifyIdToken(token);
        if (!decodedUser.phone_number) throw new Error('Phone number is required from Firebase Auth');
        phoneToFind = decodedUser.phone_number;
      }

      // Check DB
      let user = await prisma.user.findUnique({
        where: { phone: phoneToFind },
      });

      if (!user) {
        // Automatically provision them? Depends on business rules.
        // Usually, the college pre-fills the DB with all students.
        // If not found, they aren't authorized to use the app.
        throw new Error('User not found in College database');
      }

      if (!user.isActive) {
        throw new Error('Account is disabled');
      }

      return {
        uid: user.id,
        role: user.role as Role,
      };
    } catch (error) {
      console.error('Firebase Token Verification failed:', error);
      throw error;
    }
  }
}

export const authService = new AuthService();
