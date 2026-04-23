import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AcceptInvite } from './AcceptInvite';
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

const renderAcceptInvite = (search = '') => {
  routerState.search = search;
  render(<AcceptInvite />);
};

describe('AcceptInvite', () => {
  beforeEach(() => {
    resetAuthStore();
    vi.clearAllMocks();
    routerState.search = '';
  });

  it('verifies the invite token and activates the account with the chosen password', async () => {
    const user = userEvent.setup();
    mockApi.post
      .mockResolvedValueOnce({
        valid: true,
        emailHint: 'ad***@example.com',
        name: 'Alex Admin',
      })
      .mockResolvedValueOnce({
        message: 'Account activated. You can sign in now.',
      });

    renderAcceptInvite('token=invite-token');

    expect(await screen.findByText(/set the first password for alex admin/i)).toBeInTheDocument();

    await user.type(await screen.findByLabelText(/^password$/i), 'CorrectHorseBatteryStaple!');
    await user.type(await screen.findByLabelText(/confirm password/i), 'CorrectHorseBatteryStaple!');
    await user.click(screen.getByRole('button', { name: /activate account/i }));

    await waitFor(() => {
      expect(screen.getByText(/account activated/i)).toBeInTheDocument();
    });

    expect(mockApi.post).toHaveBeenNthCalledWith(
      1,
      '/v1/admin/auth/invite/verify-token',
      { token: 'invite-token' },
    );
    expect(mockApi.post).toHaveBeenNthCalledWith(2, '/v1/admin/auth/set-password', {
      token: 'invite-token',
      password: 'CorrectHorseBatteryStaple!',
    });
  });
});
