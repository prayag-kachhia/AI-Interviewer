import React from 'react';
import { Link, Navigate } from 'react-router';
import { ClipboardList, Compass, Mic } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '../../context/AuthContext';

const FEATURES = [
  {
    icon: ClipboardList,
    title: 'Tailored to you',
    description:
      'Upload your resume and pick the role you are preparing for. The questions are built around both.',
  },
  {
    icon: Mic,
    title: 'Spoken mock interview',
    description:
      'Talk through a live interview with an AI interviewer using your voice, or type your answers if you prefer.',
  },
  {
    icon: Compass,
    title: 'Feedback and a plan',
    description:
      'Get written feedback with a score for each category, then follow an improvement guide for the weak spots.',
  },
];

const STEPS = [
  'Upload your resume and choose a role',
  'Answer the interviewer out loud',
  'Read your feedback and follow the plan',
];

/* Rules take the theme's border width and colour: a hairline in dark, thick ink in light. */
const RULE = 'border-border border-(length:--border-w)';

export const Landing: React.FC = () => {
  const { user, loading } = useAuth();

  // Wait for the session check so a signed-in user never sees the landing page flash.
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-12 sm:py-16">
      <section className={`grid lg:grid-cols-12 ${RULE}`}>
        <div className="flex flex-col gap-8 p-6 sm:p-10 lg:col-span-7">
          <div className="label flex items-center gap-2 text-sm font-medium text-brand">
            <Logo className="size-5" />
            <span>AI Interviewer</span>
          </div>
          <h1 className="heading text-5xl leading-[0.95] text-foreground sm:text-6xl lg:text-7xl">
            Practice interviews{' '}
            <span className="inline-block bg-primary px-2 text-primary-foreground">out loud</span>, before the real one
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            Hold a mock interview with an AI interviewer, then see exactly where to improve.
          </p>
          <div>
            <Button asChild size="lg">
              <Link to="/login">Get started</Link>
            </Button>
          </div>
        </div>

        <ol className="flex flex-col border-t-(length:--border-w) border-border bg-card lg:col-span-5 lg:border-t-0 lg:border-l-(length:--border-w)">
          {STEPS.map((step, index) => (
            <li
              key={step}
              className="flex flex-1 items-center gap-5 border-border p-6 not-first:border-t-(length:--border-w) sm:p-8"
            >
              <span className="heading text-4xl text-brand" aria-hidden>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="text-base font-medium text-card-foreground">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 md:grid-cols-3" aria-label="Features">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader className="gap-3">
              <div className={`w-fit bg-secondary p-3 text-brand ${RULE}`}>
                <Icon className="size-6" aria-hidden />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="flex flex-col items-start gap-6 bg-primary p-8 text-primary-foreground sm:p-12">
        <h2 className="heading text-3xl text-primary-foreground sm:text-5xl">Ready for your first interview?</h2>
        <Button asChild variant="secondary" size="lg">
          <Link to="/login">Sign up or sign in</Link>
        </Button>
      </section>
    </main>
  );
};
