import { useEffect, useState } from 'react';
import { X, Loader2, EyeOff, FileText } from 'lucide-react';
import type { PrivateFile } from '../../types';
import { getFileUrl, fetchFileContent, canPreviewFile } from '../../services/fileService';
import './FilePreview.css';

interface FilePreviewProps {
  file: PrivateFile | null;
  onClose: () => void;
}

type PreviewPhase = 'loading' | 'ready' | 'error';

export default function FilePreview({ file, onClose }: FilePreviewProps) {
  const [url, setUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [phase, setPhase] = useState<PreviewPhase>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;

    let active = true;
    setPhase('loading');
    setError('');
    setUrl('');
    setTextContent('');

    const load = async () => {
      try {
        const mime = file.mimeType;

        // Text-based files: fetch content for inline rendering
        if (mime.startsWith('text/') || mime === 'application/json') {
          const b64 = await fetchFileContent(file.name, file.identifier);
          if (!active) return;
          const decoded = atob(b64);
          setTextContent(decoded);
          setPhase('ready');
          return;
        }

        // Media + PDF: resolve a renderable URL
        if (canPreviewFile(mime)) {
          const resolvedUrl = await getFileUrl(file.name, file.identifier);
          if (!active) return;
          setUrl(resolvedUrl);
          setPhase('ready');
          return;
        }

        setError('This file type cannot be previewed.');
        setPhase('error');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load preview.');
        setPhase('error');
      }
    };

    void load();
    return () => { active = false; };
  }, [file]);

  if (!file) return null;

  const renderPreview = () => {
    const mime = file.mimeType;

    if (phase === 'loading') {
      return (
        <div className="preview__loading">
          <Loader2 size={32} className="preview__spinner" />
          <span>Loading preview...</span>
        </div>
      );
    }

    if (phase === 'error') {
      return (
        <div className="preview__error">
          <EyeOff size={32} strokeWidth={1.5} />
          <span>{error}</span>
        </div>
      );
    }

    // Image
    if (mime.startsWith('image/') && url) {
      return (
        <div className="preview__image-wrap">
          <img src={url} alt={file.fileName} className="preview__image" />
        </div>
      );
    }

    // Video
    if (mime.startsWith('video/') && url) {
      return (
        <video
          controls
          preload="metadata"
          src={url}
          className="preview__video"
        />
      );
    }

    // Audio
    if (mime.startsWith('audio/') && url) {
      return (
        <div className="preview__audio-wrap">
          <div className="preview__audio-icon">
            <FileText size={48} strokeWidth={1} />
          </div>
          <p className="preview__audio-name">{file.fileName}</p>
          <audio controls preload="metadata" src={url} className="preview__audio" />
        </div>
      );
    }

    // PDF
    if (mime === 'application/pdf' && url) {
      return (
        <iframe
          src={url}
          title={file.fileName}
          className="preview__pdf"
        />
      );
    }

    // Text / JSON
    if (textContent) {
      const isJson = mime === 'application/json';
      const displayContent = isJson
        ? (() => { try { return JSON.stringify(JSON.parse(textContent), null, 2); } catch { return textContent; } })()
        : textContent;

      return (
        <pre className="preview__text">{displayContent}</pre>
      );
    }

    return null;
  };

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview" onClick={(e) => e.stopPropagation()}>
        <div className="preview__header">
          <h2 className="preview__title">{file.fileName}</h2>
          <div className="preview__meta">
            <span>{file.mimeType}</span>
            <button
              className="preview__close"
              onClick={onClose}
              type="button"
              aria-label="Close preview"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="preview__body">
          {renderPreview()}
        </div>
      </div>
    </div>
  );
}
