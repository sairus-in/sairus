import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPassword } from './ForgotPassword';
import { resetAuthStore } from '../../test/auth-store';

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

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

describe('ForgotPassword', () => {
  beforeEach(() => {
    resetAuthStore();
    vi.clearAllMocks();
  });

  it('submits the admin email and shows the server confirmation message', async () => {
    const user = userEvent.setup();
    mockApi.post.mockResolvedValueOnce({
      message: 'If that account exists, a reset link has been sent.',
    });

    render(<ForgotPassword />);

    await user.type(await screen.findByLabelText(/^email$/i), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/if that account exists, a reset link has been sent/i),
      ).toBeInTheDocument();
    });

    expect(mockApi.post).toHaveBeenCalledWith('/v1/admin/auth/forgot-password', {
      email: 'admin@example.com',
    });
  });
});
