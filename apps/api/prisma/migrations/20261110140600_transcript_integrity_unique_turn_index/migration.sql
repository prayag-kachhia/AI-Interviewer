-- Renumber turns 1..N per session before adding the unique constraint (NFR-10, PK-6).
-- Rows that share a turnIndex are different turns saved at the same moment, so every
-- turn is kept and only its number changes; the numbering also ends up without gaps.
UPDATE "turns" AS t
SET "turnIndex" = r.rnum
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "sessionId"
    ORDER BY "turnIndex" ASC, "createdAt" ASC, id ASC
  ) AS rnum
  FROM "turns"
) r
WHERE t.id = r.id AND t."turnIndex" <> r.rnum;

-- CreateIndex
CREATE UNIQUE INDEX "turns_sessionId_turnIndex_key" ON "turns"("sessionId", "turnIndex");
