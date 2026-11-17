import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type FieldProps = React.ComponentProps<'input'> & {
  id: string;
  label: string;
  /** A lucide icon shown at the left edge of the input. */
  icon: React.ReactNode;
  /** Something small to the right of the label, like "Forgot password?". */
  labelAction?: React.ReactNode;
};

/** A labelled input with an icon. `type="password"` adds a show/hide button. */
export const Field: React.FC<FieldProps> = ({ id, label, icon, labelAction, type, className, ...input }) => {
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">{label}</label>
        {labelAction}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
        <Input id={id} type={isPassword && shown ? 'text' : type} className={cn('pl-9', isPassword && 'pr-11', className)} {...input} />
        {isPassword && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0 -translate-y-1/2"
            onClick={() => setShown(!shown)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            title={shown ? 'Hide password' : 'Show password'}
          >
            {shown ? <EyeOff /> : <Eye />}
          </Button>
        )}
      </div>
    </div>
  );
};
