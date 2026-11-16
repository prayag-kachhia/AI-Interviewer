/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vitest turns CSS imports into empty strings, so read the file itself. `vitest run` starts in apps/web.
const css = readFileSync('src/styles.css', 'utf8');

/** NFR-14: both themes' colour pairs meet WCAG 2.1 AA. Reads the tokens straight from styles.css. */
function tokens(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground token, background token, minimum ratio]: 4.5 for text, 3 for UI shapes. */
const PAIRS: [string, string, number][] = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['brand-foreground', 'brand', 4.5],
  ['brand', 'background', 4.5],
  ['brand', 'card', 4.5],
  ['input', 'background', 3],
  ['input', 'card', 3],
  ['ring', 'background', 3],
];

describe.each([
  ['light (Swiss broadsheet)', ':root'],
  ['dark (Chronometer Deck)', '.dark'],
])('%s theme contrast', (_name, selector) => {
  const t = tokens(selector);

  it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(t[fg], `--${fg} is defined`).toBeDefined();
    expect(t[bg], `--${bg} is defined`).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});
