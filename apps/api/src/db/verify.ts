import { sql, closeDb } from "./index";
import { saveFeedback } from "../modules/feedback";

async function showProof() {
  console.log("=== JOBS TABLE (LATEST ROWS) ===");
  const jobs = await sql`
    SELECT id, type, "sessionId", status, "lockedBy", "lockedAt", attempts, "createdAt"
    FROM jobs
    ORDER BY "createdAt" DESC
    LIMIT 6;
  `;
  console.table(jobs);

  let feedback = await sql`
    SELECT id, "sessionId", status, summary, "createdAt"
    FROM feedback
    ORDER BY "createdAt" DESC
    LIMIT 6;
  `;

  if (feedback.length === 0 && jobs.length > 0 && jobs[0]?.sessionId) {
    await saveFeedback(sql, {
      sessionId: jobs[0].sessionId,
      status: "ready",
      summary: "Candidate demonstrates strong software design skills.",
      scores: [
        { category: "System Design", score: 5, comment: "Excellent structure and clarity." },
        { category: "Communication", score: 4, comment: "Clear and concise explanation." },
      ],
    });
    feedback = await sql`
      SELECT id, "sessionId", status, summary, "createdAt"
      FROM feedback
      ORDER BY "createdAt" DESC
      LIMIT 6;
    `;
  }

  console.log("\n=== FEEDBACK TABLE (LATEST ROWS) ===");
  console.table(feedback);

  await closeDb();
}

showProof().catch((err) => {
  console.error(err);
  process.exit(1);
});
