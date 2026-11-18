import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  UploadCloud,
  FileText,
  CheckCircle,
  ArrowRight,
  Loader2,
  AlertCircle,
  UserCircle2,
  Award,
  Trophy,
  TrendingUp,
  Flame,
  Lock,
} from 'lucide-react';
import { uploadResume, getLatestResume, getSessions } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { ResumeData } from '../../types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { deriveAchievements } from './achievements';
import type { HistorySession } from '../../types';

function getBadgeIcon(id: string) {
  switch (id) {
    case 'first-interview':
      return <Award size={22} />;
    case 'five-interviews':
      return <Trophy size={22} />;
    case 'improved-score':
      return <TrendingUp size={22} />;
    case 'consistency-streak':
      return <Flame size={22} />;
    default:
      return <Award size={22} />;
  }
}

/** Tinted square behind a badge icon; locked badges are neutral. */
function getBadgeIconClass(id: string, unlocked: boolean): string {
  if (!unlocked) return 'bg-secondary text-muted-foreground';
  switch (id) {
    case 'five-interviews':
    case 'consistency-streak':
      return 'bg-warning/15 text-warning';
    case 'improved-score':
      return 'bg-success/15 text-success';
    default:
      return 'bg-primary/10 text-primary';
  }
}

export const Dashboard: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [hasProfile, setHasProfile] = useState(false);
  const [latestResume, setLatestResume] = useState<ResumeData | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { user } = useAuth();
  const firstName = user?.name ? user.name.split(' ')[0] : 'Candidate';

  useEffect(() => {
    // Check if the user already has a profile
    getLatestResume().then(res => {
      if (res.success && res.data) {
        setHasProfile(true);
        setLatestResume(res.data);
      }
    }).catch(() => {
      // Ignore 404s, it just means they don't have a profile yet
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    getSessions()
      .then((res) => {
        if (!cancelled) {
          setSessions(res.data ?? []);
          setSessionsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSessionsError('Unable to load achievements at this time.');
          setSessionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const achievements = useMemo(() => deriveAchievements(sessions), [sessions]);

  const handleFiles = (files: FileList) => {
    const selectedFile = files[0];
    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file.');
      setFile(null);
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File is too large. Maximum size is 5MB.');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setError('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError('');
    setStatus('Analyzing resume...');

    try {
      const response = await uploadResume(file);
      
      if (response.success && response.data) {
        setLatestResume(response.data);
        setStatus(response.data.source === 'heuristic' ? 'Analysis complete (basic parse)!' : 'Analysis complete!');
        setHasProfile(true);
        setTimeout(() => {
          navigate('/profile');
        }, 1000);
      } else if (response.success) {
        setStatus('Analysis complete!');
        setHasProfile(true);
        setTimeout(() => {
          navigate('/profile');
        }, 1000);
      } else {
        setError(response.message || 'Failed to process resume');
        setStatus('');
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred during processing');
      setStatus('');
      setLoading(false);
    }
  };

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="mx-auto max-w-5xl px-6 pt-28 pb-20">
      <div className="mb-14 text-center">
        <h1 className="mb-3 font-display text-4xl font-bold tracking-tight text-foreground">Good to see you, {firstName} 👋</h1>
        <p className="text-xl text-muted-foreground">Build your AI-powered interview profile.</p>
      </div>

      <Card className="mx-auto max-w-[750px]">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Upload resume</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={hasProfile ? 'success' : 'pending'}>{hasProfile ? 'On file' : 'Not uploaded'}</Badge>
              {hasProfile && latestResume?.source && (
                <Badge variant={latestResume.source === 'ai' ? 'default' : 'secondary'}>
                  {latestResume.source === 'ai' ? 'AI' : 'Basic parse'}
                </Badge>
              )}
            </div>
          </div>
          <CardDescription>A PDF up to 5 MB. The interviewer uses it to tailor your questions.</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {error && (
            <Alert variant="error">
              <AlertCircle />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}

          {hasProfile && latestResume?.source === 'heuristic' && (
            <Alert variant="warning">
              <AlertCircle />
              <AlertTitle>AI analysis unavailable</AlertTitle>
              <AlertDescription>
                Your resume was parsed using our fallback parser because AI analysis was unavailable. You can review and verify your details in your profile.
              </AlertDescription>
            </Alert>
          )}

          {status && (
            <Alert>
              <Loader2 className="motion-safe:animate-spin" />
              <AlertTitle>Reading your resume</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="application/pdf"
            className="hidden"
            disabled={loading}
            aria-label="Upload PDF resume"
          />

          <div
            role="button"
            tabIndex={loading ? -1 : 0}
            aria-label="Choose a PDF resume"
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center transition-colors outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              (file || isDragging) && 'border-primary',
              isDragging && 'bg-primary/5',
              loading && 'cursor-not-allowed opacity-60',
            )}
            onClick={() => !loading && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !loading) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <>
                <FileText className="mb-2 size-10 text-primary" />
                <div className="font-medium text-foreground">{file.name}</div>
                <div className="text-sm text-muted-foreground">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to analyze</div>
              </>
            ) : (
              <>
                <UploadCloud className="mb-2 size-10 text-muted-foreground" />
                <div className="font-medium text-foreground">Drag & drop your PDF here</div>
                <div className="text-sm text-muted-foreground">or click to browse from your device</div>
              </>
            )}
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button onClick={handleUpload} disabled={!file} loading={loading}>
            {loading ? 'Analyzing…' : <>Analyze resume <ArrowRight /></>}
          </Button>
        </CardFooter>
      </Card>

      <Card className="mx-auto mt-8 max-w-[750px]">
        <CardHeader>
          <CardTitle>Practice interview</CardTitle>
          <CardDescription>Pick a role and talk it through with the AI interviewer.</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <Button onClick={() => navigate('/new-interview')}>
            Start interview <ArrowRight />
          </Button>
        </CardFooter>
      </Card>

      <Card className="mx-auto mt-8 max-w-[750px]" data-testid="achievements-section">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Award className="size-5 text-primary" />
              Achievements
            </CardTitle>
            {!sessionsLoading && !sessionsError && (
              <Badge variant="secondary" data-testid="achievements-unlocked-count">
                {unlockedCount} of {achievements.length} Unlocked
              </Badge>
            )}
          </div>
          <CardDescription>Milestones and streaks earned from your mock interviews.</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {sessionsLoading && (
            <Alert className="justify-center">
              <Loader2 className="motion-safe:animate-spin" />
              <AlertTitle>Loading achievements…</AlertTitle>
            </Alert>
          )}

          {sessionsError && (
            <Alert variant="error">
              <AlertCircle />
              <AlertTitle>{sessionsError}</AlertTitle>
            </Alert>
          )}

          {!sessionsLoading && !sessionsError && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {achievements.map((badge) => (
                  <div
                    key={badge.id}
                    data-testid={`achievement-badge-${badge.id}`}
                    data-unlocked={badge.unlocked}
                    className={cn(
                      'flex items-start gap-4 rounded-xl border bg-card p-5',
                      !badge.unlocked && 'border-dashed opacity-65',
                    )}
                  >
                    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-md', getBadgeIconClass(badge.id, badge.unlocked))}>
                      {getBadgeIcon(badge.id)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <h3 className={cn('text-sm font-semibold', badge.unlocked ? 'text-foreground' : 'text-muted-foreground')}>
                          {badge.title}
                        </h3>
                        {badge.unlocked ? (
                          <Badge variant="success" data-testid="badge-status-unlocked">
                            <CheckCircle /> Unlocked
                          </Badge>
                        ) : (
                          <Badge variant="secondary" data-testid="badge-status-locked">
                            <Lock /> Locked
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{badge.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              {sessions.filter((s) => s.status === 'ENDED').length === 0 && (
                <p className="text-center text-sm text-muted-foreground">
                  Complete your first mock interview to start unlocking badges!
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="mx-auto mt-10 grid max-w-[750px] gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-md', hasProfile ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')}>
              {hasProfile ? <CheckCircle className="size-6" /> : <AlertCircle className="size-6" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground">Profile Status</h3>
              <p className="font-medium text-foreground">
                {hasProfile
                  ? latestResume?.source === 'heuristic'
                    ? 'Analyzed (Basic Parse)'
                    : latestResume?.source === 'ai'
                    ? 'Analyzed with AI'
                    : 'Analyzed & Ready'
                  : 'Awaiting Resume'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4">
            <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-md', hasProfile ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground')}>
              <UserCircle2 className="size-6" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-muted-foreground">Candidate Profile</h3>
              {hasProfile ? (
                <Button variant="ghost" size="sm" className="-ml-3" onClick={() => navigate('/profile')}>
                  View Profile <ArrowRight />
                </Button>
              ) : (
                <p className="text-muted-foreground">Not generated yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
