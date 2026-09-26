// ResultsScreen.tsx
import { useFeedback } from "./useFeedback";

export function ResultsScreen({ sessionId }: { sessionId: string }) {
  const feedback = useFeedback(sessionId);

  if (!feedback || feedback.status === "pending") {
    return (
      <div role="status">
        <p>Preparing your feedback… this can take a moment.</p>
      </div>
    );
  }

  if (feedback.status === "failed") {
    return (
      <div role="alert">
        <p>We couldn't generate feedback for this session.</p>
      </div>
    );
  }

  // status === "ready"
  return (
    <div>
      <h2>Your Feedback</h2>
      <p>{feedback.summary}</p>
      <ul>
        {feedback.scores?.map((s) => (
          <li key={s.category}>
            <strong>{s.category}:</strong> {s.score}/5 — {s.comment}
          </li>
        ))}
      </ul>
    </div>
  );
}