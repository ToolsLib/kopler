import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { ImageRef } from '../types';

export function ImagePreview({ image, full = false }: { image: ImageRef; full?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(full);
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (full) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '100px' });
    observer.observe(container.current!);
    return () => observer.disconnect();
  }, [full]);
  useEffect(() => {
    let alive = true;
    setSource(undefined); setError(false);
    if (visible) void api.image(image.id, !full).then(source => { if (alive) setSource(source); }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [image.id, full, visible]);
  return <div ref={container} className={`image-preview${full ? ' image-full' : ''}`}>
    {source ? <img src={source} alt="Attached image" onError={() => { setSource(undefined); setError(true); }} /> :
      <span className="image-placeholder">{error ? 'Image unavailable' : 'Loading image…'}</span>}
  </div>;
}
