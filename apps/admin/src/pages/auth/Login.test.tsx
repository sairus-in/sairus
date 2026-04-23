import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Login } from './Login';
import { resetAuthStore } from '../../test/auth-store';

const { mockApi, mockNavigate, routerState } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  mockNavigate: vi.fn(),
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
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
}));

const renderLogin = (search = '') => {
  routerState.search = search;
  render(<Login />);
};

describe('Login', () => {
  beforeEach(() => {
    resetAuthStore();
    vi.clearAllMocks();
    routerState.search = '';
  });

  it('shows the forced reauth banner when redirected for security reasons', () => {
    renderLogin('reason=forced-reauth');

    return expect(
      screen.findByText(/session was challenged by a security control/i),
    ).resolves.toBeInTheDocument();
  });

  it('shows the suspended-account banner when redirected after suspension', () => {
    renderLogin('reason=account-suspended');

    return expect(screen.findByText(/account is suspended/i)).resolves.toBeInTheDocument();
  });

  it('completes login and hydrates the admin session after direct credential success', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValueOnce({
      user: {
        id: 'admin_1',
      },
    });
    mockApi.get.mockResolvedValueOnce({
      id: 'admin_1',
      name: 'Alex Admin',
      email: 'admin@example.com',
      role: 'MANAGEMENT',
      routeIds: [],
      department: null,
    });

    renderLogin();

    await user.type(await screen.findByLabelText(/^email$/i), 'admin@example.com');
    await user.type(await screen.findByLabelText(/^password$/i), 'CorrectHorseBatteryStaple!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ops/dashboard', { replace: true });
    });

    expect(mockApi.post).toHaveBeenCalledWith('/v1/admin/auth/login', {
      email: 'admin@example.com',
      password: 'CorrectHorseBatteryStaple!',
    });
    expect(mockApi.get).toHaveBeenCalledWith('/v1/admin/auth/me');
  });

  it('supports backup-code completion for MFA challenges', async () => {
    const user = userEvent.setup();
    mockApi.post
      .mockResolvedValueOnce({
        mfaRequired: true,
        challengeToken: 'challenge-token',
        expiresInSeconds: 300,
      })
      .mockResolvedValueOnce({});
    mockApi.get.mockResolvedValueOnce({
      id: 'admin_1',
      name: 'Alex Admin',
      email: 'admin@example.com',
      role: 'MANAGEMENT',
      routeIds: [],
      department: null,
    });

    renderLogin();

    await user.type(await screen.findByLabelText(/^email$/i), 'admin@example.com');
    await user.type(await screen.findByLabelText(/^password$/i), 'CorrectHorseBatteryStaple!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /verify mfa/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /backup code/i }));
    await user.type(await screen.findByLabelText(/^backup code$/i), 'ABCD1234');
    await user.click(screen.getByRole('button', { name: /verify and continue/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/ops/dashboard', { replace: true });
    });

    expect(mockApi.post).toHaveBeenNthCalledWith(2, '/v1/admin/auth/verify-mfa', {
      challengeToken: 'challenge-token',
      backupCode: 'ABCD1234',
    });
  });
});
