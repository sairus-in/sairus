import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminStepUpModal } from './AdminStepUpModal';
import { createAxiosError } from '../../test/axios-error';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../lib/api.client', () => ({
  api: mockApi,
}));

describe('AdminStepUpModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests a step-up token and forwards it to the authorized action', async () => {
    const user = userEvent.setup();
    const onAuthorized = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    mockApi.post.mockResolvedValueOnce({
      stepUpToken: 'step-up-token',
      expiresInSeconds: 300,
    });

    render(
      <AdminStepUpModal
        open
        title="Regenerate backup codes"
        description="Confirm before rotating recovery codes."
        actionLabel="Regenerate codes"
        onAuthorized={onAuthorized}
        onClose={onClose}
      />,
    );

    await user.type(await screen.findByLabelText(/^password$/i), 'CorrectHorseBatteryStaple!');
    await user.click(screen.getByRole('button', { name: /regenerate codes/i }));

    await waitFor(() => {
      expect(onAuthorized).toHaveBeenCalledWith('step-up-token');
    });

    expect(mockApi.post).toHaveBeenCalledWith('/v1/admin/auth/step-up', {
      password: 'CorrectHorseBatteryStaple!',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the backend validation error when the password confirmation fails', async () => {
    const user = userEvent.setup();
    mockApi.post.mockRejectedValueOnce(
      createAxiosError('INVALID_PASSWORD', 'Password is incorrect.', 401),
    );

    render(
      <AdminStepUpModal
        open
        title="Suspend administrator"
        description="Confirm before suspending this account."
        onAuthorized={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.type(await screen.findByLabelText(/^password$/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /confirm action/i }));

    await waitFor(() => {
      expect(screen.getByText(/password is incorrect/i)).toBeInTheDocument();
    });
  });
});
