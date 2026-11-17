import { BrowserRouter as Router, Routes, Route } from 'react-router';
import { Landing } from './screens/landing/Landing';
import { Navbar } from './components/Navbar';
import { Login } from './screens/login/Login';
import { ResetPassword } from './screens/reset-password/ResetPassword';
import { VerifyEmail } from './screens/verify-email/VerifyEmail';
import { Dashboard } from './screens/dashboard/Dashboard';
import { Profile } from './screens/profile/Profile';
import { NewInterview } from './screens/new-interview/NewInterview';
import { InterviewRoom } from './screens/interview-room/InterviewRoom';
import { ResultsScreen } from './screens/results/ResultsScreen';
import { HistoryPage } from './screens/history/HistoryPage';
import { GuidePage } from './screens/guide/GuidePage';
import { AdminDashboard } from './screens/admin/AdminDashboard';
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
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            
            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/guide" element={<GuidePage />} />
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
