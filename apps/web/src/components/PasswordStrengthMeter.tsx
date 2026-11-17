import React from 'react';
import { Check, X } from 'lucide-react';
import type { PasswordStrengthResult } from '../lib/passwordStrength';

export interface PasswordStrengthMeterProps {
  result: PasswordStrengthResult;
  showRules?: boolean;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({
  result,
  showRules = true,
}) => {
  const { strength, score, rules } = result;

  // Colors & percentage mappings
  const getProgressStyles = () => {
    switch (strength) {
      case 'strong':
        return {
          percent: 100,
          color: '#10b981', // green / success
          label: 'Strong',
          badgeClass: 'badge-success',
        };
      case 'fair':
        return {
          percent: 66,
          color: '#f59e0b', // amber / warning
          label: 'Fair',
          badgeClass: 'badge-warning',
        };
      case 'weak':
      default:
        return {
          percent: score > 0 ? 33 : 10,
          color: '#ef4444', // red / destructive
          label: 'Weak',
          badgeClass: 'badge-error',
        };
    }
  };

  const current = getProgressStyles();

  return (
    <div className="password-strength-container" style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
      {/* Strength Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.35rem',
          fontSize: '0.8125rem',
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>Password Strength:</span>
        <span
          style={{
            fontWeight: 600,
            color: current.color,
            textTransform: 'capitalize',
          }}
        >
          {current.label}
        </span>
      </div>

      {/* Segmented / Progress Bar */}
      <div
        style={{
          height: '6px',
          width: '100%',
          backgroundColor: 'var(--border-color, rgba(255, 255, 255, 0.1))',
          borderRadius: '999px',
          overflow: 'hidden',
          marginBottom: showRules ? '0.75rem' : '0.25rem',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${current.percent}%`,
            backgroundColor: current.color,
            transition: 'width 0.3s ease, background-color 0.3s ease',
            borderRadius: '999px',
          }}
        />
      </div>

      {/* Rules Checklist */}
      {showRules && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3rem',
            fontSize: '0.8rem',
          }}
        >
          {rules.map((rule) => (
            <li
              key={rule.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: rule.met ? 'var(--text-main, #fff)' : 'var(--text-muted, #9ca3af)',
                transition: 'color 0.2s ease',
              }}
            >
              {rule.met ? (
                <Check size={14} color="#10b981" style={{ flexShrink: 0 }} />
              ) : (
                <X size={14} color="var(--text-muted, #9ca3af)" style={{ flexShrink: 0 }} />
              )}
              <span
                style={{
                  textDecoration: rule.met ? 'none' : 'none',
                  opacity: rule.met ? 1 : 0.85,
                }}
              >
                {rule.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
