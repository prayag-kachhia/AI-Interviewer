import React, { useEffect, useId, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, Mic, PencilLine } from 'lucide-react';
import { RoleList, ROLES, type InterviewMode, type Level, type Role } from '@interview/contracts';
import { createSession, getLatestResume, getRoles } from '../../lib/api';
import { cn } from '@/lib/utils';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MicCheck } from './MicCheck';

const LEVELS: { value: Level; label: string }[] = [
  { value: 'entry', label: 'Entry' },
  { value: 'mid', label: 'Mid' },
  { value: 'senior', label: 'Senior' },
];

const MODES: { value: InterviewMode; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'voice', label: 'Voice', description: 'Talk with the interviewer out loud. Needs a microphone.', icon: <Mic /> },
  { value: 'typed', label: 'Typed', description: 'Read questions and type your answers.', icon: <PencilLine /> },
];

const JOB_CONTEXT_MAX = 4000;

/** The interview length the room enforces (useInterview's TIME_LIMIT_MIN). */
const LENGTH_MIN = 15;

/** A whole-card radio option: the card shows the gold border when its radio is checked. */
function ChoiceCard({ value, title, description, icon }: { value: string; title: string; description?: string; icon?: React.ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      data-slot="choice-card"
      className={cn(
        'relative flex cursor-pointer gap-3 rounded-xl border bg-card p-4 pr-11 transition-colors hover:not-has-[[data-state=checked]]:border-input has-[[data-state=checked]]:border-primary',
        !description && 'items-center py-3', // title-only cards (Level) are short, so centre everything
      )}
    >
      {icon && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span className="grid gap-1">
        <span id={`${id}-title`} className="font-medium">{title}</span>
        {description && <span id={`${id}-desc`} className="text-sm text-muted-foreground">{description}</span>}
      </span>
      <RadioGroupItem
        id={id}
        value={value}
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        className={cn('absolute right-4', description ? 'top-4' : 'top-1/2 -translate-y-1/2')}
      />
    </label>
  );
}

function Section({ title, hint, id, children }: { title: string; hint?: string; id: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 id={id} className="mb-0 font-display text-lg font-medium text-foreground">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export const NewInterview: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [roles, setRoles] = useState<Role[]>(ROLES);

  // `?role=…&focus=…` pre-fills the form (for "Practise this" links); unknown values are ignored.
  const initialRole = ROLES.find((r) => r.id === params.get('role'));
  const [roleId, setRoleId] = useState(initialRole?.id ?? '');
  const [focus, setFocus] = useState(initialRole?.focuses.find((f) => f === params.get('focus')));
  const [company, setCompany] = useState('');
  const [level, setLevel] = useState<Level>();
  const [mode, setMode] = useState<InterviewMode>('voice');
  const [jobContext, setJobContext] = useState('');

  const [resumeName, setResumeName] = useState<string | null>();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getRoles()
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) setRoles(RoleList.parse(res.data));
      })
      .catch(() => {}); // keep the built-in ROLES
    getLatestResume()
      .then((res) => setResumeName(res.success && res.data ? (res.data.fileName ?? 'Resume') : null))
      .catch(() => setResumeName(null));
  }, []);

  const role = roles.find((r) => r.id === roleId);

  const chooseRole = (id: string) => {
    setRoleId(id);
    setFocus(undefined); // a focus belongs to one role
  };

  const handleStart = async () => {
    if (!roleId || starting) return;
    setStarting(true);
    setError('');
    try {
      const res = await createSession({ roleId, focus, company: company.trim() || undefined, level, mode, jobContext: jobContext.trim() || undefined });
      if (res.success && res.data?.id) {
        navigate(`/interview/${res.data.id}`);
        return;
      }
      setError(res.message || 'The interview could not start. Try again.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'The interview could not start. Check your connection and try again.');
    }
    setStarting(false);
  };

  const notSet = <span className="text-muted-foreground">Not set</span>;
  const summary: { term: string; value: React.ReactNode }[] = [
    { term: 'Role', value: role?.label ?? <span className="text-muted-foreground">Pick a role</span> },
    { term: 'Focus', value: focus ?? notSet },
    { term: 'Company', value: company.trim() || notSet },
    { term: 'Job description', value: jobContext.trim() ? 'Added' : notSet },
    { term: 'Level', value: LEVELS.find((l) => l.value === level)?.label ?? notSet },
    { term: 'Answering', value: mode === 'voice' ? 'Voice' : 'Typed' },
    { term: 'Length', value: <span className="font-mono">{LENGTH_MIN} min</span> },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-28 pb-40 sm:px-6 lg:pb-16">
      <h1 className="mb-2 font-display text-3xl font-semibold tracking-tight text-foreground">Set up your interview</h1>
      <p className="mb-10 max-w-[60ch] text-muted-foreground">
        Choose what you want to practise. The interviewer adapts its questions to these choices and your resume.
      </p>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-10">
          <Section title="Role" id="role-heading">
            <RadioGroup aria-labelledby="role-heading" value={roleId} onValueChange={chooseRole} className="grid gap-3 md:grid-cols-3">
              {roles.map((r) => (
                <ChoiceCard key={r.id} value={r.id} title={r.label} description={r.description} />
              ))}
            </RadioGroup>
          </Section>

          {role && (
            <Section title="Focus (optional)" hint="Pick one area to go deeper on, or leave it open." id="focus-heading">
              <div role="group" aria-labelledby="focus-heading" className="flex flex-wrap gap-2">
                {role.focuses.map((f) => (
                  <button
                    key={f}
                    type="button"
                    data-slot="chip"
                    aria-pressed={focus === f}
                    onClick={() => setFocus(focus === f ? undefined : f)}
                    className="h-10 cursor-pointer rounded-md border px-4 text-sm transition-colors outline-none hover:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-pressed:border-primary aria-pressed:text-primary"
                  >
                    {f}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Company and level (optional)" id="details-heading">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="company" className="text-sm text-muted-foreground">Company</label>
                <Input id="company" placeholder="e.g. Atlassian" maxLength={100} value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <span id="level-label" className="text-sm text-muted-foreground">Level</span>
                <RadioGroup aria-labelledby="level-label" value={level ?? ''} onValueChange={(v) => setLevel(v as Level)} className="grid grid-cols-3 gap-2">
                  {LEVELS.map((l) => (
                    <ChoiceCard key={l.value} value={l.value} title={l.label} />
                  ))}
                </RadioGroup>
              </div>
            </div>
          </Section>

          <Section
            title="Target job description (optional)"
            hint="Paste the posting and the interviewer will tailor its technical questions to the role."
            id="job-heading"
          >
            <textarea
              aria-labelledby="job-heading"
              value={jobContext}
              onChange={(e) => setJobContext(e.target.value)}
              maxLength={JOB_CONTEXT_MAX}
              rows={5}
              placeholder="Paste responsibilities and requirements here…"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <p className="text-right text-xs text-muted-foreground">{jobContext.length}/{JOB_CONTEXT_MAX.toLocaleString('en-US')} characters</p>
          </Section>

          <Section title="How you'll answer" id="mode-heading">
            <RadioGroup aria-labelledby="mode-heading" value={mode} onValueChange={(v) => setMode(v as InterviewMode)} className="grid gap-3 md:grid-cols-2">
              {MODES.map((m) => (
                <ChoiceCard key={m.value} value={m.value} title={m.label} description={m.description} icon={m.icon} />
              ))}
            </RadioGroup>
          </Section>

          {mode === 'voice' && <MicCheck />}
        </div>

        <Card className="lg:sticky lg:top-28">
          <CardHeader>
            <CardTitle>Your interview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {summary.map(({ term, value }) => (
                <React.Fragment key={term}>
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-right">{value}</dd>
                </React.Fragment>
              ))}
            </dl>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4 text-sm">
              <span className="text-muted-foreground">Resume</span>
              {resumeName === undefined ? (
                <span className="text-muted-foreground">Checking…</span>
              ) : resumeName ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{resumeName}</span>
                  <Badge variant="success">On file</Badge>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">None yet</span>
                  <Link to="/dashboard" className="text-primary underline-offset-4 hover:underline">Upload one</Link>
                </span>
              )}
            </div>

            {error && (
              <Alert variant="error">
                <AlertCircle />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {/* Pinned to the bottom of the screen on phones, inside the card from lg up. */}
            <div className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-2 border-t bg-background p-4 lg:static lg:border-0 lg:bg-transparent lg:p-0">
              <Button size="lg" className="w-full" onClick={handleStart} disabled={!roleId} loading={starting}>
                {starting ? 'Starting…' : <>Start interview <ArrowRight /></>}
              </Button>
              <p className="text-center text-xs text-muted-foreground">You can end early at any time.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
