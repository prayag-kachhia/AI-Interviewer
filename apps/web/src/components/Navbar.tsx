import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { UserCircle2, BrainCircuit, Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

export const Navbar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login', {
        state: {
          message: 'You have been signed out. All your profile data and resumes remain safely stored in the database.',
          mode: 'signin'
        }
      });
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const isActive = (path: string) => location.pathname === path;

  if (!user) {
    return null;
  }

  return (
    <nav className="navbar">
      <div className="container navbar-content">
        <Link to="/" className="navbar-brand">
          <BrainCircuit size={28} color="var(--primary-color)" />
          AI Interviewer
        </Link>
        <div className="navbar-links">
          <Link to="/dashboard" className={`navbar-link ${isActive('/dashboard') ? 'active' : ''}`}>Dashboard</Link>
          <Link to="/profile" className={`navbar-link ${isActive('/profile') ? 'active' : ''}`}>Profile</Link>
          
          <button onClick={toggleTheme} className="btn-icon" aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          
          <div className="navbar-user-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-main)', fontWeight: 500 }}>
              <UserCircle2 size={20} color="var(--text-muted)" />
              {user.email}
            </div>
            <button onClick={handleLogout} className="btn btn-outline" style={{ padding: '0.4rem 1rem', fontSize: '0.875rem' }}>
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
