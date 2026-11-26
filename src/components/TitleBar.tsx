import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { api, desktop } from '../api';
import type { WindowControl, WindowState } from '../types';

export function TitleBar({ busy, onClose, onControl, onError, title = 'Kopler' }: {
  busy: boolean; onClose: () => void; onControl: (action: WindowControl) => void; onError: (error: unknown) => void; title?: string;
}) {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true });
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const unlisten = api.onWindowState(next => { if (alive) setState(next); });
    void api.windowState().then(next => { if (alive) setState(next); }).catch(onError);
    void unlisten.catch(onError);
    return () => { alive = false; void unlisten.then(stop => stop()).catch(() => {}); };
  }, [onError]);
  return <header className={`titlebar${state.focused ? '' : ' titlebar-inactive'}`} role="banner" aria-label="Window title bar">
    <div className="titlebar-drag" data-tauri-drag-region={busy ? 'false' : 'deep'}><span>{title}</span></div>
    <div className="window-controls">
      <button type="button" aria-label="Minimize window" title="Minimize" disabled={busy || !desktop} onClick={() => onControl('minimize')}><Minus size={14} /></button>
      <button type="button" aria-label={state.maximized ? 'Restore window' : 'Maximize window'} title={state.maximized ? 'Restore' : 'Maximize'} disabled={busy || !desktop} onClick={() => onControl('toggle-maximize')}>{state.maximized ? <Copy size={12} /> : <Square size={12} />}</button>
      <button type="button" className="window-close" aria-label="Close window" title="Close" disabled={busy || !desktop} onClick={onClose}><X size={15} /></button>
    </div>
  </header>;
}
