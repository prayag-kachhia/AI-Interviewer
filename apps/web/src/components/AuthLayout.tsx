import React from 'react';
import { Link } from 'react-router';
import { Logo } from './Logo';
import { ThemeSwitcher } from './ThemeSwitcher';
import { Card } from '@/components/ui/card';

/** The page around a signed-out account screen: brand and theme switcher on top, one centred card. */
export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen flex-col">
    <header className="flex items-center justify-between gap-4 px-6 py-4">
      <Link to="/" aria-label="AI Interviewer home" className="flex items-center gap-2 font-display text-xl font-bold text-foreground no-underline">
        <Logo className="size-7 text-foreground" />
        <span className="hidden sm:inline">AI Interviewer</span>
      </Link>
      <ThemeSwitcher />
    </header>
    <main className="grid flex-1 place-items-start justify-items-center px-4 pt-6 pb-16 sm:pt-12">
      <Card className="w-full max-w-md gap-5 px-6 py-8 sm:px-8">{children}</Card>
    </main>
  </div>
);

/** The icon, title and one line of explanation at the top of the card. */
export const AuthHeading: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="flex flex-col items-center gap-2 text-center">
    <span className="grid size-12 place-items-center rounded-(--r-pill) bg-secondary text-brand [&>svg]:size-6" aria-hidden>
      {icon}
    </span>
    <h1 className="heading text-2xl">{title}</h1>
    <p className="text-sm text-muted-foreground">{children}</p>
  </div>
);
