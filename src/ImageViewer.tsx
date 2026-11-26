import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Maximize, Minus, Plus } from 'lucide-react';
import { api } from './api';
import { TitleBar } from './components/TitleBar';
import type { ImageRef, Theme } from './types';

const clamp = (value: number) => Math.max(0.05, Math.min(16, value));
export function ImageViewer({ imageId }: { imageId: string }) {
  const [image, setImage] = useState<ImageRef | null>(null);
  const [source, setSource] = useState('');
  const [theme, setTheme] = useState<Theme>('system');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState<number | null>(null);
  const pane = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const anchor = useRef<{ x: number; y: number; previous: number } | null>(null);
  const report = useCallback((error: unknown) => setError(String(error)), []);
  const close = useCallback(() => { void api.closeImageViewer().catch(report); }, [report]);
  const fit = image ? Math.min(1, (size.width - 32) / image.width, (size.height - 32) / image.height) : 1;
  const scale = zoom ?? Math.max(0.01, fit);
  const changeZoom = useCallback((next: number | null, x?: number, y?: number) => {
    const element = pane.current;
    if (element) anchor.current = { x: x ?? element.clientWidth / 2, y: y ?? element.clientHeight / 2, previous: scale };
    setZoom(next === null ? null : clamp(next));
  }, [scale]);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.imageViewerInfo(imageId), api.image(imageId, false)]).then(([info, data]) => {
      if (alive) { setImage(info.image); setTheme(info.theme); setSource(data); }
    }).catch(error => { if (alive) report(error); });
    const stop = api.onAppearance(next => { if (alive) setTheme(next); });
    void stop.catch(report);
    return () => { alive = false; void stop.then(stop => stop()).catch(() => {}); };
  }, [imageId, report]);
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? system.matches ? 'dark' : 'light' : theme; };
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const element = pane.current!;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = pane.current;
    const point = anchor.current;
    anchor.current = null;
    if (!element || !image || !point) return;
    const previousWidth = Math.max(size.width, image.width * point.previous);
    const previousHeight = Math.max(size.height, image.height * point.previous);
    const x = (element.scrollLeft + point.x - (previousWidth - image.width * point.previous) / 2) / point.previous;
    const y = (element.scrollTop + point.y - (previousHeight - image.height * point.previous) / 2) / point.previous;
    element.scrollLeft = x * scale + (Math.max(size.width, image.width * scale) - image.width * scale) / 2 - point.x;
    element.scrollTop = y * scale + (Math.max(size.height, image.height * scale) - image.height * scale) / 2 - point.y;
  }, [scale, image, size]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (!event.ctrlKey && !event.metaKey) return;
      if (['+', '=', '-', '0', '1'].includes(event.key)) {
        event.preventDefault();
        changeZoom(event.key === '0' ? null : event.key === '1' ? 1 : scale * (event.key === '-' ? 1 / 1.25 : 1.25));
      }
    };
    const element = pane.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      changeZoom(scale * Math.exp(-event.deltaY * 0.005), event.clientX - bounds.left, event.clientY - bounds.top);
    };
    window.addEventListener('keydown', key); element.addEventListener('wheel', wheel, { passive: false });
    return () => { window.removeEventListener('keydown', key); element.removeEventListener('wheel', wheel); };
  }, [close, changeZoom, scale]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);

  return <main className="image-viewer">
    <TitleBar title="Image · Kopler" busy={false} onClose={close} onError={report} onControl={action => { void api.windowControl(action).catch(report); }} />
    <div className="viewer-toolbar" role="toolbar" aria-label="Image controls">
      <span className="viewer-dimensions">{image ? `${image.width} × ${image.height} pixels` : 'Image'}</span>
      <button className="icon-button" aria-label="Zoom out" disabled={!image || scale <= 0.05} onClick={() => changeZoom(scale / 1.25)}><Minus size={16} /></button>
      <output aria-label="Zoom level">{Math.round(scale * 100)}%</output>
      <button className="icon-button" aria-label="Zoom in" disabled={!image || scale >= 16} onClick={() => changeZoom(scale * 1.25)}><Plus size={16} /></button>
      <button aria-label="Fit image" aria-pressed={zoom === null} disabled={!image} onClick={() => changeZoom(null)}><Maximize size={14} /> Fit</button>
      <button aria-label="Actual size" aria-pressed={zoom === 1} disabled={!image} onClick={() => changeZoom(1)}>100%</button>
      <button aria-label="Copy image" disabled={!source || copying} onClick={() => { setCopying(true); setError(''); void api.copyImage(imageId).then(() => setCopied(true)).catch(report).finally(() => setCopying(false)); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy image'}</button>
    </div>
    {error && <div role="alert" className="viewer-notice">{error}</div>}
    <div ref={pane} className="viewer-pane" aria-label="Image canvas" tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0 || !source) return;
        const element = event.currentTarget;
        pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId); element.dataset.panning = 'true'; element.focus();
      }}
      onPointerMove={event => { if (pan.current) { event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x); event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y); } }}
      onPointerUp={event => { pan.current = null; delete event.currentTarget.dataset.panning; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={event => { pan.current = null; delete event.currentTarget.dataset.panning; }}>
      {image && source ? <div className="viewer-stage" style={{ width: Math.max(size.width, image.width * scale), height: Math.max(size.height, image.height * scale) }}>
        <img src={source} alt="Attached image" draggable={false} style={{ width: image.width * scale, height: image.height * scale }} />
      </div> : <p role="status">{error ? 'Image unavailable' : 'Loading image…'}</p>}
    </div>
    <footer className="viewer-hint">Drag to pan · Ctrl/⌘ + scroll to zoom · Esc to close</footer>
  </main>;
}
