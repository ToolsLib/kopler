import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { AvailableUpdate, UpdateProgress } from '../types';

export function useUpdates(ready: boolean, automatic: boolean, busy: boolean) {
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const locked = useRef(false);
  const busyRef = useRef(busy); busyRef.current = busy;
  const check = useCallback(async () => {
    if (locked.current || busyRef.current) return;
    locked.current = true; setChecking(true); setError('');
    try { setAvailable(await api.checkUpdate()); setChecked(true); }
    catch { setError('Could not check for updates. Check your connection and try again.'); }
    finally { locked.current = false; setChecking(false); }
  }, []);
  useEffect(() => {
    if (!ready || !automatic) return;
    const initial = setTimeout(() => { void check(); }, 10_000);
    const interval = setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [ready, automatic, check]);
  useEffect(() => {
    if (!ready) return;
    const listener = api.onUpdateProgress(setProgress);
    void listener.catch(() => {});
    return () => { void listener.then(stop => stop()).catch(() => {}); };
  }, [ready]);
  const install = async () => {
    if (locked.current) throw new Error('An update check is still running. Try again shortly.');
    locked.current = true; setError(''); setProgress({ stage: 'downloading', downloaded: 0, total: null });
    try {
      await api.installUpdate();
      setProgress({ stage: 'restarting', downloaded: 0, total: null });
    } catch (error) { setProgress(null); throw error; }
    finally { locked.current = false; }
  };
  return { available, checking, checked, error, progress, check, install };
}

export function UpdateSettings({ updates, version, automatic, canInstall, busy, onAutomatic, onInstall, onError }: {
  updates: ReturnType<typeof useUpdates>; version: string; automatic: boolean; canInstall: boolean; busy: boolean;
  onAutomatic: (value: boolean) => void; onInstall: () => void; onError: (error: unknown) => void;
}) {
  const { available, checking, checked, error, progress } = updates;
  const percent = progress?.total ? Math.min(100, Math.floor(progress.downloaded * 100 / progress.total)) : undefined;
  const status = progress ? ({ downloading: 'Downloading update…', verifying: 'Verifying update…', installing: 'Installing update…', restarting: 'Restarting Kopler…' })[progress.stage]
    : checking ? 'Checking for updates…' : available ? `Kopler ${available.version} is available.` : checked && !error ? 'You’re using the latest version.' : `Kopler ${version}`;
  return <div className="settings-section updates-setting">
    <h3>Updates</h3><p role="status" aria-label="Update status" className="field-help">{status}</p>
    <label className="update-check-option"><input type="checkbox" checked={automatic} disabled={busy || !!progress} onChange={event => onAutomatic(event.target.checked)} /> Check for updates automatically</label>
    <p className="field-help">Checks GitHub on startup and every six hours. Install when you’re ready; your work is saved before restarting.</p>
    {progress && <progress aria-label="Update download progress" max={100} value={progress.stage === 'downloading' ? percent : undefined} />}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="button-row">
      <button disabled={busy || checking || !!progress} onClick={() => { void updates.check(); }}><RefreshCw size={14} /> Check for updates</button>
      {available && canInstall && <button className="primary" disabled={busy || checking || !!progress} onClick={onInstall}><ArrowDownToLine size={14} /> Install and restart</button>}
      {available && !canInstall && <button disabled={busy || !!progress} onClick={() => { void api.openUrl(`https://github.com/ToolsLib/kopler/releases/tag/v${available.version}`).catch(onError); }}>Download update</button>}
    </div>
    {available && canInstall && <p className="field-help"><button className="text-button" disabled={busy || !!progress} onClick={() => { void api.openUrl(`https://github.com/ToolsLib/kopler/releases/tag/v${available.version}`).catch(onError); }}>Release notes</button></p>}
    {available && !canInstall && <p className="field-help">In-app installation is supported by installed Windows/macOS builds and Linux AppImages. Update this build using its package.</p>}
  </div>;
}
