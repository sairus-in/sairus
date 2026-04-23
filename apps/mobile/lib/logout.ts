import { authService } from '../services/auth.service';
import { clearMobileSession } from './session';

export async function performLogout(): Promise<void> {
  await authService.logout().catch(() => {});
  await clearMobileSession();
}
