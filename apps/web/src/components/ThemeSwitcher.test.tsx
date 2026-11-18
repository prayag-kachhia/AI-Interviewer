import '@testing-library/jest-dom/vitest';
import { beforeEach, expect, test } from 'vitest';
import { axe } from 'vitest-axe';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
import { ThemeSwitcher } from './ThemeSwitcher';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('theme', 'light');
});

test('offers all three themes, marks the current one, and switches on click', () => {
  render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );

  const swiss = screen.getByRole('button', { name: /swiss/i });
  const haute = screen.getByRole('button', { name: /haute/i });
  const graphite = screen.getByRole('button', { name: /graphite/i });
  expect(swiss).toHaveAttribute('aria-pressed', 'true');
  expect(haute).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(graphite);
  expect(graphite).toHaveAttribute('aria-pressed', 'true');
  expect(swiss).toHaveAttribute('aria-pressed', 'false');
  expect(document.documentElement).toHaveClass('dark', 'graphite');
  expect(localStorage.getItem('theme')).toBe('graphite');
});

test('has no accessibility violations across themes', async () => {
  const { container } = render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );

  // Initial light (Swiss) theme
  expect(await axe(container)).toHaveNoViolations();

  // Dark (Haute) theme
  const haute = screen.getByRole('button', { name: /haute/i });
  fireEvent.click(haute);
  expect(haute).toHaveAttribute('aria-pressed', 'true');
  expect(await axe(container)).toHaveNoViolations();

  // Graphite theme
  const graphite = screen.getByRole('button', { name: /graphite/i });
  fireEvent.click(graphite);
  expect(graphite).toHaveAttribute('aria-pressed', 'true');
  expect(await axe(container)).toHaveNoViolations();
});
