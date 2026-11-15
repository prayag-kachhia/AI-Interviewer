import React, { useEffect, useRef } from 'react';
import { AlertTriangle, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatClock } from './useInterview';

interface EndConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  remainingSeconds: number;
}

export const EndConfirmationDialog: React.FC<EndConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  remainingSeconds,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

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
      className="m-auto max-w-md w-[calc(100%-2rem)] p-6 rounded-xl border border-border bg-card text-card-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs outline-none"
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
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3.5">
            <div className="size-10 rounded-full bg-warning/15 text-warning flex items-center justify-center shrink-0">
              <AlertTriangle className="size-5" />
            </div>
            <div>
              <h3 id="end-dialog-title" className="font-display text-lg font-semibold text-foreground m-0">
                End Interview Early?
              </h3>
              <p className="text-xs text-muted-foreground m-0">
                Time remaining: <strong className="font-mono text-foreground">{formatClock(remainingSeconds)}</strong>
              </p>
            </div>
          </div>

          <p id="end-dialog-desc" className="text-sm text-muted-foreground leading-relaxed m-0">
            Are you sure you want to end this interview? Your recorded transcript will be submitted
            immediately for feedback evaluation, and you cannot resume once ended.
          </p>

          <div className="flex justify-end items-center gap-2.5 mt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Continue Interview
            </Button>
            <Button type="button" variant="destructive" onClick={onConfirm} className="gap-2">
              <PhoneOff className="size-4" />
              Yes, End Interview
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
};
