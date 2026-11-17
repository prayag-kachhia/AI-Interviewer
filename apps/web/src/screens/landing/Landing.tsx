import React from 'react';
import { Link, Navigate } from 'react-router';
import { ROLES } from '@interview/contracts';
import { Logo } from '@/components/Logo';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { useAuth } from '../../context/AuthContext';
import { RoomPreview } from './RoomPreview';
import { Roles } from './Roles';
import { SampleReport } from './SampleReport';

/* Matches DEFAULT_TIME_LIMIT_MIN in the interview room; Landing.test.tsx checks they agree. */
export const SESSION_MINUTES = 15;

const STEPS = [
  'Upload your resume and choose a role',
  'Answer the interviewer out loud',
  'Read your feedback and follow the plan',
];

const FACTS = [
  { value: `${SESSION_MINUTES} min`, label: 'per interview' },
  { value: String(ROLES.length), label: 'roles to choose from' },
  { value: 'Voice', label: 'or type if you prefer' },
];

/* Rules take the theme's border width and colour: a hairline in Haute and Graphite, thick ink in Swiss. */
const RULE = 'border-border border-(length:--border-w)';

export const Landing: React.FC = () => {
  const { user, loading } = useAuth();

  // Wait for the session check so a signed-in user never sees the landing page flash.
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="flex min-h-screen flex-col">
      <p className="label border-b-(length:--border-w) border-border bg-secondary px-6 py-2 text-center text-xs text-muted-foreground">
        Spoken mock interviews with written feedback after every session
      </p>

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <span className="flex items-center gap-2 font-display text-xl font-bold">
          <Logo className="size-7 text-foreground" />
          <span className="hidden sm:inline">AI Interviewer</span>
        </span>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 pt-6 pb-20 sm:gap-28">
        <section aria-labelledby="hero-heading" className="grid items-center gap-12 lg:grid-cols-12">
          <div className="flex flex-col gap-8 lg:col-span-7">
            <h1 id="hero-heading" className="heading text-5xl leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
              Practice interviews{' '}
              <span className="inline-block bg-primary px-2 text-primary-foreground">out loud</span>, before the real one
            </h1>
            <p className="max-w-xl border-l-(length:--border-w) border-brand pl-5 text-lg leading-relaxed text-muted-foreground">
              An AI interviewer asks questions built from your resume and the role you pick, follows up on what you say,
              and writes up feedback when you finish.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/login">Start practising</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#example-report">See an example report</a>
              </Button>
            </div>
            <dl className={`grid grid-cols-3 ${RULE} bg-card`}>
              {FACTS.map(({ value, label }) => (
                <div key={label} className="flex flex-col-reverse gap-1 border-border p-4 not-first:border-l-(length:--border-w)">
                  <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
                  <dd className="heading m-0 text-2xl sm:text-3xl">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:col-span-5">
            <RoomPreview />
          </div>
        </section>

        <section aria-labelledby="steps-heading" className="flex flex-col gap-8">
          <h2 id="steps-heading" className="heading text-3xl text-foreground sm:text-4xl">
            How it works
          </h2>
          <ol className={`m-0 grid list-none p-0 md:grid-cols-3 ${RULE} bg-card`}>
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex flex-col gap-4 border-border p-6 not-first:border-t-(length:--border-w) sm:p-8 md:not-first:border-t-0 md:not-first:border-l-(length:--border-w)"
              >
                <span className="heading text-5xl text-brand" aria-hidden>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-lg font-medium text-card-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <Roles />

        <SampleReport />

        <section className="flex flex-col items-start gap-6 bg-primary p-8 text-primary-foreground sm:p-12">
          <h2 className="heading text-3xl text-primary-foreground sm:text-5xl">Ready for your first interview?</h2>
          <Button asChild variant="secondary" size="lg">
            <Link to="/login">Sign up or sign in</Link>
          </Button>
        </section>
      </main>

      <footer className="border-t-(length:--border-w) border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Logo className="size-5 text-foreground" />
            AI Interviewer, a student project for IT314 at DA-IICT.
          </span>
          <Link to="/login" className="text-foreground">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
};
