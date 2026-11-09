import '@testing-library/jest-dom/vitest';
import { test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { NewInterview } from './NewInterview';
import * as api from '../../lib/api';

vi.mock('../../lib/api', () => ({
  createSession: vi.fn(),
  getRoles: vi.fn().mockResolvedValue({
    success: true,
    data: [
      { id: 'software-engineer', label: 'Software Engineer', description: 'Coding & Architecture' },
    ],
  }),
  getLatestResume: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

test('given candidate has an uploaded resume, displays "Using resume: [Resume Name]" and link to profile', async () => {
  vi.mocked(api.getLatestResume).mockResolvedValueOnce({
    success: true,
    data: {
      resumeId: 'res-1',
      fileName: 'Rahul_Patel_Resume.pdf',
      createdAt: new Date().toISOString(),
      profile: {
        name: 'Rahul Patel',
        email: 'rahul@example.com',
        phone: '1234567890',
        summary: '',
        education: [],
        skills: ['TypeScript'],
        projects: [],
        experience: [],
        certifications: [],
        achievements: [],
        languages: [],
      },
    },
  });

  render(
    <MemoryRouter>
      <NewInterview />
    </MemoryRouter>
  );

  expect(await screen.findByText(/Using resume: Rahul_Patel_Resume\.pdf/i)).toBeInTheDocument();

  const profileLink = screen.getByRole('link', { name: /view profile/i });
  expect(profileLink).toBeInTheDocument();
  expect(profileLink).toHaveAttribute('href', '/profile');
});

test('given candidate has no uploaded resume, displays "No resume uploaded" and link to profile', async () => {
  vi.mocked(api.getLatestResume).mockRejectedValueOnce({
    response: { status: 404, data: { success: false, message: 'Resource not found' } },
  });

  render(
    <MemoryRouter>
      <NewInterview />
    </MemoryRouter>
  );

  expect(await screen.findByText(/No resume uploaded/i)).toBeInTheDocument();

  const profileLink = screen.getByRole('link', { name: /view profile/i });
  expect(profileLink).toBeInTheDocument();
  expect(profileLink).toHaveAttribute('href', '/profile');
});

