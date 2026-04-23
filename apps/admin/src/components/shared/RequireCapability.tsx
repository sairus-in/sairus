import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth.store';
import { Capabilities } from '../../lib/capabilities';

type BooleanCapabilityKey = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never
}[keyof Capabilities];

interface RequireCapabilityProps {
  capability: BooleanCapabilityKey;
  children: React.ReactNode;
}

export const RequireCapability: React.FC<RequireCapabilityProps> = ({ capability, children }) => {
  const { capabilities, isAuthenticated } = useAuthStore();

  if (!isAuthenticated || !capabilities) {
    console.warn(`[RequireCapability] Redirecting to login - auth state: ${isAuthenticated}, capabilities: ${JSON.stringify(capabilities)}`);
    return <Navigate to="/login" replace />;
  }

  // Ensure boolean check (not just truthy scope strings)
  if (capabilities[capability] !== true) {
    console.warn(`[RequireCapability] Access Denied for capability: ${capability}`, { capabilities });
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.5rem', color: '#DC2626' }}>Access Denied</h2>
        <p>You do not have the required capability: <strong>{capability}</strong></p>
      </div>
    );
  }

  console.log(`[RequireCapability] Access Granted for capability: ${capability}`);
  return <>{children}</>;
};
