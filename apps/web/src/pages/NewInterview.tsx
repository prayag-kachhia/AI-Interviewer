import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Code2,
  BarChart3,
  Server,
  Mic,
  CheckCircle2,
} from 'lucide-react';
import { createSession, getRoles } from '../lib/api';
import { RoleList, ROLES, type Role } from '@interview/contracts';

const ROLE_ICONS: Record<string, React.ReactNode> = {
  'software-engineer': <Code2 size={22} color="var(--primary-color)" />,
  'data-analyst': <BarChart3 size={22} color="var(--primary-color)" />,
  'backend-developer': <Server size={22} color="var(--primary-color)" />,
};

export const NewInterview: React.FC = () => {
  const [roles, setRoles] = useState<Role[]>(ROLES);
  const [roleId, setRoleId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    getRoles()
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setRoles(RoleList.parse(res.data));
        }
      })
      .catch(() => {
        // Fallback to centralized ROLES catalogue if offline
      });
  }, []);

  const handleStart = async () => {
    if (!roleId || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await createSession(roleId);
      if (res.success && res.data?.id) {
        navigate(`/interview/${res.data.id}`);
      } else {
        setError(res.message || 'Could not start the interview session. Please try again.');
      }
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
          'Unable to create the interview session. Please check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container page-wrapper" style={{ maxWidth: '640px' }}>
      <button
        type="button"
        className="btn btn-outline"
        style={{ marginBottom: '1.5rem', padding: '0.5rem 1rem' }}
        onClick={() => navigate('/dashboard')}
      >
        <ArrowLeft size={18} />
        Back to Dashboard
      </button>

      <div className="card" style={{ padding: '2.75rem 2.25rem' }}>
        <div className="card-header" style={{ marginBottom: '1.75rem' }}>
          <div
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              background: 'var(--primary-light)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <BrainCircuit size={32} color="var(--primary-color)" />
          </div>
          <h2 style={{ fontSize: '1.85rem', marginBottom: '0.5rem' }}>Choose an interview role</h2>
          <p style={{ fontSize: '0.98rem', color: 'var(--text-muted)' }}>
            Select a target role to start your live spoken AI interview session.
          </p>
        </div>

        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: '1.25rem' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        <div
          role="radiogroup"
          aria-label="Interview role options"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', margin: '1.5rem 0 2rem' }}
        >
          {roles.map((role) => {
            const isSelected = roleId === role.id;
            return (
              <label
                key={role.id}
                className="card-hover"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '1rem',
                  padding: '1.15rem 1.25rem',
                  borderRadius: '14px',
                  border: `2px solid ${isSelected ? 'var(--primary-color)' : 'var(--border-color)'}`,
                  background: isSelected ? 'var(--primary-light)' : 'var(--surface-color)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <input
                  type="radio"
                  name="interview-role"
                  value={role.id}
                  checked={isSelected}
                  onChange={() => {
                    setRoleId(role.id);
                    setError('');
                  }}
                  disabled={loading}
                  style={{ marginTop: '0.3rem', accentColor: 'var(--primary-color)' }}
                />
                <div style={{ flexGrow: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      marginBottom: role.description ? '0.25rem' : 0,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                      {role.label}
                    </span>
                    {isSelected ? (
                      <CheckCircle2 size={20} color="var(--primary-color)" />
                    ) : (
                      ROLE_ICONS[role.id]
                    )}
                  </div>
                  {role.description && (
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', margin: 0 }}>
                      {role.description}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.75rem 1rem',
            borderRadius: '10px',
            background: 'var(--bg-color)',
            border: '1px solid var(--border-color)',
            marginBottom: '1.5rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
          }}
        >
          <Mic size={16} color="var(--primary-color)" style={{ flexShrink: 0 }} />
          <span>
            This is a live spoken audio interview. Make sure your speakers and microphone are enabled.
          </span>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '0.9rem 1.5rem', fontSize: '1.05rem' }}
          onClick={handleStart}
          disabled={!roleId || loading}
        >
          {loading ? (
            <>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Starting Interview...
            </>
          ) : (
            <>
              Start Interview
              <ArrowRight size={18} />
            </>
          )}
        </button>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
};
