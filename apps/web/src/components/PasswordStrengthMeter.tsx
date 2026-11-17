import React from 'react';
import { Check, X } from 'lucide-react';
import type { PasswordStrengthResult } from '../lib/passwordStrength';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export interface PasswordStrengthMeterProps {
  result: PasswordStrengthResult;
  showRules?: boolean;
}

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({ result, showRules = true }) => {
  const { strength, score, rules } = result;

  const current =
    strength === 'strong'
      ? { percent: 100, label: 'Strong', text: 'text-success', bar: '[&>div]:bg-success' }
      : strength === 'fair'
        ? { percent: 66, label: 'Fair', text: 'text-warning', bar: '[&>div]:bg-warning' }
        : { percent: score > 0 ? 33 : 10, label: 'Weak', text: 'text-destructive', bar: '[&>div]:bg-destructive' };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Password Strength:</span>
        <span className={cn('font-semibold', current.text)}>{current.label}</span>
      </div>

      <Progress value={current.percent} aria-label="Password strength" className={cn('h-1.5', current.bar)} />

      {showRules && (
        <ul className="flex flex-col gap-1 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className={cn('flex items-center gap-2', rule.met ? 'text-foreground' : 'text-muted-foreground')}>
              {rule.met ? <Check className="size-4 shrink-0 text-success" aria-hidden /> : <X className="size-4 shrink-0" aria-hidden />}
              <span>{rule.label}</span>
              <span className="sr-only">{rule.met ? '(met)' : '(not met)'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
