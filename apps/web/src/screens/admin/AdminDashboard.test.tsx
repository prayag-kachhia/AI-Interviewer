import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminDashboard } from './AdminDashboard';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  getAdminStats: vi.fn(),
}));

const mockStats = {
  totalUsers: 128,
  interviewsPast14Days: [
    { date: '2026-11-04', count: 2 },
    { date: '2026-11-05', count: 0 },
    { date: '2026-11-06', count: 5 },
    { date: '2026-11-07', count: 3 },
    { date: '2026-11-08', count: 0 },
    { date: '2026-11-09', count: 8 },
    { date: '2026-11-10', count: 4 },
    { date: '2026-11-11', count: 6 },
    { date: '2026-11-12', count: 1 },
    { date: '2026-11-13', count: 0 },
    { date: '2026-11-14', count: 7 },
    { date: '2026-11-15', count: 4 },
    { date: '2026-11-16', count: 9 },
    { date: '2026-11-17', count: 11 },
  ],
  feedbackCounts: {
    ready: 56,
    failed: 4,
  },
  averageScoresByRole: [
    {
      role: 'backend-developer',
      roleLabel: 'Backend Developer',
      averageScore: 4.3,
      sessionCount: 25,
    },
    {
      role: 'software-engineer',
      roleLabel: 'Software Engineer',
      averageScore: 3.9,
      sessionCount: 20,
    },
    {
      role: 'data-analyst',
      roleLabel: 'Data Analyst',
      averageScore: null,
      sessionCount: 0,
    },
  ],
};

describe('AdminDashboard (Owner Dashboard, FR-32, Issue #201)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially while fetching platform statistics', () => {
    vi.mocked(api.getAdminStats).mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    expect(screen.getByTestId('admin-loading')).toBeInTheDocument();
    expect(screen.getByText(/loading platform statistics/i)).toBeInTheDocument();
  });

  it('renders metric cards, charts, and role breakdowns when API returns 200 with data', async () => {
    vi.mocked(api.getAdminStats).mockResolvedValueOnce({
      success: true,
      data: mockStats,
    });

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-dashboard-screen')).toBeInTheDocument();
    });

    // Header
    expect(screen.getByRole('heading', { name: /owner dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/platform admin/i)).toBeInTheDocument();

    // Metric Cards
    expect(screen.getByTestId('stat-total-users')).toHaveTextContent('128');
    // Sum of 14 days = 2+0+5+3+0+8+4+6+1+0+7+4+9+11 = 60
    expect(screen.getByTestId('stat-total-interviews-14d')).toHaveTextContent('60');
    expect(screen.getByTestId('stat-feedback-ready')).toHaveTextContent('56');
    expect(screen.getByTestId('stat-feedback-failed')).toHaveTextContent('4');

    // Chart & Table
    expect(screen.getByTestId('interview-trends-table')).toBeInTheDocument();
    const rows = screen.getByTestId('interview-trends-table').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(14);
    expect(rows[0]).toHaveTextContent('2026-11-042');
    expect(rows[13]).toHaveTextContent('2026-11-1711');

    // Role breakdowns
    expect(screen.getByTestId('role-score-backend-developer')).toHaveTextContent('4.3 / 5.0');
    expect(screen.getByTestId('role-count-backend-developer')).toHaveTextContent('25 scored sessions');

    expect(screen.getByTestId('role-score-software-engineer')).toHaveTextContent('3.9 / 5.0');
    expect(screen.getByTestId('role-count-software-engineer')).toHaveTextContent('20 scored sessions');

    expect(screen.getByTestId('role-score-data-analyst')).toHaveTextContent('—');
    expect(screen.getByTestId('role-count-data-analyst')).toHaveTextContent('0 scored sessions');
  });

  it('renders 404 Access Denied state when API returns HTTP 404', async () => {
    const error404: any = new Error('Request failed with status code 404');
    error404.response = { status: 404, data: { success: false, message: 'Not found' } };
    vi.mocked(api.getAdminStats).mockRejectedValueOnce(error404);

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-access-denied')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /404 - not found \/ access denied/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /return to dashboard/i })).toBeInTheDocument();
    expect(screen.queryByTestId('stat-total-users')).not.toBeInTheDocument();
  });

  it('renders error alert with retry button when API fails with 500, and recovers on retry', async () => {
    const error500: any = new Error('Internal Server Error');
    error500.response = { status: 500, data: { success: false, message: 'Database connection failed' } };
    vi.mocked(api.getAdminStats).mockRejectedValueOnce(error500);

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/database connection failed/i)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Now mock success for retry
    vi.mocked(api.getAdminStats).mockResolvedValueOnce({
      success: true,
      data: mockStats,
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('admin-dashboard-screen')).toBeInTheDocument();
    });
    expect(screen.getByTestId('stat-total-users')).toHaveTextContent('128');
  });

  it('renders empty-data state message when platform has 0 users and 0 interviews', async () => {
    const emptyStats = {
      totalUsers: 0,
      interviewsPast14Days: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-11-${String(i + 4).padStart(2, '0')}`,
        count: 0,
      })),
      feedbackCounts: {
        ready: 0,
        failed: 0,
      },
      averageScoresByRole: [
        {
          role: 'backend-developer',
          roleLabel: 'Backend Developer',
          averageScore: null,
          sessionCount: 0,
        },
      ],
    };

    vi.mocked(api.getAdminStats).mockResolvedValueOnce({
      success: true,
      data: emptyStats,
    });

    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('admin-dashboard-screen')).toBeInTheDocument();
    });

    expect(screen.getByTestId('admin-empty')).toBeInTheDocument();
    expect(screen.getByText(/no candidate accounts or interview sessions have been recorded/i)).toBeInTheDocument();
    expect(screen.getByTestId('stat-total-users')).toHaveTextContent('0');
    expect(screen.getByTestId('stat-total-interviews-14d')).toHaveTextContent('0');
  });
});
