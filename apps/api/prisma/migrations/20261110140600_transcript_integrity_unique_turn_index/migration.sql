-- De-duplicate any existing (sessionId, turnIndex) rows before adding the unique constraint (NFR-10, PK-6)
DELETE FROM "turns"
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY "sessionId", "turnIndex"
      ORDER BY "createdAt" ASC, id ASC
    ) as rnum
    FROM "turns"
  ) t
  WHERE t.rnum > 1
);

-- CreateIndex
CREATE UNIQUE INDEX "turns_sessionId_turnIndex_key" ON "turns"("sessionId", "turnIndex");
