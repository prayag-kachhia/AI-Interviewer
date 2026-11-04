import { Navigate, useParams } from "react-router";
import { useFeedback } from "./useFeedback";

// Route: /interview/:sessionId/feedback — where ending an interview lands.
export function ResultsScreen() {
  const { sessionId } = useParams();
  const feedback = useFeedback(sessionId);

  if (!sessionId) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!feedback || feedback.status === "pending") {
    return (
      <div className="container page-wrapper" role="status">
        <p>Preparing your feedback… this can take a moment.</p>
      </div>
    );
  }

  if (feedback.status === "failed") {
    return (
      <div className="container page-wrapper" role="alert">
        <p>We couldn't generate feedback for this session.</p>
      </div>
    );
  }

  // status === "ready"
  return (
    <div className="container page-wrapper">
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
