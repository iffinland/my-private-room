import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, StickyNote, X } from 'lucide-react';
import type { PrivateFile } from '../../types';
import { loadFileDescription, type LoadedDescription } from '../../services/descriptionService';
import './DescriptionDialog.css';

interface DescriptionDialogProps {
  ownerName: string;
  file: PrivateFile;
  onClose: () => void;
}

type DialogPhase = 'loading' | 'ready' | 'error';

export default function DescriptionDialog({ ownerName, file, onClose }: DescriptionDialogProps) {
  const [phase, setPhase] = useState<DialogPhase>('loading');
  const [description, setDescription] = useState<LoadedDescription | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setPhase('loading');
    setError('');
    setDescription(null);

    void loadFileDescription(ownerName, file)
      .then((loaded) => {
        if (!active) return;
        setDescription(loaded);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'The description could not be loaded.');
        setPhase('error');
      });

    return () => {
      active = false;
    };
  }, [ownerName, file]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const hasDescription = phase === 'ready' && description !== null && description.source !== 'none';

  return (
    <div className="description-overlay" onClick={onClose}>
      <div
        className="description-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="description-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="description-dialog__header">
          <div className="description-dialog__heading">
            <StickyNote size={18} />
            <h2 id="description-dialog-title">Description</h2>
          </div>
          <button
            className="description-dialog__close"
            onClick={onClose}
            type="button"
            aria-label="Close description"
          >
            <X size={18} />
          </button>
        </div>

        <p className="description-dialog__file" title={file.fileName}>
          {file.fileName}
        </p>

        <div className="description-dialog__content">
          {phase === 'loading' && (
            <div className="description-dialog__state" aria-live="polite">
              <Loader2 size={24} className="description-dialog__spinner" />
              <span>Loading description…</span>
            </div>
          )}

          {phase === 'error' && (
            <div className="description-dialog__state description-dialog__state--error" role="alert">
              <AlertTriangle size={22} />
              <span>{error}</span>
            </div>
          )}

          {phase === 'ready' && !hasDescription && (
            <div className="description-dialog__state description-dialog__state--empty">
              <StickyNote size={26} strokeWidth={1.5} />
              <span>No description was published for this file.</span>
              <small>Files published before descriptions existed still work normally.</small>
            </div>
          )}

          {phase === 'ready' && hasDescription && description && (
            <>
              <div
                className="description-dialog__body"
                // `loadFileDescription` sanitizes every source path (rich
                // resource, legacy metadata and plain text) before returning.
                dangerouslySetInnerHTML={{ __html: description.html }}
              />
              <p className="description-dialog__source">
                {description.source === 'legacy-metadata'
                  ? 'Legacy plain-text description stored in QDN metadata.'
                  : 'Rich description stored as a separate public QDN JSON resource.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
