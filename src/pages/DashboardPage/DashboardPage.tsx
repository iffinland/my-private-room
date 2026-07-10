import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Upload,
  LogOut,
  Grid3X3,
  List,
  Filter,
  X,
  Loader2,
  FileText,
  Image,
  Video,
  Music,
  Archive,
  File,
  Trash2,
  Download,
  Sun,
  Moon,
  Eye,
  Share2,
  StickyNote,
} from 'lucide-react';
import type { QortiumAccount, PrivateFile } from '../../types';
import { searchMyFiles, deleteFile, fetchFileContent, canPreviewFile, FILE_CATEGORIES } from '../../services/fileService';
import { isAccountReady } from '../../services/qortium/accountService';
import { useTheme } from '../../context/ThemeContext';
import FilePublish from '../../components/FilePublish/FilePublish';
import FilePreview from '../../components/FilePreview/FilePreview';
import './DashboardPage.css';

interface DashboardPageProps {
  account: QortiumAccount | null;
  onLogout: () => void;
}

type ViewMode = 'grid' | 'list';

const CATEGORY_ICONS: Record<string, typeof FileText> = {
  document: FileText,
  image: Image,
  video: Video,
  audio: Music,
  archive: Archive,
  other: File,
};

export default function DashboardPage({ account, onLogout }: DashboardPageProps) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PrivateFile | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [noteFile, setNoteFile] = useState<PrivateFile | null>(null);

  const ownerName = account?.names?.[0] ?? account?.name ?? '';

  // Clipboard copy with execCommand fallback (more reliable in sandboxed iframes)
  const copyText = useCallback(async (value: string): Promise<boolean> => {
    // Try execCommand first — works in sandboxed QDN iframes where clipboard API may be blocked
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', 'readonly');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const cmdOk = document.execCommand('copy');
    textarea.remove();
    if (cmdOk) return true;

    // Fallback: modern clipboard API
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }, []);

  const handleShare = useCallback(async (file: PrivateFile) => {
    const qdnLink = `qdn://FILE/${encodeURIComponent(file.name)}/${encodeURIComponent(file.identifier)}`;
    const ok = await copyText(qdnLink);
    if (ok) {
      setCopiedId(file.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, [copyText]);

  const loadFiles = useCallback(async () => {
    if (!ownerName) return;

    setIsLoading(true);
    setError('');

    try {
      const result = await searchMyFiles(ownerName);
      setFiles(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files.');
    } finally {
      setIsLoading(false);
    }
  }, [ownerName]);

  useEffect(() => {
    if (!isAccountReady(account)) {
      navigate('/');
      return;
    }
    loadFiles();
  }, [account, navigate, loadFiles]);

  const handleDelete = useCallback(async (identifier: string) => {
    if (!ownerName) return;

    try {
      await deleteFile(ownerName, identifier);
      setFiles((prev) => prev.filter((f) => f.identifier !== identifier));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file.');
    } finally {
      setDeleteTarget(null);
    }
  }, [ownerName]);

  const handlePublishComplete = useCallback(() => {
    setIsPublishOpen(false);
    loadFiles();
  }, [loadFiles]);

  /* Filter files by search + category */
  const filteredFiles = useMemo(() => {
    let result = files;

    if (selectedCategory) {
      result = result.filter((f) => f.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.fileName.toLowerCase().includes(q) ||
          f.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [files, searchQuery, selectedCategory]);

  const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard__header">
        <div className="dashboard__header-left">
          <h1 className="dashboard__logo">My File Office</h1>
          {account && (
            <span className="dashboard__account-badge" title={account.address}>
              {account.name || account.address.slice(0, 8) + '…'}
            </span>
          )}
        </div>

        <div className="dashboard__header-right">
          <button
            className="dashboard__icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            type="button"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            className="dashboard__icon-btn"
            onClick={() => setIsPublishOpen(true)}
            title="Publish file"
            type="button"
          >
            <Upload size={20} />
          </button>
          <button
            className="dashboard__icon-btn dashboard__logout-btn"
            onClick={onLogout}
            title="Lock room"
            type="button"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="dashboard__toolbar">
        <div className="dashboard__search">
          <Search size={18} className="dashboard__search-icon" />
          <input
            type="text"
            className="dashboard__search-input"
            placeholder="Search files by name or tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="dashboard__search-clear"
              onClick={() => setSearchQuery('')}
              type="button"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="dashboard__toolbar-actions">
          {/* Category filter */}
          <div className="dashboard__categories">
            <button
              className={`dashboard__cat-btn${selectedCategory === null ? ' dashboard__cat-btn--active' : ''}`}
              onClick={() => setSelectedCategory(null)}
              type="button"
            >
              <Filter size={16} />
              All
            </button>
            {FILE_CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.id] || File;
              return (
                <button
                  key={cat.id}
                  className={`dashboard__cat-btn${selectedCategory === cat.id ? ' dashboard__cat-btn--active' : ''}`}
                  onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                  type="button"
                >
                  <Icon size={16} />
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* View toggle */}
          <div className="dashboard__view-toggle">
            <button
              className={`dashboard__icon-btn-sm${viewMode === 'grid' ? ' dashboard__icon-btn-sm--active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid view"
              type="button"
            >
              <Grid3X3 size={18} />
            </button>
            <button
              className={`dashboard__icon-btn-sm${viewMode === 'list' ? ' dashboard__icon-btn-sm--active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              type="button"
            >
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="dashboard__main">
        {error && (
          <div className="dashboard__error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} type="button" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="dashboard__loading">
            <Loader2 size={32} className="dashboard__spinner" />
            <span>Loading your files...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="dashboard__empty">
            <File size={48} strokeWidth={1} />
            <h2>Your room is empty</h2>
            <p>Publish your first file to get started.</p>
            <button
              className="dashboard__empty-btn"
              onClick={() => setIsPublishOpen(true)}
              type="button"
            >
              <Upload size={18} />
              Publish File
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="dashboard__grid">
            {filteredFiles.map((file) => {
              const Icon = CATEGORY_ICONS[file.category] || File;
              return (
                <div
                  key={file.id}
                  className="dashboard__file-card"
                  title={file.fileName}
                >
                  <div className="dashboard__file-card-icon">
                    <Icon size={36} strokeWidth={1.5} />
                  </div>
                  <div className="dashboard__file-card-info">
                    <span className="dashboard__file-card-name">{file.fileName}</span>
                    <span className="dashboard__file-card-meta">
                      {formatSize(file.sizeBytes)} · {formatDate(file.uploadedAt)}
                    </span>
                    {file.tags.length > 0 && (
                      <div className="dashboard__file-card-tags">
                        {file.tags.map((tag) => (
                          <span key={tag} className="dashboard__tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="dashboard__file-card-actions">
                    {canPreviewFile(file.mimeType) && (
                      <button
                        className="dashboard__icon-btn-sm"
                        title="Preview"
                        type="button"
                        onClick={() => setPreviewFile(file)}
                      >
                        <Eye size={16} />
                      </button>
                    )}
                    {file.description && (
                      <button
                        className="dashboard__icon-btn-sm"
                        title="View notes"
                        type="button"
                        onClick={() => setNoteFile(file)}
                      >
                        <StickyNote size={16} />
                      </button>
                    )}
                    <button
                      className="dashboard__icon-btn-sm"
                      title={copiedId === file.id ? 'Copied!' : 'Share link'}
                      type="button"
                      onClick={() => void handleShare(file)}
                    >
                      <Share2 size={16} />
                    </button>
                    {copiedId === file.id && (
                      <span className="dashboard__copied-badge">Copied!</span>
                    )}
                    <button
                      className="dashboard__icon-btn-sm"
                      title="Download"
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            const b64 = await fetchFileContent(ownerName, file.identifier);
                            const byteChars = atob(b64);
                            const bytes = new Uint8Array(byteChars.length);
                            for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
                            const blob = new Blob([bytes], { type: file.mimeType });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = file.fileName;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch { /* ignore */ }
                        })();
                      }}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="dashboard__icon-btn-sm dashboard__icon-btn-sm--danger"
                      title="Delete"
                      type="button"
                      onClick={() => setDeleteTarget(file.identifier)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dashboard__list">
            <div className="dashboard__list-header">
              <span className="dashboard__list-header-name">Name</span>
              <span className="dashboard__list-header-category">Category</span>
              <span className="dashboard__list-header-size">Size</span>
              <span className="dashboard__list-header-date">Date</span>
              <span className="dashboard__list-header-actions">Actions</span>
            </div>
            {filteredFiles.map((file) => {
              const Icon = CATEGORY_ICONS[file.category] || File;
              const catLabel = FILE_CATEGORIES.find((c) => c.id === file.category)?.label || file.category;
              return (
                <div key={file.id} className="dashboard__list-row">
                  <span className="dashboard__list-row-name">
                    <Icon size={18} strokeWidth={1.5} />
                    {file.fileName}
                  </span>
                  <span className="dashboard__list-row-category">{catLabel}</span>
                  <span className="dashboard__list-row-size">{formatSize(file.sizeBytes)}</span>
                  <span className="dashboard__list-row-date">{formatDate(file.uploadedAt)}</span>
                  <span className="dashboard__list-row-actions">
                    {canPreviewFile(file.mimeType) && (
                      <button
                        className="dashboard__icon-btn-sm"
                        title="Preview"
                        type="button"
                        onClick={() => setPreviewFile(file)}
                      >
                        <Eye size={16} />
                      </button>
                    )}
                    {file.description && (
                      <button
                        className="dashboard__icon-btn-sm"
                        title="View notes"
                        type="button"
                        onClick={() => setNoteFile(file)}
                      >
                        <StickyNote size={16} />
                      </button>
                    )}
                    <button
                      className="dashboard__icon-btn-sm"
                      title={copiedId === file.id ? 'Copied!' : 'Share link'}
                      type="button"
                      onClick={() => void handleShare(file)}
                    >
                      <Share2 size={16} />
                    </button>
                    {copiedId === file.id && (
                      <span className="dashboard__copied-badge">Copied!</span>
                    )}
                    <button
                      className="dashboard__icon-btn-sm"
                      title="Download"
                      type="button"
                      onClick={() => {
                        void (async () => {
                          try {
                            const b64 = await fetchFileContent(ownerName, file.identifier);
                            const byteChars = atob(b64);
                            const bytes = new Uint8Array(byteChars.length);
                            for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
                            const blob = new Blob([bytes], { type: file.mimeType });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = file.fileName;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch { /* ignore */ }
                        })();
                      }}
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className="dashboard__icon-btn-sm dashboard__icon-btn-sm--danger"
                      title="Delete"
                      type="button"
                      onClick={() => setDeleteTarget(file.identifier)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Publish modal */}
      {isPublishOpen && (
        <FilePublish
          ownerName={ownerName}
          onClose={() => setIsPublishOpen(false)}
          onComplete={handlePublishComplete}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="dashboard__modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="dashboard__modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete File</h3>
            <p>Are you sure you want to delete this file? This action cannot be undone.</p>
            <div className="dashboard__modal-actions">
              <button
                className="dashboard__modal-btn dashboard__modal-btn--cancel"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="dashboard__modal-btn dashboard__modal-btn--danger"
                onClick={() => handleDelete(deleteTarget)}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File preview modal */}
      <FilePreview
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {/* Notes viewer modal */}
      {noteFile && (
        <div className="dashboard__modal-overlay" onClick={() => setNoteFile(null)}>
          <div className="dashboard__modal" onClick={(e) => e.stopPropagation()}>
            <div className="publish__header">
              <h3>Notes — {noteFile.fileName}</h3>
              <button className="dashboard__icon-btn-sm" onClick={() => setNoteFile(null)} type="button" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '1rem 0', whiteSpace: 'pre-wrap', lineHeight: 1.65, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              {noteFile.description}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
