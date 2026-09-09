/**
 * Load /docs-images/* through the authenticated AS500 proxy.
 *
 * Plain <img src> cannot send X-AS500-Session, and in dev the Vite proxy on
 * :5173 does not always carry the auth cookies through to :3001 reliably.
 */

import { useEffect, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
  sessionId: string | null;
}

function isDocsImage(src: string): boolean {
  return src.startsWith('/docs-images/');
}

export default function AuthDocImage({ src, alt, className, sessionId }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(isDocsImage(src) ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isDocsImage(src)) {
      setBlobUrl(src);
      setFailed(false);
      return;
    }
    if (!sessionId) {
      setBlobUrl(null);
      setFailed(true);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setFailed(false);

    fetch(src, {
      credentials: 'include',
      headers: { 'X-AS500-Session': sessionId },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, sessionId]);

  if (failed) {
    return <span className="md-img-failed">{alt || 'Image unavailable'}</span>;
  }
  if (!blobUrl) {
    return <span className="md-img-loading">{alt ? `Loading ${alt}…` : 'Loading image…'}</span>;
  }

  return <img src={blobUrl} alt={alt || 'Document illustration'} className={className} loading="lazy" />;
}
