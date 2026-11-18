import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Navbar } from './Navbar';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router')>()),
  useNavigate: () => mockNavigate,
}));

let auth: { user: { id: string; email: string; name?: string; isAdmin?: boolean } | null; signOut: () => Promise<void> };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/ThemeContext', async (importActual) => ({
  ...(await importActual<typeof import('../context/ThemeContext')>()),
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Navbar />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockNavigate.mockReset();
  auth = { user: { id: 'u1', email: 'ada.lovelace@example.com', name: 'Ada Lovelace' }, signOut: vi.fn().mockResolvedValue(undefined) };
});

test('shows every link, marks the current page, and shows the avatar initials', () => {
  renderAt('/history');

  for (const name of ['Dashboard', 'New interview', 'History', 'Guide', 'Profile']) {
    expect(screen.getByRole('link', { name })).toBeInTheDocument();
  }
  expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Guide' })).not.toHaveAttribute('aria-current');
  expect(screen.getByText('AL')).toBeInTheDocument();
});

test('renders nothing for a signed-out visitor', () => {
  auth = { ...auth, user: null };
  const { container } = renderAt('/');
  expect(container).toBeEmptyDOMElement();
});

test('renders nothing on the landing page, reset-password and verify-email screens', () => {
  for (const path of ['/', '/reset-password', '/verify-email']) {
    const { container, unmount } = renderAt(path);
    expect(container).toBeEmptyDOMElement();
    unmount();
  }
});

test('signing out goes to the login screen', async () => {
  renderAt('/dashboard');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', expect.objectContaining({ state: expect.anything() })));
  expect(auth.signOut).toHaveBeenCalledTimes(1);
});

test('the menu button opens the links below lg, and a link or Escape closes it', () => {
  renderAt('/dashboard');
  expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = screen.getByRole('navigation', { name: 'Menu' });
  expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Dashboard', 'New interview', 'History', 'Guide', 'Profile']) {
    expect(within(menu).getByRole('link', { name })).toBeInTheDocument();
  }

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('link', { name: 'Guide' }));
  expect(screen.queryByRole('navigation', { name: 'Menu' })).not.toBeInTheDocument();
});

test('does not show the Admin link to a non-admin candidate', () => {
  auth = {
    user: { id: 'u1', email: 'regular@example.com', name: 'Regular User', isAdmin: false },
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  renderAt('/dashboard');
  expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
});

test('shows the Admin link to an authorized admin and marks it current when at /admin', () => {
  auth = {
    user: { id: 'u2', email: 'admin@example.com', name: 'Admin User', isAdmin: true },
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  renderAt('/admin');

  const adminLink = screen.getByRole('link', { name: 'Admin' });
  expect(adminLink).toBeInTheDocument();
  expect(adminLink).toHaveAttribute('aria-current', 'page');
});

test('renders the Admin link in mobile menu for an authorized admin', () => {
  auth = {
    user: { id: 'u2', email: 'admin@example.com', name: 'Admin User', isAdmin: true },
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  renderAt('/dashboard');

  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = screen.getByRole('navigation', { name: 'Menu' });
  expect(within(menu).getByRole('link', { name: 'Admin' })).toBeInTheDocument();
});

test('uses xl responsive breakpoint when admin navigation is present to prevent overflow at 1024px-1100px', () => {
  // Admin user
  auth = {
    user: { id: 'u2', email: 'admin@example.com', name: 'Admin User', isAdmin: true },
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  const { unmount } = renderAt('/dashboard');

  const adminMenuButton = screen.getByRole('button', { name: 'Open menu' });
  expect(adminMenuButton).toHaveClass('xl:hidden');

  fireEvent.click(adminMenuButton);
  const adminMobileMenu = screen.getByRole('navigation', { name: 'Menu' });
  expect(adminMobileMenu).toHaveClass('xl:hidden');
  unmount();

  // Regular non-admin user
  auth = {
    user: { id: 'u1', email: 'regular@example.com', name: 'Regular User', isAdmin: false },
    signOut: vi.fn().mockResolvedValue(undefined),
  };
  renderAt('/dashboard');

  const regularMenuButton = screen.getByRole('button', { name: 'Open menu' });
  expect(regularMenuButton).toHaveClass('lg:hidden');

  fireEvent.click(regularMenuButton);
  const regularMobileMenu = screen.getByRole('navigation', { name: 'Menu' });
  expect(regularMobileMenu).toHaveClass('lg:hidden');
});
