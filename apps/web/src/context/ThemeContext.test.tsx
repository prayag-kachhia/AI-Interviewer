import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeContext';

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

const root = document.documentElement;

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    root.className = '';
    root.removeAttribute('data-theme');
  });

  it('cycles Swiss, Haute, Graphite and back', () => {
    localStorage.setItem('theme', 'light');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('light');
    fireEvent.click(button);
    expect(button).toHaveTextContent('dark');
    fireEvent.click(button);
    expect(button).toHaveTextContent('graphite');
    fireEvent.click(button);
    expect(button).toHaveTextContent('light');
  });

  it('puts the right classes on <html> for each theme', () => {
    localStorage.setItem('theme', 'graphite');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    // Graphite is a dark theme that overrides Haute. History's leftover legacy.css only knows light
    // and dark, so its dark rules must still match in Graphite (until RH-10, #304).
    expect(root).toHaveClass('dark', 'graphite');
    expect(root.dataset.theme).toBe('dark');

    fireEvent.click(screen.getByRole('button'));
    expect(root).not.toHaveClass('dark');
    expect(root).not.toHaveClass('graphite');
    expect(root.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('theme', 'sepia');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(['light', 'dark']).toContain(screen.getByRole('button').textContent);
  });
});
