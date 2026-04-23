import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPassword } from './ResetPassword';
import { resetAuthStore } from '../../test/auth-store';

const { mockApi, routerState } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  routerState: {
    search: '',
  },
}));

vi.mock('../../lib/api.client', () => ({
  api: mockApi,
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
}));

const renderResetPassword = (search = '') => {
  routerState.search = search;
  render(<ResetPassword />);
};

describe('ResetPassword', () => {
  beforeEach(() => {
    resetAuthStore();
    vi.clearAllMocks();
    routerState.search = '';
  });

  it('verifies the reset token and submits the new password', async () => {
    const user = userEvent.setup();
    mockApi.post
      .mockResolvedValueOnce({
        valid: true,
        emailHint: 'ad***@example.com',
        name: 'Alex Admin',
      })
      .mockResolvedValueOnce({
        message: 'Password reset complete. You can sign in now.',
      });

    renderResetPassword('token=reset-token');

    expect(await screen.findByText(/resetting access for alex admin/i)).toBeInTheDocument();

    await user.type(await screen.findByLabelText(/^new password$/i), 'CorrectHorseBatteryStaple!');
    await user.type(
      await screen.findByLabelText(/confirm new password/i),
      'CorrectHorseBatteryStaple!',
    );
    await user.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => {
      expect(screen.getByText(/password reset complete/i)).toBeInTheDocument();
    });

    expect(mockApi.post).toHaveBeenNthCalledWith(
      1,
      '/v1/admin/auth/reset-password/verify-token',
      { token: 'reset-token' },
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(2, '/v1/admin/auth/reset-password', {
      token: 'reset-token',
      newPassword: 'CorrectHorseBatteryStaple!',
    });
  });
});
