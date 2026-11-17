/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider } from './ThemeContext';

// The inline script in index.html puts the theme on <html> before React starts, so a dark page never
// loads light and fades. It must set exactly what ThemeContext sets. `vitest run` starts in apps/web.
const script = readFileSync('index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const root = document.documentElement;
const snapshot = () => ({ classes: [...root.classList].sort(), dataTheme: root.dataset.theme });
const clearRoot = () => {
  root.className = '';
  root.removeAttribute('data-theme');
};

describe('the theme script in index.html', () => {
  beforeEach(() => {
    localStorage.clear();
    clearRoot();
  });

  it.each(['light', 'dark', 'graphite', 'sepia'])('sets what ThemeContext sets for a saved "%s"', (saved) => {
    expect(script).toContain("localStorage.getItem('theme')");

    localStorage.setItem('theme', saved);
    new Function(script)();
    const fromScript = snapshot();

    clearRoot();
    render(<ThemeProvider><span /></ThemeProvider>);
    expect(fromScript).toEqual(snapshot());
  });
});
