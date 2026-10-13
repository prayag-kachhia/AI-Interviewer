import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { getLatestResume } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { ResumeData } from '../types';
import { 
  Mail, Phone, Briefcase, GraduationCap, 
  FolderGit2, Code2, Award, Languages, Loader2, ArrowLeft,
  Trash2, ShieldAlert, AlertTriangle, X
} from 'lucide-react';

export const Profile: React.FC = () => {
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Account deletion states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await getLatestResume();
        if (response.success && response.data) {
          setResumeData(response.data);
        } else {
          setError(response.message || 'Failed to load profile');
        }
      } catch (err: any) {
        if (err.response?.status === 404) {
          setError("You haven't uploaded a resume yet.");
        } else {
          setError(err.response?.data?.message || 'Error fetching profile');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await deleteAccount();
      if (res.success) {
        navigate('/login', {
          state: {
            message: 'Your account and all associated resumes have been permanently deleted.',
            mode: 'signin',
          },
        });
      } else {
        setDeleteError(res.message || 'Failed to delete account');
        setDeleting(false);
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete account');
      setDeleting(false);
    }
  };

  // Reusable Account Danger Zone Component
  const renderDangerZone = () => (
    <div 
      className="card" 
      style={{ 
        marginTop: '2.5rem', 
        borderColor: 'rgba(239, 68, 68, 0.3)', 
        background: 'var(--surface-color)',
        padding: '2rem'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', color: 'var(--error-color)' }}>
        <ShieldAlert size={24} />
        <h3 style={{ fontSize: '1.25rem', margin: 0, color: 'var(--text-main)' }}>Account Management & Data Privacy</h3>
      </div>
      
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
        <strong>Data Retention Guarantee:</strong> Logging out never deletes your resumes or candidate profile. Your data remains completely safe in the database.
        However, if you wish to permanently remove yourself and all uploaded data, you may delete your account below.
      </p>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem',
        borderRadius: 'var(--radius-md)',
        background: 'var(--error-bg)',
        border: '1px solid rgba(239, 68, 68, 0.2)',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <div>
          <div style={{ fontWeight: 600, color: 'var(--error-text)', marginBottom: '0.25rem' }}>
            Delete Account and All Associated Data
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--error-text)', opacity: 0.9 }}>
            Permanently removes your user account ({user?.email}) and all uploaded resumes.
          </div>
        </div>
        <button
          type="button"
          className="btn"
          style={{
            backgroundColor: 'var(--error-color)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.6rem 1.25rem'
          }}
          onClick={() => setShowDeleteModal(true)}
        >
          <Trash2 size={16} /> Delete Account
        </button>
      </div>
    </div>
  );

  // Confirmation Modal
  const renderModal = () => {
    if (!showDeleteModal) return null;
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem'
      }}>
        <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '2rem', boxShadow: 'var(--shadow-float)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--error-color)' }}>
              <AlertTriangle size={28} />
              <h3 style={{ margin: 0, fontSize: '1.35rem', color: 'var(--text-main)' }}>Confirm Account Deletion</h3>
            </div>
            <button 
              type="button" 
              className="btn-icon" 
              onClick={() => !deleting && setShowDeleteModal(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
            >
              <X size={20} />
            </button>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
            Are you sure you want to delete your account? This action is <strong style={{ color: 'var(--error-color)' }}>irreversible</strong>.
          </p>

          <div style={{
            background: 'var(--bg-color)',
            padding: '1rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-color)',
            marginBottom: '1.5rem',
            fontSize: '0.875rem'
          }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>The following will be permanently erased:</p>
            <ul style={{ paddingLeft: '1.25rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <li>User account ({user?.email})</li>
              <li>All uploaded PDF resumes</li>
              <li>AI-generated candidate profile and skills history</li>
            </ul>
          </div>

          {deleteError && (
            <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
              <AlertTriangle size={18} />
              <span>{deleteError}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{
                backgroundColor: 'var(--error-color)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
              onClick={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 size={16} /> Yes, Delete Everything
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="container page-wrapper" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1rem', height: '60vh' }}>
        <Loader2 size={48} color="var(--primary-color)" style={{ animation: 'spin 1s linear infinite' }} />
        <p style={{ fontSize: '1.125rem', fontWeight: 500 }}>Loading your candidate profile...</p>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !resumeData) {
    return (
      <div className="container page-wrapper">
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '1rem' }}>No Profile Found</h2>
          <p style={{ marginBottom: '2rem' }}>{error === "You haven't uploaded a resume yet." ? error : 'We could not find a candidate profile for your account.'}</p>
          <button className="btn btn-primary" onClick={() => navigate('/dashboard')}>
            Go to Dashboard to Upload
          </button>
        </div>

        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          {renderDangerZone()}
        </div>
        {renderModal()}
      </div>
    );
  }

  const { profile, fileName, createdAt } = resumeData;

  return (
    <div className="container page-wrapper">
      <button 
        className="btn btn-outline" 
        style={{ marginBottom: '2rem', padding: '0.5rem 1rem' }}
        onClick={() => navigate('/dashboard')}
      >
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className="card" style={{ padding: '3rem' }}>
        {/* Header section */}
        <div className="profile-header">
          <div>
            <h1 className="profile-name text-gradient">{profile.name || user?.name || 'Candidate Profile'}</h1>
            <div className="profile-contact">
              {(profile.email || user?.email) && (
                <div className="contact-item">
                  <Mail size={16} /> {profile.email || user?.email}
                </div>
              )}
              {profile.phone && (
                <div className="contact-item">
                  <Phone size={16} /> {profile.phone}
                </div>
              )}
            </div>
          </div>
          <div className="profile-metadata">
            <div style={{ fontWeight: 500, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Source Resume</div>
            <div style={{ color: 'var(--text-main)' }}>{fileName}</div>
            <div style={{ marginTop: '0.25rem' }}>Analyzed: {new Date(createdAt).toLocaleDateString()}</div>
          </div>
        </div>

        {/* Summary section */}
        <div style={{ marginBottom: '3rem' }}>
          <h3 style={{ fontSize: '1.25rem', color: 'var(--text-main)', marginBottom: '1rem' }}>Professional Summary</h3>
          {profile.summary ? (
            <p style={{ fontSize: '1.0625rem', color: 'var(--text-main)', lineHeight: 1.7 }}>{profile.summary}</p>
          ) : (
            <p className="empty-state">No professional summary extracted.</p>
          )}
        </div>

        {/* Main Grid */}
        <div className="profile-grid">
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="profile-section">
              <h3><Code2 size={20} /> Skills</h3>
              {profile.skills && profile.skills.length > 0 ? (
                <div className="tag-list">
                  {profile.skills.map((skill, idx) => (
                    <span key={idx} className="tag">{skill}</span>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No skills listed</p>
              )}
            </div>

            <div className="profile-section">
              <h3><Briefcase size={20} /> Experience</h3>
              {profile.experience && profile.experience.length > 0 ? (
                <div>
                  {profile.experience.map((exp, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-item-title">{exp}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No experience listed</p>
              )}
            </div>

            <div className="profile-section">
              <h3><Languages size={20} /> Languages</h3>
              {profile.languages && profile.languages.length > 0 ? (
                <div className="tag-list">
                  {profile.languages.map((lang, idx) => (
                    <span key={idx} className="tag">{lang}</span>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No languages listed</p>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="profile-section">
              <h3><GraduationCap size={20} /> Education</h3>
              {profile.education && profile.education.length > 0 ? (
                <div>
                  {profile.education.map((edu, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-item-title">{edu}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No education listed</p>
              )}
            </div>

            <div className="profile-section">
              <h3><FolderGit2 size={20} /> Projects</h3>
              {profile.projects && profile.projects.length > 0 ? (
                <div>
                  {profile.projects.map((proj, idx) => (
                    <div key={idx} className="list-item">
                      <div className="list-item-title">{proj}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty-state">No projects listed</p>
              )}
            </div>

            {(profile.certifications?.length > 0 || profile.achievements?.length > 0) && (
              <div className="profile-section">
                <h3><Award size={20} /> Certifications & Achievements</h3>
                <div>
                  {profile.certifications?.map((cert, idx) => (
                    <div key={`cert-${idx}`} className="list-item">
                      <div className="list-item-title">{cert}</div>
                      <div className="list-item-desc">Certification</div>
                    </div>
                  ))}
                  {profile.achievements?.map((ach, idx) => (
                    <div key={`ach-${idx}`} className="list-item">
                      <div className="list-item-title">{ach}</div>
                      <div className="list-item-desc">Achievement</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Account Management & Data Privacy Danger Zone */}
      {renderDangerZone()}
      {renderModal()}
    </div>
  );
};
