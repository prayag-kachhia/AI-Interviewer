# Adding an interview role

A role is the job a candidate practises for (Software Engineer, Data Analyst, Backend Developer).
Today a role is defined in three places, one per concern. Adding one is a single PR touching all
three, plus tests. It changes `packages/contracts`, so the lead reviews it.

## 1. The role itself: `packages/contracts/src/index.ts`

Add an entry to `ROLES`. Both apps read it: the setup screen's role cards, the landing page, the
history labels, and the API's check that a session's role exists.

```ts
{
  id: "frontend-developer",            // URL-safe, never changes once used
  label: "Frontend Developer",
  description: "Component design, accessibility, performance and state management.",
  focuses: ["Accessibility", "Performance", "State management", "Testing"],
},
```

`focuses` are the optional topics a candidate can pick at setup; `CreateSessionInput` rejects a
focus that isn't listed for the role.

## 2. The interviewer: `apps/api/src/services/briefing.service.ts`

Add an entry to `ROLE_PERSONAS` with the same id: who the interviewer is, and the topics for the
deep-dive and pressure-test phases. Every interview mode (Gemini Live, browser speech, typed)
reads it through `briefingFor`. Without an entry, the briefing falls back to a generic persona
built from the label, which works but asks generic questions.

## 3. The grading rubric: `apps/api/src/services/rubrics.ts`

Write the role's rubric: a list of categories, each with the criteria the evaluator scores 1 to 5.
Then add it to `RUBRICS_BY_ROLE`. **Without a rubric, every interview for the role fails to grade**
(`UnknownRoleError`).

- Keep category names stable once interviews exist: stored feedback is matched by name.
- Three or four categories, each a distinct skill, works best for the radar chart and for
  consistent scores.

## 4. Tests and the benchmark

- **Unit tests:** nothing yet checks that every role in `ROLES` has a rubric and a persona, so
  add that check (for example in `briefing.test.ts`: loop over `ROLES` and call `getRubric` and
  `briefingFor` for each). Then add a case for the new role wherever the existing roles are
  tested, and run `bun run test`.
- **Benchmark fixtures:** add at least a strong and a weak transcript for the role to
  `apps/api/src/__tests__/fixtures/transcripts/`, each with an `.expected.json` giving the
  acceptable score range per category. Copy an existing pair as a template.
- **Run the benchmark** with a real key: `bun run --filter @interview/api bench`. Check that the
  strong and weak transcripts score apart, and that scores stay within 1 point across runs
  ([evaluation-benchmark.md](../evaluation-benchmark.md)).

## 5. Check it end to end

Start a typed interview for the new role locally, answer two questions, end it, and check the
results show the new rubric's categories.

## Things to know

- The improvement guide's topics (DBMS, OOP, OS, CN, DSA, SQL, System Design) are shared by all
  roles (`INSIGHT_TOPICS` in `insights.service.ts`); a new role doesn't need new topics.
- Combining the three places into one role catalogue is a known improvement (NFR-17).
