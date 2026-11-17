import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { exportMyData, getLatestResume } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { ResumeData } from '../../types';
import {
  Mail, Phone, Briefcase, GraduationCap,
  FolderGit2, Code2, Award, Languages, Loader2, ArrowLeft,
  Trash2, ShieldAlert, AlertTriangle, AlertCircle, Download, FileText,
  type LucideIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const Section: React.FC<{ icon: LucideIcon; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <section>
    <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-base font-semibold">
      <Icon className="size-5 text-primary" /> {title}
    </h3>
    {children}
  </section>
);

const Tags: React.FC<{ items?: string[]; empty: string }> = ({ items, empty }) =>
  items && items.length > 0 ? (
    <div className="flex flex-wrap gap-2">
      {items.map((item, idx) => <Badge key={idx} variant="secondary">{item}</Badge>)}
    </div>
  ) : (
    <p className="text-sm text-muted-foreground italic">{empty}</p>
  );

const Entries: React.FC<{ items?: string[]; empty: string }> = ({ items, empty }) =>
  items && items.length > 0 ? (
    <ul className="divide-y divide-border">
      {items.map((item, idx) => <li key={idx} className="py-2 text-sm first:pt-0 last:pb-0">{item}</li>)}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground italic">{empty}</p>
  );

export const Profile: React.FC = () => {
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  
  // Account deletion states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await getLatestResume();
        if (response.success && response.data) {
          setResumeData(response.data);
        } else {
          setError(response.message || 'Failed to load profile');
        }
      } catch (err: any) {
        if (err.response?.status === 404) {
          setError("You haven't uploaded a resume yet.");
        } else {
          setError(err.response?.data?.message || 'Error fetching profile');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleExportData = async () => {
    setExporting(true);
    setExportError('');

    try {
      const blob = await exportMyData();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = 'my-data-export.json';
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      let message = 'Failed to download your data. Please try again.';

      if (err.response?.data instanceof Blob) {
        try {
          const errorData = JSON.parse(await err.response.data.text());
          message = errorData.message || message;
        } catch {
          // Keep the default error message.
        }
      } else {
        message = err.response?.data?.message || message;
      }

      setExportError(message);
    } finally {
      setExporting(false);
    }
  };
  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await deleteAccount();
      if (res.success) {
        navigate('/login', {
          state: {
            message: 'Your account and all associated resumes have been permanently deleted.',
            mode: 'signin',
          },
        });
      } else {
        setDeleteError(res.message || 'Failed to delete account');
        setDeleting(false);
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account');
      setDeleting(false);
    }
  };

  const dangerZone = (
    <Card className="mt-10 border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-xl">
          <ShieldAlert className="size-6 text-destructive" /> Account Management & Data Privacy
        </CardTitle>
        <CardDescription>
          <strong>Data Retention Guarantee:</strong> Logging out never deletes your resumes or candidate profile. Your data remains completely safe in the database.
          However, if you wish to permanently remove yourself and all uploaded data, you may delete your account below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border p-5">
          <div>
            <div className="font-semibold">Download Your Personal Data</div>
            <div className="text-sm text-muted-foreground">
              Get a JSON copy of your profile, resumes, interview sessions, turns and feedback.
            </div>
          </div>
          <Button type="button" variant="outline" onClick={handleExportData} loading={exporting}>
            {exporting ? 'Preparing...' : <><Download /> Download my data</>}
          </Button>
        </div>

        {exportError && (
          <Alert variant="error">
            <AlertTriangle />
            <AlertDescription>{exportError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-destructive/30 bg-destructive/10 p-5">
          <div>
            <div className="font-semibold">Delete Account and All Associated Data</div>
            <div className="text-sm text-muted-foreground">
              Permanently removes your user account ({user?.email}) and all uploaded resumes.
            </div>
          </div>
          <Button type="button" variant="destructive" onClick={() => setShowDeleteModal(true)}>
            <Trash2 /> Delete Account
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const deleteDialog = (
    <AlertDialog open={showDeleteModal} onOpenChange={(open) => !deleting && setShowDeleteModal(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3">
            <AlertTriangle className="size-6 text-destructive" /> Confirm Account Deletion
          </AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete your account? This action is <strong className="text-destructive">irreversible</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-border bg-background p-4 text-sm">
          <p className="mb-2 font-semibold">The following will be permanently erased:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>User account ({user?.email})</li>
            <li>All uploaded PDF resumes</li>
            <li>AI-generated candidate profile and skills history</li>
          </ul>
        </div>

        {deleteError && (
          <Alert variant="error">
            <AlertTriangle />
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            loading={deleting}
            onClick={(e) => {
              // Keep the dialog open so a failed delete can show its error.
              e.preventDefault();
              handleDeleteAccount();
            }}
          >
            {deleting ? 'Deleting...' : <><Trash2 /> Yes, Delete Everything</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (loading) {
    return (
      <div className="mx-auto flex h-[60vh] max-w-5xl flex-col items-center justify-center gap-4 px-6 pt-28" role="status">
        <Loader2 className="size-12 text-primary motion-safe:animate-spin" />
        <p className="text-lg font-medium">Loading your candidate profile...</p>
      </div>
    );
  }

  if (error || !resumeData) {
    return (
      <div className="mx-auto max-w-5xl px-6 pt-28 pb-20">
        <div className="mx-auto max-w-xl">
          <Card className="text-center">
            <CardHeader>
              <CardTitle className="text-2xl">No Profile Found</CardTitle>
              <CardDescription>
                {error === "You haven't uploaded a resume yet." ? error : 'We could not find a candidate profile for your account.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate('/dashboard')}>Go to Dashboard to Upload</Button>
            </CardContent>
          </Card>
          {dangerZone}
        </div>
        {deleteDialog}
      </div>
    );
  }

  const { profile, fileName, createdAt } = resumeData;
  const displayName = profile.name || user?.name || 'Candidate Profile';
  const email = profile.email || user?.email;

  return (
    <div className="mx-auto max-w-5xl px-6 pt-28 pb-20">
      <Button variant="outline" className="mb-8" onClick={() => navigate('/dashboard')}>
        <ArrowLeft /> Back to Dashboard
      </Button>

      <Card className="p-8 md:p-12">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-8">
          <div className="flex items-center gap-4">
            <Avatar size="lg" className="size-16">
              <AvatarFallback className="text-xl">{initials(displayName)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h1 className="font-display text-3xl font-bold tracking-tight">{displayName}</h1>
                {resumeData.source && (
                  <Badge variant={resumeData.source === 'ai' ? 'default' : 'secondary'}>
                    {resumeData.source === 'ai' ? 'AI' : 'Basic parse'}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                {email && <div className="flex items-center gap-2"><Mail className="size-4" /> {email}</div>}
                {profile.phone && <div className="flex items-center gap-2"><Phone className="size-4" /> {profile.phone}</div>}
              </div>
            </div>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground md:text-right">
            <div className="font-medium">Source Resume</div>
            <div className="text-foreground">{fileName}</div>
            <div>Analyzed: {new Date(createdAt).toLocaleDateString()}</div>
            {resumeData.source && <div>Analysis: {resumeData.source === 'ai' ? 'AI' : 'Basic parser'}</div>}
          </div>
        </div>

        {resumeData.source === 'heuristic' && (
          <Alert variant="warning">
            <AlertCircle />
            <AlertTitle>AI analysis unavailable</AlertTitle>
            <AlertDescription>
              AI analysis was unavailable for your resume, so a basic heuristic parse was used. You may want to ensure your details are complete.
            </AlertDescription>
          </Alert>
        )}

        <Section icon={FileText} title="Professional Summary">
          {profile.summary ? (
            <p className="leading-relaxed">{profile.summary}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">No professional summary extracted.</p>
          )}
        </Section>

        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-8">
            <Section icon={Code2} title="Skills"><Tags items={profile.skills} empty="No skills listed" /></Section>
            <Section icon={Briefcase} title="Experience"><Entries items={profile.experience} empty="No experience listed" /></Section>
            <Section icon={Languages} title="Languages"><Tags items={profile.languages} empty="No languages listed" /></Section>
          </div>
          <div className="flex flex-col gap-8">
            <Section icon={GraduationCap} title="Education"><Entries items={profile.education} empty="No education listed" /></Section>
            <Section icon={FolderGit2} title="Projects"><Entries items={profile.projects} empty="No projects listed" /></Section>
            {(profile.certifications?.length > 0 || profile.achievements?.length > 0) && (
              <Section icon={Award} title="Certifications & Achievements">
                <ul className="divide-y divide-border">
                  {profile.certifications?.map((cert, idx) => (
                    <li key={`cert-${idx}`} className="py-2 text-sm first:pt-0 last:pb-0">
                      {cert}<div className="text-xs text-muted-foreground">Certification</div>
                    </li>
                  ))}
                  {profile.achievements?.map((ach, idx) => (
                    <li key={`ach-${idx}`} className="py-2 text-sm first:pt-0 last:pb-0">
                      {ach}<div className="text-xs text-muted-foreground">Achievement</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        </div>
      </Card>

      {dangerZone}
      {deleteDialog}
    </div>
  );
};
