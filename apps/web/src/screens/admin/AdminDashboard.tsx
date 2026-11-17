import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Users,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  Loader2,
  RefreshCw,
  Award,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AdminStats } from '@interview/contracts';
import { getAdminStats } from '../../lib/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    setError(null);
    setAccessDenied(false);

    try {
      const res = await getAdminStats();
      if (res.success && res.data) {
        setStats(res.data);
      } else {
        setError('Failed to retrieve platform statistics.');
      }
    } catch (err: any) {
      if (err.response?.status === 404) {
        setAccessDenied(true);
      } else {
        setError(err.response?.data?.message || err.message || 'An unexpected error occurred while loading statistics.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  // 1. Access Denied / 404 State
  if (accessDenied) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 pt-28 text-center" data-testid="admin-access-denied">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-8" aria-hidden />
        </div>
        <h1 className="heading text-2xl font-bold">404 - Not Found / Access Denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You do not have administrative privileges to access the Owner Dashboard. All unauthorized access attempts are restricted.
        </p>
        <Button asChild className="mt-6">
          <Link to="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    );
  }

  // 2. Loading State
  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-4xl flex-col items-center justify-center px-4 pt-28 text-center" data-testid="admin-loading">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
        <p className="mt-3 text-sm text-muted-foreground">Loading platform statistics...</p>
      </div>
    );
  }

  // 3. Error State
  if (error || !stats) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-28" data-testid="admin-error">
        <Alert variant="error" className="mb-6">
          <AlertCircle className="size-5" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error || 'Unable to load statistics.'}</span>
            <Button size="sm" variant="outline" onClick={loadStats}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const total14DayInterviews = stats.interviewsPast14Days.reduce((acc, curr) => acc + curr.count, 0);
  const isEmptyData = stats.totalUsers === 0 && total14DayInterviews === 0 && stats.feedbackCounts.ready === 0 && stats.feedbackCounts.failed === 0;

  // Prepare chart data with friendly date labels
  const chartData = stats.interviewsPast14Days.map((item) => {
    let displayDate = item.date;
    try {
      const parts = item.date.split('-');
      if (parts.length === 3) {
        displayDate = `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
      }
    } catch {
      displayDate = item.date;
    }
    return {
      date: item.date,
      displayDate,
      interviews: item.count,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 pt-28 pb-16" data-testid="admin-dashboard-screen">
      {/* Page Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="heading text-2xl font-bold tracking-tight sm:text-3xl">Owner Dashboard</h1>
            <Badge variant="outline" className="border-primary/30 text-primary">
              <Sparkles className="mr-1 size-3" />
              Platform Admin
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Platform adoption, interview volume trends, and AI evaluation metrics.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats} className="self-start sm:self-auto" data-testid="btn-refresh-stats">
          <RefreshCw className="mr-1.5 size-4" />
          Refresh
        </Button>
      </div>

      {/* Empty Data Banner (if platform has no data yet) */}
      {isEmptyData && (
        <Card className="mb-8 text-center" data-testid="admin-empty">
          <CardContent className="py-8">
            <p className="text-muted-foreground">No candidate accounts or interview sessions have been recorded on the platform yet.</p>
          </CardContent>
        </Card>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Users */}
        <Card data-testid="card-total-users">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="size-4" aria-hidden />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-users">
              {stats.totalUsers.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Registered candidate profiles</p>
          </CardContent>
        </Card>

        {/* Card 2: 14-Day Interviews */}
        <Card data-testid="card-14d-interviews">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">14-Day Activity</CardTitle>
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Calendar className="size-4" aria-hidden />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-interviews-14d">
              {total14DayInterviews.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Interviews in past 14 days</p>
          </CardContent>
        </Card>

        {/* Card 3: Feedback Ready */}
        <Card data-testid="card-feedback-ready">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Feedback Delivered</CardTitle>
            <div className="flex size-9 items-center justify-center rounded-lg bg-success/15 text-success">
              <CheckCircle2 className="size-4" aria-hidden />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success" data-testid="stat-feedback-ready">
              {stats.feedbackCounts.ready.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Successfully evaluated</p>
          </CardContent>
        </Card>

        {/* Card 4: Feedback Failed */}
        <Card data-testid="card-feedback-failed">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Feedback Failed</CardTitle>
            <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
              <AlertCircle className="size-4" aria-hidden />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive" data-testid="stat-feedback-failed">
              {stats.feedbackCounts.failed.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Evaluation failures</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart Section: 14-Day Daily Interview Trend */}
      <Card className="mt-8" data-testid="card-chart-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" aria-hidden />
            <CardTitle>Daily Interview Volume (Past 14 Days)</CardTitle>
          </div>
          <CardDescription>Number of mock interview sessions initiated each day (UTC calendar dates).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full min-w-0" data-testid="interview-trend-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                <XAxis dataKey="displayDate" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-border bg-popover p-2 text-xs shadow-md">
                          <p className="font-semibold text-popover-foreground">{data.date}</p>
                          <p className="text-primary">{data.interviews} interviews</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="interviews" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Accessible Table for Screen Readers & Automated Testing */}
          <div className="sr-only">
            <table data-testid="interview-trends-table">
              <caption>Daily interview count for the past 14 days</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Interviews</th>
                </tr>
              </thead>
              <tbody>
                {stats.interviewsPast14Days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Role Breakdown: Average Interview Score by Role */}
      <Card className="mt-8" data-testid="card-roles-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Award className="size-5 text-primary" aria-hidden />
            <CardTitle>Average Score by Role</CardTitle>
          </div>
          <CardDescription>Overall performance scores averaged from ready evaluations across candidate roles.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.averageScoresByRole.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles registered.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {stats.averageScoresByRole.map((roleItem) => {
                const hasScore = roleItem.averageScore !== null;
                const scorePercent = hasScore ? (roleItem.averageScore! / 5) * 100 : 0;

                return (
                  <div
                    key={roleItem.role}
                    data-testid={`role-card-${roleItem.role}`}
                    className="flex flex-col justify-between rounded-lg border border-border bg-secondary/30 p-4 transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{roleItem.roleLabel}</span>
                        <Badge variant="outline" className="text-xs">
                          {roleItem.role}
                        </Badge>
                      </div>

                      <div className="mt-4 flex items-baseline justify-between">
                        <span className="text-xs text-muted-foreground">Average Score</span>
                        <span
                          className="text-xl font-bold tracking-tight text-foreground"
                          data-testid={`role-score-${roleItem.role}`}
                        >
                          {hasScore ? `${roleItem.averageScore?.toFixed(1)} / 5.0` : '—'}
                        </span>
                      </div>

                      <div className="mt-2">
                        <Progress value={scorePercent} className="h-1.5" />
                      </div>
                    </div>

                    <div className="mt-4 border-t border-border pt-3 text-right">
                      <span className="text-xs text-muted-foreground" data-testid={`role-count-${roleItem.role}`}>
                        {roleItem.sessionCount} {roleItem.sessionCount === 1 ? 'scored session' : 'scored sessions'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
