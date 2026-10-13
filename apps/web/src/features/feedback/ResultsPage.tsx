import { Navigate, useParams } from 'react-router';
import { ResultsScreen } from './ResultsScreen';

// Route: /interview/:sessionId/feedback — where ending an interview lands.
export function ResultsPage() {
  const { sessionId } = useParams();
  if (!sessionId) {
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <div className="container page-wrapper">
      <ResultsScreen sessionId={sessionId} />
    </div>
  );
}
