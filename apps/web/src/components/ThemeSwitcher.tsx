import React from 'react';
import { Moon, SquareTerminal, Sun } from 'lucide-react';
import { THEMES, useTheme, type Theme } from '../context/ThemeContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun />,
  dark: <Moon />,
  graphite: <SquareTerminal />,
};

/** All three themes at once, for screens without the navbar (the navbar cycles through them instead). */
export const ThemeSwitcher: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-1">
      {THEMES.map(({ id, label }) => (
        <Button
          key={id}
          type="button"
          size="sm"
          variant={theme === id ? 'secondary' : 'ghost'}
          className={cn(theme !== id && 'text-muted-foreground')}
          aria-pressed={theme === id}
          title={`${label} theme`}
          onClick={() => setTheme(id)}
        >
          {ICONS[id]}
          <span className="hidden sm:inline">{label}</span>
        </Button>
      ))}
    </div>
  );
};
