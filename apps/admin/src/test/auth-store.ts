import { useAuthStore } from '../store/auth.store';

export const resetAuthStore = () => {
  useAuthStore.setState({
    user: null,
    capabilities: null,
    isAuthenticated: false,
  });
};
