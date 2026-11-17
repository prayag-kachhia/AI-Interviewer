import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

/*
 * An invented answer, scored against the real Software Engineer rubric (apps/api/src/services/rubrics.ts).
 * It is labelled as an example on the page; nothing here is a real candidate's data.
 */
const QUESTION = 'Walk me through a system you designed. Where would it break first under load?';
const ANSWER =
  "I built a queue-backed worker for feedback jobs. Under a spike the database would go first, so I'd add a read replica and cache the role list.";
const SCORES = [
  { category: 'Problem Solving & Algorithms', score: 4, comment: 'Found the real bottleneck before reaching for a fix.' },
  { category: 'Software Design & Architecture', score: 3, comment: 'Sound plan, but no word on how the queue itself fails.' },
  { category: 'Technical Communication', score: 4, comment: 'Short and in a sensible order.' },
];

export const SampleReport: React.FC = () => (
  <section id="example-report" aria-labelledby="example-report-heading" className="flex scroll-mt-8 flex-col gap-8">
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="example-report-heading" className="heading text-3xl text-foreground sm:text-4xl">
          What your feedback looks like
        </h2>
        <Badge variant="outline">Example</Badge>
      </div>
      <p className="max-w-2xl text-muted-foreground">
        When you end an interview, every answer is scored against the rubric for your role. This one is made up to show
        the format; yours comes from what you actually said.
      </p>
    </div>

    <div className="grid gap-6 lg:grid-cols-5">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card className="gap-2 px-6">
          <span className="label text-xs text-muted-foreground">Interviewer</span>
          <p className="heading text-lg leading-snug text-card-foreground">{QUESTION}</p>
        </Card>
        <Card className="gap-2 px-6">
          <span className="label text-xs text-muted-foreground">You</span>
          <p className="leading-relaxed text-card-foreground">{ANSWER}</p>
        </Card>
      </div>

      <Card className="gap-6 px-6 lg:col-span-3">
        <ul className="flex flex-col gap-5">
          {SCORES.map(({ category, score, comment }) => (
            <li key={category} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{category}</span>
                <span className="font-mono text-sm">{score}/5</span>
              </div>
              <Progress value={score * 20} aria-label={`${category}: ${score} out of 5`} />
              <span className="text-sm text-muted-foreground">{comment}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-4 border-t-(length:--border-w) border-border pt-5 sm:grid-cols-2">
          <div className="flex flex-col items-start gap-2">
            <Badge variant="success">Strength</Badge>
            <p className="text-sm">Named the database as the first limit instead of guessing.</p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <Badge variant="pending">To improve</Badge>
            <p className="text-sm">Say how many requests per second the design handles today.</p>
          </div>
        </div>
      </Card>
    </div>
  </section>
);
