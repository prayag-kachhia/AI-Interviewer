import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { UploadCloud, FileText, CheckCircle, ArrowRight, Loader2, AlertCircle, UserCircle2, BrainCircuit } from 'lucide-react';
import { uploadResume, getLatestResume } from '../lib/api';
import { useAuth } from '../context/AuthContext';

export const Dashboard: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [hasProfile, setHasProfile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const { user } = useAuth();
  const firstName = user?.name ? user.name.split(' ')[0] : 'Candidate';

  useEffect(() => {
    // Check if the user already has a profile
    getLatestResume().then(res => {
      if (res.success && res.data) {
        setHasProfile(true);
      }
    }).catch(() => {
      // Ignore 404s, it just means they don't have a profile yet
    });
  }, []);

  const handleFiles = (files: FileList) => {
    const selectedFile = files[0];
    if (selectedFile.type !== 'application/pdf') {
      setError('Please select a PDF file.');
      setFile(null);
      return;
    }
    if (selectedFile.size > 5 * 1024 * 1024) {
      setError('File is too large. Maximum size is 5MB.');
      setFile(null);
      return;
    }
    setFile(selectedFile);
    setError('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    setError('');
    setStatus('Extracting information...');

    try {
      // Simulate slight delay for UI polish if processing is too fast
      setTimeout(() => setStatus('Analyzing resume with AI...'), 1500);
      
      const response = await uploadResume(file);
      
      if (response.success) {
        setStatus('Analysis complete!');
        setHasProfile(true);
        setTimeout(() => {
          navigate('/profile');
        }, 1000);
      } else {
        setError(response.message || 'Failed to process resume');
        setStatus('');
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'An error occurred during processing');
      setStatus('');
      setLoading(false);
    }
  };

  return (
    <div className="container page-wrapper">
      <div style={{ marginBottom: '3.5rem', textAlign: 'center' }}>
        <h1 className="text-gradient" style={{ marginBottom: '0.75rem' }}>Good to see you, {firstName} 👋</h1>
        <p style={{ fontSize: '1.25rem', color: 'var(--text-muted)' }}>Build your AI-powered interview profile.</p>
      </div>

      <div className="card" style={{ maxWidth: '750px', margin: '0 auto' }}>
        <div className="card-header">
          <h2>Upload Resume</h2>
          <p>Upload your resume in PDF format (Max 5 MB)</p>
        </div>

        {error && (
          <div className="alert alert-error">
            <AlertCircle size={20} />
            {error}
          </div>
        )}

        {status && (
          <div className="alert alert-info">
            <Loader2 size={20} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
            {status}
          </div>
        )}
        
        <style>{`
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>

        <div 
          className={`upload-area ${file ? 'active' : ''} ${isDragging ? 'drag-over' : ''}`} 
          onClick={() => !loading && fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="application/pdf"
            style={{ display: 'none' }} 
            disabled={loading}
          />
          
          {file ? (
            <div>
              <FileText className="upload-icon" />
              <div className="upload-text">{file.name}</div>
              <div className="upload-hint">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to analyze</div>
            </div>
          ) : (
            <div>
              <UploadCloud className="upload-icon" />
              <div className="upload-text">Drag & drop your PDF here</div>
              <div className="upload-hint">or click to browse from your device</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right' }}>
          <button 
            className="btn btn-primary" 
            onClick={handleUpload} 
            disabled={!file || loading}
          >
            {loading ? (
              <>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                Processing...
              </>
            ) : (
              <>
                Analyze Resume
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: '750px', margin: '2rem auto 0' }}>
        <div className="card-header">
          <h2>Practice Interview</h2>
          <p>Start a live AI interview session for a role of your choice.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-primary" onClick={() => navigate('/interview/new')}>
            <BrainCircuit size={18} />
            Start Interview
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <div className="dashboard-grid" style={{ maxWidth: '750px', margin: '2.5rem auto' }}>
        <div className="stat-card">
          <div className={`stat-icon ${hasProfile ? 'success' : 'warning'}`}>
            {hasProfile ? <CheckCircle size={24} /> : <AlertCircle size={24} />}
          </div>
          <div className="stat-content">
            <h4>Profile Status</h4>
            <p>{hasProfile ? 'Analyzed & Ready' : 'Awaiting Resume'}</p>
          </div>
        </div>

        {hasProfile ? (
          <div className="stat-card clickable" onClick={() => navigate('/profile')}>
            <div className="stat-icon primary">
              <UserCircle2 size={24} />
            </div>
            <div className="stat-content" style={{ flexGrow: 1 }}>
              <h4>Candidate Profile</h4>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--primary-color)' }}>
                <p style={{ color: 'var(--primary-color)' }}>View Profile</p>
                <ArrowRight size={20} />
              </div>
            </div>
          </div>
        ) : (
           <div className="stat-card">
            <div className="stat-icon disabled">
              <UserCircle2 size={24} />
            </div>
            <div className="stat-content">
              <h4>Candidate Profile</h4>
              <p style={{ color: 'var(--text-muted)' }}>Not generated yet</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
