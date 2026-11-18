import React from 'react';
import { ROLES } from '@interview/contracts';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/** What the interviewer does, and the roles it can interview for (read from the shared role list). */
export const Roles: React.FC = () => (
  <section aria-label="What you can practise" className="grid gap-6 lg:grid-cols-12">
    <Card className="gap-5 px-6 sm:px-8 lg:col-span-7">
      <h2 className="heading text-2xl text-card-foreground sm:text-3xl">It listens, then follows up</h2>
      <p className="max-w-xl leading-relaxed text-muted-foreground">
        Questions come from your resume, the role and focus you pick, and any job description you paste. Each follow-up
        builds on what you just said, the way a real interviewer would.
      </p>
      <ul className="mt-auto flex list-disc flex-col gap-3 border-t-(length:--border-w) border-border pt-5 pl-5">
        <li>Speak your answers, or switch to typing at any time.</li>
        <li>End the interview early whenever you need to.</li>
        <li>Keep a history of your interviews and see your scores over time.</li>
      </ul>
    </Card>

    <Card className="gap-5 px-6 sm:px-8 lg:col-span-5">
      <h2 className="heading text-2xl text-card-foreground sm:text-3xl">Roles you can practise</h2>
      <ul className="flex flex-col">
        {ROLES.map((role) => (
          <li key={role.id} className="flex flex-col gap-2 border-border py-4 not-first:border-t-(length:--border-w)">
            <span className="font-medium">{role.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {role.focuses.map((focus) => (
                <Badge key={focus} variant="secondary">
                  {focus}
                </Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  </section>
);
