import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, PhoneOff } from 'lucide-react';
import { END_REASONS, type EndReason } from '@interview/contracts';
import { formatClock } from './useInterview';

interface EndConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason?: EndReason) => void;
  remainingSeconds: number;
}

export const EndConfirmationDialog: React.FC<EndConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  remainingSeconds,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedReason, setSelectedReason] = useState<EndReason | ''>('');

  useEffect(() => {
    if (isOpen) {
      setSelectedReason('');
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="card end-dialog"
      aria-labelledby="end-dialog-title"
      aria-describedby="end-dialog-desc"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      {isOpen && (
        <>
          <div className="end-dialog-header">
            <div className="stat-icon warning">
              <AlertTriangle size={22} />
            </div>
            <div>
              <h3 id="end-dialog-title" style={{ margin: 0 }}>
                End Interview Early?
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                Time remaining: <strong>{formatClock(remainingSeconds)}</strong>
              </p>
            </div>
          </div>

          <p id="end-dialog-desc" style={{ margin: '1rem 0' }}>
            Are you sure you want to end this interview? Your recorded transcript will be submitted
            immediately for feedback evaluation, and you cannot resume once ended.
          </p>

          <div className="end-reason-selection" style={{ margin: '1rem 0' }}>
            <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              Why are you ending early? (Optional)
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {END_REASONS.map(({ id, label }) => (
                <label
                  key={id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="radio"
                    name="earlyEndReason"
                    value={id}
                    checked={selectedReason === id}
                    onChange={() => setSelectedReason(id)}
                  />
                  <span>{label}</span>
                </label>
              ))}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: 'var(--text-muted)',
                }}
              >
                <input
                  type="radio"
                  name="earlyEndReason"
                  value=""
                  checked={selectedReason === ''}
                  onChange={() => setSelectedReason('')}
                />
                <span>Decline to give a reason / Prefer not to say</span>
              </label>
            </div>
          </div>

          <div className="end-dialog-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Continue Interview
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => onConfirm(selectedReason ? selectedReason : undefined)}
            >
              <PhoneOff size={16} />
              Yes, End Interview
            </button>
          </div>
        </>
      )}
    </dialog>
  );
};
