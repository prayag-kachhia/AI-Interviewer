import React from 'react';
import { Radio, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface TypedAnswerBoxProps {
  show: boolean;
  onToggleShow: () => void;
  value: string;
  onChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
  savingTurn: boolean;
}

export const TypedAnswerBox: React.FC<TypedAnswerBoxProps> = ({
  show,
  onToggleShow,
  value,
  onChange,
  onSubmit,
  disabled,
  savingTurn,
}) => {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <button
        type="button"
        onClick={onToggleShow}
        className="typed-answer-toggle"
      >
        <Radio size={14} />
        <span>
          {show
            ? 'Hide microphone accessibility fallback'
            : 'Microphone unavailable? Use spoken-turn accessibility fallback'}
        </span>
        {show ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {show && (
        <form onSubmit={onSubmit} className="card typed-answer-form">
          <input
            type="text"
            className="form-input"
            placeholder="Speak via accessibility fallback if hardware microphone STT is unavailable..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            style={{ flexGrow: 1 }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!value.trim() || disabled}
            style={{ whiteSpace: 'nowrap', padding: '0.7rem 1.2rem' }}
          >
            {savingTurn ? (
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              'Submit Spoken Turn'
            )}
          </button>
        </form>
      )}
    </div>
  );
};
