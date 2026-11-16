import React from 'react';
import { Link, Navigate } from 'react-router';
import { BrainCircuit, ClipboardList, Compass, Mic } from 'lucide-react';
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

export const Landing: React.FC = () => {
  const { user, loading } = useAuth();

  // Wait for the session check so a signed-in user never sees the landing page flash.
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <main className="container mx-auto max-w-5xl px-4 py-16 flex flex-col gap-16">
      <section className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-2 text-primary font-medium">
          <BrainCircuit className="size-6" />
          <span>AI Interviewer</span>
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-foreground">
          Practice interviews out loud, before the real one
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl">
          Hold a mock interview with an AI interviewer, then see exactly where to improve.
        </p>
        <Button asChild size="lg">
          <Link to="/login">Get started</Link>
        </Button>
      </section>

      <section className="grid gap-6 md:grid-cols-3" aria-label="Features">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardHeader className="gap-3">
              <div className="w-fit rounded-full bg-secondary p-3 text-primary">
                <Icon className="size-6" />
              </div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="flex flex-col items-center gap-4 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Ready for your first interview?</h2>
        <Button asChild variant="outline" size="lg">
          <Link to="/login">Sign up or sign in</Link>
        </Button>
      </section>
    </main>
  );
};
