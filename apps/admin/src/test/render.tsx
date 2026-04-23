import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type RenderWithProvidersOptions = RenderOptions & {
  route?: string;
  queryClient?: QueryClient;
  withQueryClient?: boolean;
};

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

export const renderWithProviders = (
  ui: React.ReactElement,
  options: RenderWithProvidersOptions = {},
) => {
  const {
    route = '/',
    queryClient = createTestQueryClient(),
    withQueryClient = false,
    ...renderOptions
  } = options;

  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>
      {withQueryClient ? (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ) : (
        children
      )}
    </MemoryRouter>
  );

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
};
