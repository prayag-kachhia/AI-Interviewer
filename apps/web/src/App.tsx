import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router';
import { Navbar } from './components/Navbar';
import { Login } from './screens/login/Login';
import { Dashboard } from './screens/dashboard/Dashboard';
import { Profile } from './screens/profile/Profile';
import { NewInterview } from './screens/new-interview/NewInterview';
import { InterviewRoom } from './screens/interview-room/InterviewRoom';
import { ResultsScreen } from './screens/results/ResultsScreen';
import { HistoryPage } from './screens/history/HistoryPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Navbar />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            
            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/new-interview" element={<NewInterview />} />
              <Route path="/interview/:sessionId" element={<InterviewRoom />} />
              <Route path="/interview/:sessionId/feedback" element={<ResultsScreen />} />
            </Route>
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
