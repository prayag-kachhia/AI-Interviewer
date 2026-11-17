# ADR-0011: One Design System: Tailwind CSS, Shared UI Components and Theme Variables

- **Status:** Accepted, 17 Nov 2026
- **Context:** P-12 (#140), Decision 6 in `docs/final-sprints.md` (UI revamp), NFR-14 (accessibility)

## Context

Until Sprint 5 the web app was styled by one global stylesheet, `legacy.css` (about 1,240 lines of hand-written classes such as `.card`, `.btn` and `.alert`), plus inline `style={{…}}` objects in the screens. Every screen looked slightly different, dark mode was a second copy of the colour variables, and a class written for one screen could change another.

The UI revamp moved each screen to Tailwind CSS and a small set of shared components, one screen at a time, each by the screen's owner. So that old and new screens could live side by side during the move:

- Tailwind's CSS reset (preflight) stayed off, because it would have broken the old screens.
- `legacy.css` sat in its own cascade layer, below Tailwind's utility classes, so a utility class always won over an old rule.
- A small slice of the reset was applied to the shared components only.

By P-12 every screen except History had moved.

## Decision

1. **Tailwind CSS v4 is the only styling system.** Screens style elements with utility classes. Static inline styles are not used; `style` is kept for values computed at run time, such as a progress width or the microphone level.
2. **Shared components live in `apps/web/src/components/ui`.** They are shadcn/ui components copied into the repo (Button, Card, Input, Alert, Badge, Dialog, AlertDialog, Progress, RadioGroup, Avatar, Chart), not an installed library. One is added only when a screen needs it.
3. **Themes are CSS variables, not per-screen `dark:` classes.**
   - `styles.css` defines each theme's colours, corner radius, border width, shadow and fonts as variables on `:root` (Swiss), `.dark` (Haute) and `.graphite` (Graphite).
   - `@theme inline` maps them to Tailwind names (`bg-card`, `text-muted-foreground`, `rounded-lg`), so a screen built from the shared components follows the theme with no theme-specific code.
   - `ThemeContext` only switches the class on `<html>`.
   - `styles.contrast.test.ts` reads the variables and checks that each theme's text colours meet WCAG AA (NFR-14).
4. **The reset is on, and cascade layers decide precedence.** The order is `theme, base, components, legacy, utilities`. A later layer always wins, whatever the selector, so a utility class always beats older CSS. The base layer also makes a bare `border` class use the theme's border colour.
5. **One chart library:** Recharts, through the shadcn Chart component.

## Interim: the History page

History (RH-10, #304) had not moved yet, so P-12 did not wait for it:

- `legacy.css` now holds only the 11 classes, the colour variables and the heading rules History uses. The heading rules are scoped to History's root with `:where(.page-wrapper)`, which adds no specificity, so they reach no other screen.
- `styles.css` keeps `@source not inline('container')`, so Tailwind's own `.container` doesn't replace History's.
- `ThemeContext` keeps the `data-theme` attribute, which only these leftover rules read.
- History's own inline styles stay until then too.

RH-10 restyles History and removes all of these.

## Consequences

**Positive**
- The screens look consistent. A new theme is mostly one block of variables: Graphite was added that way, plus a third option in the theme switcher, and no screen needed Graphite-specific styles.
- The reset gives every browser the same starting point, so nothing keeps a browser default by accident. For example, textareas no longer fall back to a monospace font and black text in the dark themes.
- A style lives on the element it styles, so a pull request cannot restyle another screen through a shared class. Reviews only need the diff.

**Negative**
- Class lists in JSX get long. The shared components and the `cn()` helper keep that down.
- With the reset on, a raw element (`<h2>`, `<ul>`, `<a>`) has no look of its own: its size, spacing, bullets or underline must be written as classes. P-12 restored them where a screen relied on the old defaults: the landing feature list, the landing footer link and the Profile name's tracking.

## Alternatives Considered

- **Keep and tidy the hand-written stylesheet.** Cheapest in the short term, but its classes stay global and every theme needs another copy of each colour rule.
- **CSS Modules per screen.** Scoped, but each screen re-implements buttons and cards, and the themes still need shared variables.
- **CSS-in-JS (styled-components, Emotion).** It adds a runtime cost and a different model from the shadcn components.
- **A full component library (MUI, Chakra UI).** Quick to start, but hard to bend into the Swiss and Haute designs, and a much larger dependency.
