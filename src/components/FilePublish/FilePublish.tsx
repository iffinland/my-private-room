import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  Loader2,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { FILE_CATEGORIES, guessCategory } from '../../services/fileService';
import {
  publishFile,
  PublishError,
  type PublishProgressStage,
  type PublishedFileResult,
} from '../../services/publishService';
import {
  generateThumbnail,
  normalizeCustomThumbnail,
  type GeneratedThumbnail,
} from '../../services/thumbnailService';
import { htmlToPlainText, sanitizeRichText } from '../../lib/sanitizeHtml';
import { MAX_DESCRIPTION_TEXT } from '../../services/descriptionService';
import RichTextEditor from '../RichTextEditor/RichTextEditor';
import './FilePublish.css';

interface FilePublishProps {
  ownerName: string;
  onClose: () => void;
  onComplete: () => void;
}

type PublishPhase = 'idle' | 'selecting' | 'publishing' | 'done' | 'error';
type ThumbnailPhase = 'idle' | 'generating' | 'ready' | 'error';

interface PendingFile {
  file: File;
  category: string;
  tags: string[];
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const thumbnailSourceLabel = (thumbnail: GeneratedThumbnail | null, custom: boolean): string => {
  if (!thumbnail) return '';
  if (custom) return 'Custom thumbnail';
  switch (thumbnail.source) {
    case 'image':
      return 'Generated from image';
    case 'video':
      return 'Generated from video frame';
    case 'text':
      return 'Generated from text content';
    case 'pdf':
      return 'Generated from PDF page 1';
    default:
      return 'Thumbnail';
  }
};

export default function FilePublish({ ownerName, onClose, onComplete }: FilePublishProps) {
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState<{ stage: PublishProgressStage | ''; message: string }>({
    stage: '',
    message: '',
  });
  const [result, setResult] = useState<PublishedFileResult | null>(null);

  const [thumbnail, setThumbnail] = useState<GeneratedThumbnail | null>(null);
  const [thumbnailPhase, setThumbnailPhase] = useState<ThumbnailPhase>('idle');
  const [thumbnailError, setThumbnailError] = useState('');
  const [thumbnailIsCustom, setThumbnailIsCustom] = useState(false);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const customThumbnailInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const generationRef = useRef(0);

  // Create and always revoke one object URL per selected/generated thumbnail.
  useEffect(() => {
    if (!thumbnail) {
      setThumbnailPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(thumbnail.blob);
    setThumbnailPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnail]);

  const autoGenerateThumbnail = useCallback(async (file: File) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setThumbnailIsCustom(false);
    setThumbnailPhase('generating');
    setThumbnailError('');
    setThumbnail(null);

    const generated = await generateThumbnail(file);
    // A newer file/custom selection invalidates this result.
    if (generationRef.current !== generation) return;

    if (generated.ok) {
      setThumbnail(generated.thumbnail);
      setThumbnailPhase('ready');
    } else {
      setThumbnail(null);
      setThumbnailPhase('error');
      setThumbnailError(generated.reason);
    }
  }, []);

  const handleFileSelected = useCallback(
    (file: File) => {
      const category = guessCategory(file.type);
      setPendingFile({ file, category, tags: [] });
      setPhase('selecting');
      setError('');
      setResult(null);
      setDescription('');
      void autoGenerateThumbnail(file);
    },
    [autoGenerateThumbnail],
  );

  const handleCustomThumbnail = useCallback(
    async (file: File) => {
      generationRef.current += 1;
      setThumbnailPhase('generating');
      setThumbnailError('');
      const normalized = await normalizeCustomThumbnail(file);
      if (normalized.ok) {
        setThumbnailIsCustom(true);
        setThumbnail(normalized.thumbnail);
        setThumbnailPhase('ready');
      } else {
        setThumbnailPhase(thumbnail ? 'ready' : 'error');
        setThumbnailError(normalized.reason);
      }
    },
    [thumbnail],
  );

  const handlePublish = useCallback(async () => {
    if (!pendingFile) return;

    setPhase('publishing');
    setError('');
    setResult(null);
    setProgress({ stage: 'preparing', message: 'Preparing description and thumbnail…' });

    try {
      const published = await publishFile({
        file: pendingFile.file,
        ownerName,
        categoryId: pendingFile.category,
        tags: pendingFile.tags,
        descriptionHtml: description,
        thumbnail,
        onProgress: (stage, message) => setProgress({ stage, message }),
      });
      setResult(published);
      setPhase('done');
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Publish failed.';
      setError(message);
      setPhase('error');
    }
  }, [description, ownerName, pendingFile, thumbnail]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files[0];
      if (file) handleFileSelected(file);
    },
    [handleFileSelected],
  );

  const descriptionLength = htmlToPlainText(sanitizeRichText(description)).length;
  const descriptionTooLong = descriptionLength > MAX_DESCRIPTION_TEXT;
  const previewBusy = thumbnailPhase === 'generating';
  const publishDisabled = descriptionTooLong || previewBusy;

  const resetForAnotherFile = () => {
    generationRef.current += 1;
    setPendingFile(null);
    setDescription('');
    setThumbnail(null);
    setThumbnailPhase('idle');
    setThumbnailError('');
    setThumbnailIsCustom(false);
    setPhase('idle');
    setError('');
    setResult(null);
    setProgress({ stage: '', message: '' });
  };

  return (
    <div className="publish-overlay" onClick={onClose}>
      <div className="publish" onClick={(event) => event.stopPropagation()}>
        <div className="publish__header">
          <h2>Publish File</h2>
          <button className="publish__close" onClick={onClose} type="button" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {phase === 'idle' && (
          <div
            ref={dropRef}
            className={`publish__dropzone${isDragging ? ' publish__dropzone--active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
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
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleFileSelected(file);
                event.target.value = '';
              }}
            />
          </div>
        )}

        {(phase === 'selecting' || phase === 'error') && pendingFile && (
          <div className="publish__details">
            <div className="publish__file-info">
              <FileText size={28} strokeWidth={1.5} />
              <div>
                <strong>{pendingFile.file.name}</strong>
                <span>
                  {formatSize(pendingFile.file.size)} — {pendingFile.file.type || 'unknown'}
                </span>
              </div>
              <button className="publish__link-btn" type="button" onClick={resetForAnotherFile}>
                Change
              </button>
            </div>

            {ownerName ? (
              <p className="publish__publisher">
                Publishing as <strong>{ownerName}</strong> — QDN resources are public.
              </p>
            ) : (
              <div className="publish__error" role="alert">
                <AlertTriangle size={16} />
                <span>Select a Qortium account with a registered name before publishing.</span>
              </div>
            )}

            <div className="publish__field">
              <label htmlFor="publish-category">Category</label>
              <select
                id="publish-category"
                value={pendingFile.category}
                onChange={(event) =>
                  setPendingFile({ ...pendingFile, category: event.target.value })
                }
              >
                {FILE_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="publish__field">
              <span className="publish__field-label">
                Description <span className="publish__optional">(optional)</span>
              </span>
              <RichTextEditor
                value={description}
                onChange={setDescription}
                label="File description"
                placeholder="Add a description — bold, italic, lists and links are supported…"
                maxLength={MAX_DESCRIPTION_TEXT}
              />
              {descriptionTooLong && (
                <span className="publish__field-error" role="alert">
                  Description is too long. Shorten it before publishing.
                </span>
              )}
            </div>

            <div className="publish__field">
              <span className="publish__field-label">
                Thumbnail <span className="publish__optional">(optional)</span>
              </span>
              <div className="publish__thumb">
                <div className="publish__thumb-preview" aria-live="polite">
                  {previewBusy ? (
                    <div className="publish__thumb-state">
                      <Loader2 size={22} className="publish__spinner" />
                      <span>Generating preview…</span>
                    </div>
                  ) : thumbnail && thumbnailPreviewUrl ? (
                    <img src={thumbnailPreviewUrl} alt="Selected file thumbnail preview" />
                  ) : (
                    <div className="publish__thumb-state publish__thumb-state--empty">
                      <ImageIcon size={24} strokeWidth={1.5} />
                      <span>No thumbnail — a file-type icon will be shown.</span>
                    </div>
                  )}
                </div>
                <div className="publish__thumb-controls">
                  <p className="publish__thumb-caption">
                    {thumbnailIsCustom
                      ? thumbnailSourceLabel(thumbnail, true)
                      : thumbnail
                        ? thumbnailSourceLabel(thumbnail, false)
                        : 'Generated in your browser. Nothing is rendered on a server.'}
                  </p>
                  {thumbnailError && !previewBusy && (
                    <span className="publish__field-error" role="status">
                      {thumbnailError}
                    </span>
                  )}
                  <div className="publish__thumb-actions">
                    <button
                      type="button"
                      className="publish__btn publish__btn--small"
                      onClick={() => customThumbnailInputRef.current?.click()}
                    >
                      <ImageIcon size={14} />
                      Choose custom
                    </button>
                    <button
                      type="button"
                      className="publish__btn publish__btn--small"
                      onClick={() => void autoGenerateThumbnail(pendingFile.file)}
                      disabled={previewBusy}
                    >
                      <RefreshCw size={14} />
                      Auto
                    </button>
                  </div>
                  <input
                    ref={customThumbnailInputRef}
                    type="file"
                    accept="image/*"
                    className="publish__file-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleCustomThumbnail(file);
                      event.target.value = '';
                    }}
                  />
                  <span className="publish__thumb-hint">
                    Images are auto-scaled to at most 512×384 and 300 KB. Video frames, text
                    excerpts and PDF page 1 are supported when the browser can decode them.
                  </span>
                </div>
              </div>
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
              <button
                className="publish__btn publish__btn--primary"
                onClick={() => void handlePublish()}
                type="button"
                disabled={publishDisabled || !ownerName.trim()}
              >
                <Upload size={16} />
                Publish to QDN
              </button>
            </div>
          </div>
        )}

        {phase === 'publishing' && pendingFile && (
          <div className="publish__progress" aria-live="polite">
            <Loader2 size={40} className="publish__spinner" />
            <strong>{progress.message || 'Publishing to QDN…'}</strong>
            <span>{pendingFile.file.name}</span>
            <p>
              Approve the request in Qortium Home. The file{thumbnail ? ', thumbnail' : ''}
              {description.trim() ? ' and description' : ''} are published together when Home
              supports batched publishing.
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="publish__done" aria-live="polite">
            <CheckCircle2 size={48} strokeWidth={1.5} />
            <strong>File published</strong>
            <p>
              {result?.identifier ?? 'The file'} is now available in your room.
              {result && result.approvals > 1
                ? ` Home asked for ${result.approvals} approvals.`
                : ''}
            </p>
            {result && result.warnings.length > 0 && (
              <div className="publish__warnings" role="status">
                <Sparkles size={16} />
                <div>
                  <strong>Published with warnings</strong>
                  <ul>
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            <button
              className="publish__btn publish__btn--primary"
              onClick={() => {
                setPhase('idle');
                setPendingFile(null);
                setResult(null);
                onComplete();
              }}
              type="button"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
