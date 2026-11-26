import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, CheckCheck, ChevronLeft, ChevronRight, Clipboard, Copy, FileText, FolderOpen, Inbox, Keyboard, LoaderCircle, MoreHorizontal, Pencil, Plus, Search, Settings, Trash2, X } from 'lucide-react';
import { api, desktop } from './api';
import { Dialog } from './components/Dialog';
import { SpaceTabs, spaceTabId } from './components/SpaceTabs';
import { ImagePreview } from './components/ImagePreview';
import { TitleBar } from './components/TitleBar';
import { clipboardImage, imageFileType } from './paste';
import { PendingWrites } from './writes';
import type { Bootstrap, Draft, Filter, ImageRef, Item, ItemInput, Project, Query, Theme } from './types';

type Modal = { type: 'settings' } | { type: 'project'; project?: Project } | { type: 'delete-project'; project: Project } | { type: 'delete-item'; item: Item } | { type: 'clipboard'; text: string };
const MarkdownBody = lazy(() => import('./components/MarkdownBody').then(module => ({ default: module.MarkdownBody })));
const blank: Draft = { body: '', kind: 'note', projectId: null, images: [] };
const mac = /Mac/.test(navigator.platform);
const mod = mac ? '⌘' : 'Ctrl';
const message = (error: unknown) => typeof error === 'string' ? error : error instanceof Error ? error.message : 'Something went wrong. Your unsaved changes are still here.';
const labelDate = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function App() {
  const [initial, setInitial] = useState<Bootstrap | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [allProjects, setAllProjects] = useState(false);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<(ItemInput & { id: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved');
  const [modal, setModal] = useState<Modal | null>(null);
  const [projectName, setProjectName] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [activeShortcut, setActiveShortcut] = useState('');
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('system');
  const [toast, setToast] = useState<{ text: string; undo?: string } | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const focusEdit = useRef(false);
  const pasteFocus = useRef<{ element: HTMLTextAreaElement; start: number; end: number; scroll: number } | null>(null);
  useEffect(() => {
    const pending = pasteFocus.current;
    if (busy || !pending) return;
    pasteFocus.current = null;
    if (!pending.element.isConnected) return;
    pending.element.focus({ preventScroll: true });
    pending.element.setSelectionRange(pending.start, pending.end);
    pending.element.scrollTop = pending.scroll;
  }, [busy]);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const projectDeleteCancelRef = useRef<HTMLButtonElement>(null);
  const actionLock = useRef(false);
  const requestId = useRef(0);
  const queryRef = useRef<Query>({ projectId: null, filter: 'all', allProjects: false, search: '', offset: 0 });
  queryRef.current = { projectId, filter, allProjects, search, offset };
  const writes = useRef<PendingWrites | null>(null);
  if (!writes.current) writes.current = new PendingWrites(setSaveStatus, error => setError(message(error)));

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const page = await api.list({ ...queryRef.current });
      if (id === requestId.current) {
        if (page.total && queryRef.current.offset >= page.total) {
          setOffset(Math.floor((page.total - 1) / 60) * 60);
        } else {
          setItems(page.items); setTotal(page.total);
          setSelected(old => page.items.some(item => item.id === old) ? old : page.items[0]?.id ?? null);
        }
      }
    } finally { if (id === requestId.current) setLoading(false); }
  }, []);

  const act = useCallback(async (action: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(null);
    try { await writes.current!.flush(); await action(); }
    catch (error) { setError(message(error)); }
    finally { actionLock.current = false; setBusy(false); }
  }, []);

  const windowAction = useRef<(action: 'hide' | 'quit') => void>(() => {});
  windowAction.current = action => { void act(async () => { await api.finish(action); }); };
  const windowError = useCallback((error: unknown) => setError(message(error)), []);

  useEffect(() => {
    if (!desktop) { setFatal('Run the desktop app to use your local notes. This browser preview has no access to desktop storage.'); return; }
    let alive = true;
    const actionListener = api.onAction(action => windowAction.current(action));
    const focusListener = api.onFocus(() => { if (!document.querySelector('[role="dialog"]')) captureRef.current?.focus(); });
    void api.bootstrap().then(result => {
      if (!alive) return;
      setInitial(result); setProjects(result.data.projects);
      setDraft({ ...result.data.draft, projectId: result.data.preferences.projectId });
      setProjectId(result.data.preferences.projectId); setFilter('all');
      setShortcut(result.data.preferences.shortcut); setActiveShortcut(result.data.preferences.shortcut); setShortcutError(result.shortcutError);
      setTheme(result.data.preferences.theme ?? 'system');
    }).catch(error => { if (alive) setFatal(message(error)); })
      .finally(() => { void Promise.all([actionListener, focusListener]).then(() => api.ready()).catch(error => setFatal(message(error))); });
    return () => { alive = false; void actionListener.then(stop => stop()); void focusListener.then(stop => stop()); };
  }, []);

  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; };
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    if (!initial) return;
    const timer = setTimeout(() => { void reload().catch(error => setError(message(error))); }, search ? 20 : 0);
    return () => clearTimeout(timer);
  }, [initial, projectId, filter, search, allProjects, offset, reload]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.undo ? 10_000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function keys(event: globalThis.KeyboardEvent) {
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); focusSearch.current = true; setSearchVisible(true); if (searchRef.current?.offsetParent && !searchRef.current.disabled) { searchRef.current.focus(); focusSearch.current = false; } }
      if (event.key === 'Escape') { event.preventDefault(); windowAction.current('hide'); }
    }
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, []);

  useEffect(() => {
    if (searchVisible && !busy && focusSearch.current && searchRef.current) { searchRef.current.focus(); focusSearch.current = false; }
  }, [searchVisible, busy, initial]);

  useEffect(() => {
    if (!busy && focusEdit.current && editRef.current) { editRef.current.focus(); focusEdit.current = false; }
  }, [editing?.id, busy]);

  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; }
      if (event.type === 'drop') setDraggingImages(false);
    };
    const clear = () => setDraggingImages(false);
    document.addEventListener('dragover', preventFileNavigation);
    document.addEventListener('drop', preventFileNavigation);
    window.addEventListener('dragend', clear);
    window.addEventListener('blur', clear);
    return () => {
      document.removeEventListener('dragover', preventFileNavigation);
      document.removeEventListener('drop', preventFileNavigation);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  function changeDraft(next: Draft) {
    setDraft(next);
    writes.current!.set('draft', () => api.saveDraft(next));
  }
  function changeEdit(next: ItemInput & { id: string }) {
    setEditing(next);
    writes.current!.set(`item:${next.id}`, async () => {
      const saved = await api.update(next.id, next);
      setItems(old => old.map(item => item.id === saved.id ? saved : item));
    });
  }
  function chooseView(nextProject: string | null, nextFilter: Filter = filter) {
    void act(async () => {
      setEditing(null); setProjectId(nextProject); setFilter(nextFilter); setOffset(0);
      if (nextProject !== projectId) {
        ++requestId.current;
        setItems([]); setTotal(0); setSelected(null); setLoading(true);
        changeDraft({ ...draft, projectId: nextProject });
      }
      writes.current!.set('view', () => api.saveView(nextProject, nextFilter));
    });
  }
  async function saveCapture() {
    await act(async () => {
      if (!draft.body.trim() && !draft.images?.length) { captureRef.current?.focus(); return; }
      await api.create({ ...draft, projectId });
      setDraft({ ...blank, projectId });
      setToast({ text: draft.kind === 'task' ? 'Task saved' : 'Note saved' });
      await reload(); captureRef.current?.focus();
    });
  }
  function edit(item: Item) {
    void act(async () => { focusEdit.current = true; setSelected(item.id); setEditing({ id: item.id, body: item.body, kind: item.kind, projectId: item.projectId, images: item.images ?? [] }); });
  }
  function saveEdit() {
    void act(async () => { setEditing(null); await reload(); listRef.current?.focus(); });
  }
  function copy(item: Item) {
    void act(async () => { await api.copy(item.id); setToast({ text: item.images?.length && item.body.trim() ? 'Text and images copied' : 'Copied to clipboard' }); });
  }
  function remove(item: Item) {
    void act(async () => {
      const token = await api.delete(item.id);
      if (editing?.id === item.id) setEditing(null);
      setModal(null);
      setToast({ text: 'Item deleted', undo: token }); await reload();
    });
  }
  function confirmRemove(item: Item) {
    void act(async () => { setSelected(item.id); setModal({ type: 'delete-item', item: editing?.id === item.id ? { ...item, ...editing } : item }); });
  }
  function captureClipboard() {
    void act(async () => {
      const content = await api.clipboard();
      if (content.type === 'image') {
        if ((draft.images?.length ?? 0) >= 8) throw new Error('Keep at most 8 images in one item.');
        const body = content.text ? [draft.body, content.text].filter(Boolean).join('\n') : draft.body;
        changeDraft({ ...draft, body, images: [...(draft.images ?? []), content.image] });
      }
      else if (draft.body.trim()) setModal({ type: 'clipboard', text: content.text });
      else changeDraft({ ...draft, body: content.text });
      if (captureRef.current && content.type === 'image') pasteFocus.current = { element: captureRef.current, start: captureRef.current.value.length, end: captureRef.current.value.length, scroll: captureRef.current.scrollTop };
    });
  }
  function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>, target: Draft | (ItemInput & { id: string })) {
    const files = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    const markdown = event.clipboardData.getData('text/markdown') || event.clipboardData.getData('text/x-markdown');
    if (!files.length && !markdown) return;
    event.preventDefault();
    const text = markdown || event.clipboardData.getData('text/plain');
    const element = event.currentTarget;
    const { selectionStart, selectionEnd } = element;
    const body = text ? target.body.slice(0, selectionStart) + text + target.body.slice(selectionEnd) : target.body;
    if (!files.length) {
      if ('id' in target) changeEdit({ ...target, body }); else changeDraft({ ...target, body });
      requestAnimationFrame(() => element.setSelectionRange(selectionStart + text.length, selectionStart + text.length));
      return;
    }
    const restore = { element, start: selectionStart, end: selectionEnd, scroll: element.scrollTop };
    addImageFiles(files, target, body, restore, text ? selectionStart + text.length : undefined);
  }
  function addImageFiles(files: File[], target: Draft | (ItemInput & { id: string }), body = target.body, restore?: NonNullable<typeof pasteFocus.current>, caret?: number) {
    if (actionLock.current) return;
    if (restore) pasteFocus.current = restore;
    void act(async () => {
      if (!files.length || files.some(file => !imageFileType(file))) throw new Error('Use PNG, JPEG, WebP, BMP, or GIF image files.');
      if ((target.images?.length ?? 0) + files.length > 8) throw new Error('Keep at most 8 images in one item.');
      const data = [];
      for (const file of files) data.push(await clipboardImage(file));
      const images = [...(target.images ?? []), ...await api.importImages(data)];
      if ('id' in target) changeEdit({ ...target, body, images });
      else changeDraft({ ...target, body, images });
      if (restore && caret !== undefined) pasteFocus.current = { ...restore, start: caret, end: caret };
    });
  }
  function dragImages(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = busy || !!modal ? 'none' : 'copy';
    setDraggingImages(!busy && !modal);
  }
  function dropImages(event: DragEvent<HTMLFormElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); event.stopPropagation(); setDraggingImages(false);
    if (busy || modal) return;
    addImageFiles(Array.from(event.dataTransfer.files), draft);
  }
  function imageStrip(images: ImageRef[], remove?: (id: string) => void) {
    if (!images.length) return null;
    return <div className={`image-grid${remove ? ' image-grid-editable' : ''}`}>{images.map((image,index) => <div className="image-attachment" key={image.id}>
      <button className="image-open" type="button" aria-label={`Open image ${index + 1}`} onClick={event => { event.stopPropagation(); void act(async () => { await api.openImageViewer(image.id); }); }} disabled={busy}><ImagePreview image={image} /></button>
      {remove && <button className="icon-button image-remove" type="button" aria-label={`Remove image ${index + 1}`} onClick={() => remove(image.id)} disabled={busy}><X size={12} /></button>}
    </div>)}</div>;
  }
  function openProject(project?: Project) {
    void act(async () => { setEditing(null); setProjectName(project?.name ?? ''); setModal({ type: 'project', project }); });
  }
  async function deleteProject(project: Project) {
    await api.deleteProject(project.id);
    const state = await api.bootstrap();
    const nextProject = projectId === project.id ? null : projectId;
    ++requestId.current;
    queryRef.current = { ...queryRef.current, projectId: nextProject, offset: 0 };
    setProjects(state.data.projects); setDraft(state.data.draft);
    setProjectId(nextProject); setOffset(0);
    setEditing(old => old?.projectId === project.id ? { ...old, projectId: null } : old);
    setModal(null);
    await reload();
  }
  function requestDeleteProject(project: Project) {
    void act(async () => {
      const page = await api.list({ projectId: project.id, allProjects: false, filter: 'all', search: '', offset: 0 });
      const hasDraft = draft.projectId === project.id && (!!draft.body.trim() || !!draft.images?.length);
      if (page.total || hasDraft) setModal({ type: 'delete-project', project });
      else await deleteProject(project);
    });
  }
  function saveProject(project?: Project) {
    void act(async () => {
      let created: Project | undefined;
      if (project) await api.renameProject(project.id, projectName);
      else created = await api.createProject(projectName);
      const result = await api.bootstrap();
      setProjects(result.data.projects);
      if (created) {
        const id = created.id;
        ++requestId.current;
        setProjectId(id); setFilter('all'); setSearch(''); setAllProjects(false); setOffset(0);
        setItems([]); setTotal(0); setSelected(null);
        changeDraft({ ...draft, projectId: id });
        writes.current!.set('view', () => api.saveView(id, 'all'));
      }
      setModal(null);
    });
  }
  function openSettings() {
    void act(async () => { setShortcut(activeShortcut); setModal({ type: 'settings' }); });
  }
  function listKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== listRef.current || busy) return;
    const index = items.findIndex(item => item.id === selected);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) { setSelected(next.id); document.getElementById(`item-${next.id}`)?.scrollIntoView({ block: 'nearest' }); }
    }
    const item = items[index]; if (!item) return;
    if (event.key === 'Enter') { event.preventDefault(); edit(item); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(item); }
  }

  const projectLabel = (id: string | null) => projects.find(project => project.id === id)?.name ?? 'Inbox';
  const currentProject = projects.find(project => project.id === projectId);
  const projectOptions = <><option value="">Inbox</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</>;
  const dialogError = error && <p className="dialog-error" role="alert">{error}</p>;
  const notification = toast && <div className={modal ? 'dialog-notification' : 'toast'} role="status"><Check size={14} /><span>{toast.text}</span>{toast.undo && <button onClick={() => { void act(async () => { await api.undo(toast.undo!); setToast({ text: 'Item restored' }); await reload(); }); }} disabled={busy}>Undo</button>}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={13} /></button></div>;

  const titleBar = <TitleBar busy={busy} onClose={() => windowAction.current('hide')} onControl={action => { void act(async () => { await api.windowControl(action); }); }} onError={windowError} />;
  if (fatal) return <main className="app-shell">{titleBar}<section className="recovery"><div className="brand-mark">k</div><h1>{desktop ? 'Your notes need attention' : 'A little space for your thoughts'}</h1><p role="alert">{fatal}</p>
    {desktop && <><button className="primary" onClick={() => location.reload()}>Try again</button><button onClick={() => { void api.openData().catch(error => setFatal(message(error))); }}>Open data folder</button><button onClick={() => { void api.finish('quit'); }}>Quit</button><p className="muted">Your database and migration backups stay in the data folder. Keep a copy before attempting recovery.</p></>}
  </section></main>;
  if (!initial) return <main className="app-shell">{titleBar}<section className="recovery"><LoaderCircle className="spinner" size={22} /><p>Opening your space…</p></section></main>;

  return <main className="app-shell">
    {titleBar}
    <section className="capture-section" aria-label="Quick capture">
      <div className="capture-actions"><button className="text-button" onClick={captureClipboard} disabled={busy}><Clipboard size={13} /> Capture clipboard</button></div>
      <form className={`capture-card${draggingImages ? ' drag-over' : ''}`} aria-label="Capture box"
        onDragEnter={dragImages} onDragOver={dragImages} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImages(false); }} onDrop={dropImages}
        onSubmit={event => { event.preventDefault(); void saveCapture(); }}>
        <textarea ref={captureRef} aria-label="Capture text" placeholder="An idea, a useful snippet, your next prompt…" value={draft.body} readOnly={busy} aria-busy={busy} maxLength={262144}
          onPaste={event => pasteImages(event, draft)}
          onChange={event => changeDraft({ ...draft, body: event.target.value })}
          onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void saveCapture(); } }} />
        {imageStrip(draft.images ?? [], id => changeDraft({ ...draft, images: draft.images?.filter(image => image.id !== id) }))}
        <div className="capture-toolbar"><div className="kind-toggle" aria-label="Item type"><button type="button" aria-pressed={draft.kind === 'note'} onClick={() => changeDraft({ ...draft, kind: 'note' })} disabled={busy}><FileText size={13} /> Note</button><button type="button" aria-pressed={draft.kind === 'task'} onClick={() => changeDraft({ ...draft, kind: 'task' })} disabled={busy}><CheckCheck size={13} /> Task</button></div>
          <button className="save-button" type="submit" aria-label="Save item" title={`Save (${mod}+Enter)`} disabled={busy || (!draft.body.trim() && !draft.images?.length)}><Plus size={16} /> Save</button></div>
      </form>
      <div className="capture-hint"><span><kbd>{mod}</kbd> <kbd>↵</kbd> to save</span></div>
    </section>

    <section className="collection" aria-label="Saved items">
      <div className="collection-heading">
        <SpaceTabs projects={projects} selectedId={projectId} busy={busy} onSelect={id => chooseView(id)} onManage={openProject} onRemove={requestDeleteProject} />
        <div className="project-actions"><span className="count" aria-label={`${total} matching items`}>{total}</span>
          <button className="icon-button search-toggle" aria-label="Search and filters" aria-expanded={searchVisible} aria-controls="search-filters" data-active={!!search || filter !== 'all' || allProjects} title={`${searchVisible ? 'Hide' : 'Show'} search and filters${search || filter !== 'all' || allProjects ? ' · filters active' : ''}`} onClick={() => { focusSearch.current = !searchVisible; setSearchVisible(!searchVisible); }} disabled={busy}><Search size={15} /></button>
          <button className="icon-button" aria-label="New project" title="New project" onClick={() => openProject()} disabled={busy}><Plus size={16} /></button>
          {currentProject && <button className="icon-button" aria-label="Manage project" title="Manage project" onClick={() => openProject(currentProject)} disabled={busy}><MoreHorizontal size={17} /></button>}</div></div>
      <div className="collection-panel" id="space-panel" role="tabpanel" aria-labelledby={spaceTabId(projectId)}>
      <div className="search-controls" id="search-filters" hidden={!searchVisible}>
      <div className="search-box"><Search size={15} /><input ref={searchRef} aria-label="Search items" placeholder="Find something you kept…" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} maxLength={4096} disabled={busy} />
        {search ? <button className="icon-button" aria-label="Clear search" onClick={() => { setSearch(''); setOffset(0); }}><X size={14} /></button> : <kbd>{mod} F</kbd>}</div>
      <div className="filter-row"><div className="filters" aria-label="Item filter">{(['active', 'completed', 'all'] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} onClick={() => chooseView(projectId, value)} disabled={busy}>{value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : 'All'}</button>)}</div>
        <label className="scope"><input type="checkbox" checked={allProjects} onChange={event => { setAllProjects(event.target.checked); setOffset(0); }} disabled={busy} />All projects</label></div>
      </div>

      {error && !modal && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" onClick={() => { void act(async () => { await reload(); }); }} disabled={busy}>Retry</button></div>}
      <div ref={listRef} className="item-list" role="region" aria-label="Items" tabIndex={0} onKeyDown={listKeys} aria-busy={loading}>
        {items.map(item => <article id={`item-${item.id}`} key={item.id} className={`item ${selected === item.id ? 'selected' : ''} ${item.completedAt ? 'completed' : ''}`} onClick={() => setSelected(item.id)}>
          <div className="item-topline">{item.kind === 'task' ? <button className="task-check" aria-label={item.completedAt ? 'Reopen task' : 'Complete task'} aria-pressed={!!item.completedAt} disabled={busy} onClick={() => { void act(async () => { await api.complete(item.id, !item.completedAt); await reload(); }); }}>{item.completedAt && <Check size={12} />}</button> : <FileText className="note-symbol" size={15} />}
            <span className="item-meta">{allProjects ? projectLabel(item.projectId) : item.kind === 'task' ? 'Task' : 'Note'}<span>·</span><time dateTime={item.createdAt}>{labelDate(item.createdAt)}</time></span>
            <div className="item-actions"><button className="icon-button" aria-label="Copy item" title={item.images?.length ? 'Copy text and images' : 'Copy'} disabled={busy} onClick={event => { event.stopPropagation(); copy(item); }}><Copy size={14} /></button>
              {!!item.images?.length && !!item.body.trim() && <button className="icon-button" aria-label="Copy text only" title="Copy text only" disabled={busy} onClick={event => { event.stopPropagation(); void act(async () => { await api.copyText(item.id); setToast({ text: 'Text copied' }); }); }}><FileText size={14} /></button>}
              <button className="icon-button" aria-label={editing?.id === item.id ? 'Save item changes' : 'Edit item'} title={editing?.id === item.id ? 'Save changes' : 'Edit'} disabled={busy} onClick={event => { event.stopPropagation(); if (editing?.id === item.id) saveEdit(); else edit(item); }}>{editing?.id === item.id ? <Check size={14} /> : <Pencil size={14} />}</button>
              <button className="icon-button delete-button" aria-label="Delete item" title="Delete" disabled={busy} onClick={event => { event.stopPropagation(); confirmRemove(item); }}><Trash2 size={14} /></button></div></div>
          {editing?.id === item.id ? <div className="item-editor">
            <textarea ref={editRef} aria-label="Edit item text" value={editing.body} onPaste={event => pasteImages(event, editing)} onChange={event => changeEdit({ ...editing, body: event.target.value })} readOnly={busy} aria-busy={busy} maxLength={262144} />
            {imageStrip(editing.images ?? [], id => changeEdit({ ...editing, images: editing.images?.filter(image => image.id !== id) }))}
            <div className="editor-toolbar"><select aria-label="Edit item type" value={editing.kind} onChange={event => changeEdit({ ...editing, kind: event.target.value as 'note' | 'task' })} disabled={busy}><option value="note">Note</option><option value="task">Task</option></select>
              <select aria-label="Move item to project" value={editing.projectId ?? ''} onChange={event => changeEdit({ ...editing, projectId: event.target.value || null })} disabled={busy}>{projectOptions}</select></div></div> :
            <>{imageStrip(item.images ?? [])}{item.body && <Suspense fallback={<div className="item-body">{item.body}</div>}><MarkdownBody body={item.body} onError={error => setError(message(error))} /></Suspense>}</>}
        </article>)}
        {!items.length && !loading && <div className="empty-state"><div className="empty-icon">{search ? <Search size={23} /> : <Inbox size={25} strokeWidth={1.5} />}</div><h2>{search ? 'Nothing found just yet' : filter === 'completed' ? 'A fresh start' : 'A little room to think'}</h2><p>{search ? 'Try a different phrase or search all projects.' : filter === 'completed' ? 'Your completed tasks will appear here.' : 'Save a thought above. It’ll be here when you need it.'}</p></div>}
      </div>
      {total > 60 && <div className="pagination"><span>{offset + 1}–{Math.min(offset + 60, total)} of {total}</span><button aria-label="Previous page" className="icon-button" disabled={busy || offset === 0} onClick={() => { void act(async () => { setEditing(null); setOffset(offset - 60); listRef.current?.scrollTo(0, 0); }); }}><ChevronLeft size={16} /></button><button aria-label="Next page" className="icon-button" disabled={busy || offset + 60 >= total} onClick={() => { void act(async () => { setEditing(null); setOffset(offset + 60); listRef.current?.scrollTo(0, 0); }); }}><ChevronRight size={16} /></button></div>}
      </div>
    </section>

    <footer className="app-footer">
      <span className={`save-status ${saveStatus}`} aria-live="polite">{(busy || saveStatus !== 'saved') && <><span className="status-dot" />{busy || saveStatus === 'saving' ? 'Saving…' : saveStatus === 'pending' ? 'Unsaved changes' : 'Save failed · draft retained'}</>}</span>
      <div className="footer-actions">
        <button className="shortcut-hint" onClick={openSettings} disabled={busy} title="Configure shortcut"><Keyboard size={12} /><span>{shortcutError ? 'Set shortcut' : activeShortcut.replaceAll('+', ' + ')}</span></button>
        <button className="icon-button" aria-label="Settings" title="Settings" onClick={openSettings} disabled={busy}><Settings size={15} /></button>
      </div>
    </footer>

    {!modal && notification}

    {modal?.type === 'settings' && <Dialog title="Your space, your settings" description="Everything stays on this device. No account, sync, or tracking." onClose={() => setModal(null)} busy={busy} notice={notification}>
      <fieldset className="appearance-setting" disabled={busy}><legend className="field-label">Appearance</legend><div className="appearance-options">{(['system', 'light', 'dark'] as Theme[]).map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => { void act(async () => { await api.theme(value); setTheme(value); }); }}>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</button>)}</div></fieldset>
      <form onSubmit={event => { event.preventDefault(); void act(async () => { await api.shortcut(shortcut); setActiveShortcut(shortcut.trim()); setShortcutError(null); setToast({ text: 'Shortcut updated' }); }); }}>
        <label className="field-label" htmlFor="shortcut">Global shortcut</label><div className="input-with-button"><input id="shortcut" value={shortcut} onChange={event => setShortcut(event.target.value)} disabled={busy || initial.wayland} spellCheck={false} /><button className="primary" disabled={busy || initial.wayland}>Apply</button></div>
        <p className="field-help">{shortcutError ?? 'Open from anywhere. If a shortcut is in use, your previous binding stays active.'}</p>
      </form>
      <div className="settings-section"><h3>Keep a copy</h3><p className="field-help">Export notes and projects, or merge a previous export. Conflicting imports leave your data unchanged.</p><div className="button-row"><button disabled={busy} onClick={() => { void act(async () => { const count = await api.export(); if (count !== null) setToast({ text: `Exported ${count} items` }); }); }}><ArrowUpFromLine size={14} /> Export JSON</button><button disabled={busy} onClick={() => { void act(async () => { const result = await api.import(); if (result) { const state = await api.bootstrap(); setProjects(state.data.projects); await reload(); setToast({ text: `${result.imported} imported, ${result.skipped} already present` }); } }); }}><ArrowDownToLine size={14} /> Import JSON</button></div></div>
      <div className="settings-section"><h3>Local data</h3><p className="data-path">{initial.dataPath}</p><p className="field-help">Storage and exports are not encrypted. Keep confidential credentials in a password manager.</p><button disabled={busy} onClick={() => { void act(async () => { await api.openData(); }); }}><FolderOpen size={14} /> Open data folder</button></div>
      {dialogError}<div className="dialog-footer"><span className="muted">Kopler 0.1.0 · local preview</span><button className="danger-text" disabled={busy} onClick={() => windowAction.current('quit')}>Quit Kopler</button></div>
    </Dialog>}

    {modal?.type === 'project' && <Dialog title={modal.project ? 'Manage project' : 'A new project'} description="A simple place to group notes and next steps." onClose={() => setModal(null)} busy={busy} notice={notification}>
      <form onSubmit={event => { event.preventDefault(); saveProject(modal.project); }}>
        <label className="field-label" htmlFor="project-name">Project name</label><input id="project-name" value={projectName} onChange={event => setProjectName(event.target.value)} maxLength={80} disabled={busy} autoFocus />{dialogError}
        <div className="dialog-footer">{modal.project && <button type="button" className="danger-text" disabled={busy} onClick={() => requestDeleteProject(modal.project!)}>Delete project</button>}<button type="submit" className="primary" disabled={busy || !projectName.trim()}>{modal.project ? 'Save name' : 'Create project'}</button></div>
      </form>
    </Dialog>}
    {modal?.type === 'delete-project' && <Dialog title={`Delete ${modal.project.name}?`} description="Its notes, tasks, and any unfinished draft will move to Inbox. Their contents will be kept." onClose={() => setModal(null)} busy={busy} initialFocus={projectDeleteCancelRef}>{dialogError}<div className="dialog-footer"><button ref={projectDeleteCancelRef} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="danger" disabled={busy} onClick={() => { void act(() => deleteProject(modal.project)); }}>Delete project</button></div></Dialog>}
    {modal?.type === 'delete-item' && <Dialog title={`Delete this ${modal.item.kind === 'task' ? 'task' : 'note'}?`} description="You can restore it with Undo for 10 seconds." onClose={() => setModal(null)} busy={busy} initialFocus={deleteCancelRef}>
      {dialogError}<div className="dialog-footer"><button ref={deleteCancelRef} disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="danger" disabled={busy} onClick={() => remove(modal.item)}>Delete item</button></div>
    </Dialog>}
    {modal?.type === 'clipboard' && <Dialog title="Replace this draft?" description="You already have unfinished text. Replace it with the clipboard text?" onClose={() => setModal(null)} busy={busy}><div className="dialog-footer"><button onClick={() => setModal(null)}>Keep draft</button><button className="primary" onClick={() => { changeDraft({ ...draft, body: modal.text }); setModal(null); captureRef.current?.focus(); }}>Replace with clipboard</button></div></Dialog>}
  </main>;
}
