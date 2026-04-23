import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmWithImpactModalProps {
  title: string;
  description: string;
  impacts: string[];
  confirmLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  promptLabel?: string;
  promptPlaceholder?: string;
  promptValue?: string;
  promptRequired?: boolean;
  onPromptChange?: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmWithImpactModal: React.FC<ConfirmWithImpactModalProps> = ({
  title,
  description,
  impacts,
  confirmLabel = 'Confirm',
  isDestructive = false,
  isLoading = false,
  promptLabel,
  promptPlaceholder,
  promptValue = '',
  promptRequired = false,
  onPromptChange,
  onConfirm,
  onCancel
}) => {
  const confirmDisabled = isLoading || (promptRequired && promptValue.trim().length === 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div style={{ background: 'white', borderRadius: '12px', maxWidth: '500px', width: '100%', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
        
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ background: isDestructive ? '#FEF2F2' : '#FFF7ED', borderRadius: '50%', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertTriangle size={18} color={isDestructive ? '#DC2626' : '#EA580C'} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{title}</h3>
          </div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          <p style={{ margin: '0 0 1rem', color: '#4B5563', fontSize: '0.95rem', lineHeight: 1.5 }}>{description}</p>

          {impacts.length > 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '1rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: '0.85rem', color: '#92400E' }}>Impact Summary</p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#78350F', fontSize: '0.875rem', lineHeight: 1.7 }}>
                {impacts.map((impact, idx) => (
                  <li key={idx}>{impact}</li>
                ))}
              </ul>
            </div>
          )}

          {promptLabel && onPromptChange && (
            <label style={{ display: 'grid', gap: '0.45rem', marginTop: '1rem', color: '#111827', fontWeight: 600, fontSize: '0.92rem' }}>
              {promptLabel}
              <textarea
                value={promptValue}
                onChange={(event) => onPromptChange(event.target.value)}
                placeholder={promptPlaceholder}
                rows={3}
                style={{
                  width: '100%',
                  borderRadius: '8px',
                  border: '1px solid #D1D5DB',
                  padding: '0.75rem 0.85rem',
                  fontSize: '0.92rem',
                  resize: 'vertical',
                  minHeight: '90px',
                }}
              />
            </label>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button 
            onClick={onCancel}
            style={{ padding: '0.5rem 1rem', border: '1px solid #D1D5DB', borderRadius: '6px', background: 'white', fontWeight: 500, cursor: 'pointer', color: '#374151' }}
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{ 
              padding: '0.5rem 1rem', 
              border: 'none', 
              borderRadius: '6px', 
              background: isDestructive ? '#DC2626' : '#2563EB', 
              color: 'white', 
              fontWeight: 500, 
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
              opacity: confirmDisabled ? 0.7 : 1
            }}
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
