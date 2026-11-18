import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { Menu, Moon, Sun, SquareTerminal, X } from 'lucide-react';
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

const NavLink: React.FC<{ to: string; label: string; active: boolean; className?: string }> = ({ to, label, active, className }) => (
  <Button
    asChild
    variant="ghost"
    size="sm"
    className={cn('shrink-0', active ? 'bg-secondary text-foreground' : 'text-muted-foreground', className)}
  >
    <Link to={to} aria-current={active ? 'page' : undefined}>{label}</Link>
  </Button>
);

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const themeIndex = THEMES.findIndex((t) => t.id === theme);
  const themeLabel = THEMES[themeIndex]?.label ?? '';
  const nextLabel = THEMES[(themeIndex + 1) % THEMES.length].label;
  // Below lg (or below xl when admin navigation adds an extra link) the links don't fit in a row, so they go in a menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const isDesktopAdmin = Boolean(user?.isAdmin);

  const navLinks = [
    ...LINKS,
    ...(user?.isAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
  ];

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

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
    location.pathname === '/' || // the landing page has its own header
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

        <div className={cn('items-center gap-1', isDesktopAdmin ? 'hidden xl:flex' : 'hidden lg:flex')}>
          {navLinks.map(({ to, label }) => (
            <NavLink key={to} to={to} label={label} active={location.pathname === to} />
          ))}
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
          <Button
            variant="outline"
            size="icon"
            className={isDesktopAdmin ? 'xl:hidden' : 'lg:hidden'}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </nav>

      {menuOpen && (
        <div
          id="mobile-menu"
          role="navigation"
          aria-label="Menu"
          className={cn(
            'absolute inset-x-0 top-full flex flex-col gap-1 border-b border-border bg-background p-3',
            isDesktopAdmin ? 'xl:hidden' : 'lg:hidden'
          )}
        >
          {navLinks.map(({ to, label }) => (
            <NavLink key={to} to={to} label={label} active={location.pathname === to} className="justify-start" />
          ))}
        </div>
      )}
    </header>
  );
};
