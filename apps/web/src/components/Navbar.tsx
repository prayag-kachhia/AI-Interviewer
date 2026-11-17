import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Moon, Sun, SquareTerminal } from 'lucide-react';
import { Logo } from './Logo';
import { useAuth } from '../context/AuthContext';
import { THEMES, useTheme } from '../context/ThemeContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/new-interview', label: 'New interview' },
  { to: '/history', label: 'History' },
  { to: '/guide', label: 'Guide' },
  { to: '/profile', label: 'Profile' },
];

const initials = (nameOrEmail: string) =>
  nameOrEmail.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const themeIndex = THEMES.findIndex((t) => t.id === theme);
  const themeLabel = THEMES[themeIndex]?.label ?? '';
  const nextLabel = THEMES[(themeIndex + 1) % THEMES.length].label;

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login', {
        state: {
          message: 'You have been signed out. All your profile data and resumes remain safely stored in the database.',
          mode: 'signin'
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (
    !user ||
    location.pathname === '/reset-password' ||
    location.pathname === '/verify-email'
  ) {
    return null;
  }

  return (
    // Fixed and 70px tall: pages clear it with pt-28.
    <header className="fixed inset-x-0 top-0 z-50 flex h-[70px] items-center border-b border-border bg-background/90 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-display text-xl font-bold text-foreground no-underline">
          <Logo className="size-7 text-foreground" />
          <span className="hidden sm:inline">AI Interviewer</span>
        </Link>

        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {LINKS.map(({ to, label }) => {
            const active = location.pathname === to;
            return (
              <Button
                key={to}
                asChild
                variant="ghost"
                size="sm"
                className={cn('shrink-0', active ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
              >
                <Link to={to} aria-current={active ? 'page' : undefined}>{label}</Link>
              </Button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={`Theme: ${themeLabel}. Switch to ${nextLabel}`}
            title={`Theme: ${themeLabel}`}
          >
            {theme === 'light' ? <Sun className="size-5" /> : theme === 'dark' ? <Moon className="size-5" /> : <SquareTerminal className="size-5" />}
          </Button>
          <Avatar>
            <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[16ch] truncate text-sm font-medium text-foreground xl:inline">{user.email}</span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </nav>
    </header>
  );
};
