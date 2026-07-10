import { useState, useCallback, useRef } from 'react';
import { X, Upload, Loader2, FileText, CheckCircle2, AlertTriangle, Eye } from 'lucide-react';
import { publishFile, guessCategory, FILE_CATEGORIES } from '../../services/fileService';
import './FilePublish.css';

interface FilePublishProps {
  ownerName: string;
  onClose: () => void;
  onComplete: () => void;
}

type PublishPhase = 'idle' | 'selecting' | 'publishing' | 'done' | 'error';

interface PendingFile {
  file: File;
  category: string;
  tags: string[];
  description: string;
}

export default function FilePublish({ ownerName, onClose, onComplete }: FilePublishProps) {
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [description, setDescription] = useState('');
  const [showDescriptionPreview, setShowDescriptionPreview] = useState(false);

  const handleFileSelected = useCallback((file: File) => {
    const category = guessCategory(file.type);
    setPendingFile({ file, category, tags: [], description: '' });
    setPhase('selecting');
    setError('');
    setDescription('');
  }, []);

  const handlePublish = useCallback(async () => {
    if (!pendingFile) return;

    const finalDesc = description.trim();
    setPendingFile({ ...pendingFile, description: finalDesc });
    setPhase('publishing');
    setError('');

    try {
      await publishFile(pendingFile.file, ownerName, pendingFile.category, pendingFile.tags, finalDesc);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.');
      setPhase('error');
    }
  }, [pendingFile, ownerName, description]);

  // Tags system — removed for now, will be reworked later
  // const addTag = ...
  // const removeTag = ...

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  }, [handleFileSelected]);

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  return (
    <div className="publish-overlay" onClick={onClose}>
      <div className="publish" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="publish__header">
          <h2>Publish File</h2>
          <button className="publish__close" onClick={onClose} type="button" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Drop zone / file selector */}
        {phase === 'idle' && (
          <div
            ref={dropRef}
            className={`publish__dropzone${isDragging ? ' publish__dropzone--active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={40} strokeWidth={1.5} />
            <div className="publish__dropzone-text">
              <strong>Drop your file here</strong>
              <span>or click to browse</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="publish__file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelected(file);
              }}
            />
          </div>
        )}

        {/* File details + tag editor */}
        {(phase === 'selecting' || phase === 'error') && pendingFile && (
          <div className="publish__details">
            <div className="publish__file-info">
              <FileText size={28} strokeWidth={1.5} />
              <div>
                <strong>{pendingFile.file.name}</strong>
                <span>{formatSize(pendingFile.file.size)} — {pendingFile.file.type || 'unknown'}</span>
              </div>
            </div>

            <div className="publish__field">
              <label>Category</label>
              <select
                value={pendingFile.category}
                onChange={(e) =>
                  setPendingFile({ ...pendingFile, category: e.target.value })
                }
              >
                {FILE_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </div>

            {/* Tags — hidden for now, will be reworked later */}

            <div className="publish__field">
              <label>
                Notes <span className="publish__optional">(optional)</span>
              </label>
              <div className="publish__desc-row">
                <textarea
                  className="publish__desc-input"
                  placeholder="Add notes or comments about this file..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
                {description.trim() && (
                  <button
                    className="publish__desc-preview-btn"
                    title="Preview notes"
                    type="button"
                    onClick={() => setShowDescriptionPreview(true)}
                  >
                    <Eye size={16} />
                  </button>
                )}
              </div>
              <span className="publish__desc-hint">
                {description.length}/2000 characters — visible only to you
              </span>
            </div>

            {error && (
              <div className="publish__error" role="alert">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <div className="publish__actions">
              <button className="publish__btn publish__btn--cancel" onClick={onClose} type="button">
                Cancel
              </button>
              <button className="publish__btn publish__btn--primary" onClick={handlePublish} type="button">
                <Upload size={16} />
                Publish to QDN
              </button>
            </div>
          </div>
        )}

        {/* Publishing spinner */}
        {phase === 'publishing' && pendingFile && (
          <div className="publish__progress">
            <Loader2 size={40} className="publish__spinner" />
            <strong>Publishing to QDN...</strong>
            <span>{pendingFile.file.name}</span>
            <p>Your file is being published to the QDN network.</p>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="publish__done">
            <CheckCircle2 size={48} strokeWidth={1.5} />
            <strong>File published!</strong>
            <p>Your file has been published and is now available in your room.</p>
            <button
              className="publish__btn publish__btn--primary"
              onClick={() => {
                setPhase('idle');
                setPendingFile(null);
                onComplete();
              }}
              type="button"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Description preview modal */}
      {showDescriptionPreview && (
        <div className="publish-overlay" onClick={() => setShowDescriptionPreview(false)}>
          <div className="publish publish--preview" onClick={(e) => e.stopPropagation()}>
            <div className="publish__header">
              <h2>Notes Preview</h2>
              <button
                className="publish__close"
                onClick={() => setShowDescriptionPreview(false)}
                type="button"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="publish__desc-preview">
              {description.trim() ? (
                <p>{description.trim()}</p>
              ) : (
                <p className="publish__desc-empty">No notes added yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
