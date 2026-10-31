import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { getThumbnailUrl } from '../../services/fileService';
import './FileThumbnail.css';

interface FileThumbnailProps {
  ownerName: string;
  identifier: string;
  fileName: string;
  FallbackIcon: LucideIcon;
  variant?: 'card' | 'row';
}

/**
 * Resolve a file's published THUMBNAIL resource, falling back to its
 * file-type icon. Missing thumbnails are cached in fileService, so legacy
 * files do not request the same absent resource on every render.
 */
export default function FileThumbnail({
  ownerName,
  identifier,
  fileName,
  FallbackIcon,
  variant = 'card',
}: FileThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setUrl(null);

    void getThumbnailUrl(ownerName, identifier).then((resolved) => {
      if (!active) return;
      setUrl(resolved);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [ownerName, identifier]);

  return (
    <div
      className={`file-thumb file-thumb--${variant}${url ? ' file-thumb--image' : ''}`}
      aria-hidden="true"
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setUrl(null)}
        />
      ) : (
        <div className={`file-thumb__fallback${isLoading ? ' file-thumb__fallback--loading' : ''}`}>
          <FallbackIcon size={variant === 'card' ? 40 : 18} strokeWidth={1.5} />
        </div>
      )}
      <span className="file-thumb__label">{fileName}</span>
    </div>
  );
}
