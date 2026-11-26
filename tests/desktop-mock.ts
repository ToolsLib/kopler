import type { Page } from '@playwright/test';

// UI tests use the real invoke boundary with an isolated in-browser native adapter.
// Storage invariants and transactions are tested independently against real SQLite in Rust.
export async function desktopMock(page: Page) {
  await page.context().addInitScript(() => {
    type RecordValue = Record<string, any>;
    const saved = localStorage.getItem('test-native-state');
    const state: RecordValue = saved ? JSON.parse(saved) : {
      items: [], projects: [], draft: { body: '', kind: 'note', projectId: null },
      preferences: { shortcut: 'Ctrl+Shift+Space', projectId: null, filter: 'all', theme: 'system' },
    };
    state.images ??= {};
    let callbackId = 0;
    const callbacks = new Map<number, (payload: unknown) => void>();
    const events: Record<string, number> = {};
    const undo: Record<string, RecordValue> = {};
    const w = window as unknown as RecordValue;
    w.isTauri = true;
    w.testNative = {
      failSave: false, clipboard: 'clipboard text', clipboardImage: '', clipboardImageText: '', copied: '', copiedImage: '', copiedImages: [], finished: '',
      window: { maximized: false, focused: true, minimized: false }, windowActions: [],
      emit: (event: string, payload: unknown) => { const callback = callbacks.get(events[event]); callback?.({ event, id: events[event], payload }); },
    };
    const persist = () => localStorage.setItem('test-native-state', JSON.stringify(state));
    const timestamp = () => new Date().toISOString();
    w.__TAURI_INTERNALS__ = {
      transformCallback(callback: (payload: unknown) => void) { const id = ++callbackId; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: RecordValue = {}) {
        if (command === 'plugin:event|listen') { events[args.event] = args.handler; return args.handler; }
        if (command === 'plugin:event|unlisten' || command === 'ready') return;
        if (command === 'open_image_viewer') {
          w.testNative.viewerOptions = {width:1100,height:840,resizable:true};
          w.testNative.viewer = window.open('/?image=' + encodeURIComponent(args.id), 'image-viewer', 'popup,width=1100,height=840,resizable=yes');
          return;
        }
        if (command === 'image_viewer_info') {
          const decoded = new Image(); decoded.src = state.images[args.id]; await decoded.decode();
          return {image:{id:args.id,width:decoded.naturalWidth,height:decoded.naturalHeight},theme:state.preferences.theme};
        }
        if (command === 'close_image_viewer') { window.close(); return; }
        if (command === 'open_external_url') { w.testNative.openedUrl = args.url; return; }
        if (command === 'check_update') {
          w.testNative.updateChecks = (w.testNative.updateChecks ?? 0) + 1;
          if (w.testNative.failUpdateCheck) throw 'Network unavailable';
          return w.testNative.availableUpdate ?? JSON.parse(localStorage.getItem('test-available-update') ?? 'null');
        }
        if (command === 'install_update') {
          w.testNative.installRequests = (w.testNative.installRequests ?? 0) + 1;
          w.testNative.draftAtInstall = structuredClone(state.draft);
          w.testNative.itemsAtInstall = structuredClone(state.items);
          w.testNative.emit('update-progress',{stage:'downloading',downloaded:25,total:100});
          await new Promise(resolve => setTimeout(resolve, 30));
          if (w.testNative.failUpdateInstall) throw 'Update signature verification failed. Your data was not changed.';
          w.testNative.emit('update-progress',{stage:'installing',downloaded:0,total:null});
          w.testNative.finished = 'update'; return;
        }
        if (command === 'window_state') return w.testNative.window;
        if (command === 'window_control') {
          w.testNative.windowActions.push(args.action);
          if (args.action === 'toggle-maximize') w.testNative.window.maximized = !w.testNative.window.maximized;
          if (args.action === 'minimize') Object.assign(w.testNative.window, {minimized:true, focused:false});
          w.testNative.emit('window-state', w.testNative.window);
          return w.testNative.window;
        }
        if (command === 'bootstrap') {
          const error=localStorage.getItem('test-bootstrap-error');
          if(error) throw error;
          return { data: state, shortcutError: null, wayland: false, trayAvailable: true, dataPath: 'isolated-test-data', appVersion: '0.1.2', autoUpdateCheck: state.autoUpdateCheck ?? true, canInstallUpdates: w.testNative.canInstallUpdates !== false && localStorage.getItem('test-no-self-install') !== 'true' };
        }
        if (command === 'list_items') {
          const q = args.query;
          const filtered = state.items.filter((item: RecordValue) => (q.allProjects || item.projectId === q.projectId) && (q.filter === 'all' || (q.filter === 'completed' ? !!item.completedAt : !item.completedAt)) && item.body.toLowerCase().includes(q.search.toLowerCase())).sort((a: RecordValue, b: RecordValue) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
          return { items: filtered.slice(q.offset, q.offset + 60), total: filtered.length };
        }
        if (['copy_item', 'copy_item_text', 'copy_image'].includes(command)) {
          w.testNative.copyRequests = (w.testNative.copyRequests ?? 0) + 1;
          if (w.testNative.copyGate) await w.testNative.copyGate;
          if (w.testNative.failCopy) throw 'Could not copy. Try again.';
        }
        if (w.testNative.failSave && ['save_draft', 'update_item', 'create_item', 'delete_item', 'delete_project', 'save_view', 'set_theme', 'set_auto_update_check', 'import_images'].includes(command)) throw 'Storage is full. Your text is retained.';
        let result: unknown;
        if (command === 'save_draft') state.draft = args.draft;
        else if (command === 'save_view') Object.assign(state.preferences, { projectId: args.projectId, filter: args.filter });
        else if (command === 'create_item') {
          result = { ...args.input, id: crypto.randomUUID(), completedAt: null, createdAt: timestamp(), updatedAt: timestamp() };
          state.items.push(result); state.draft = { body: '', kind: 'note', projectId: args.input.projectId, images: [] };
        } else if (command === 'update_item') {
          const item = state.items.find((item: RecordValue) => item.id === args.id);
          Object.assign(item, args.input, { updatedAt: timestamp() }); result = item;
        } else if (command === 'complete_item') {
          const item = state.items.find((item: RecordValue) => item.id === args.id);
          item.completedAt = args.completed ? timestamp() : null; result = item;
        } else if (command === 'copy_item') {
          const item = args.input ?? state.items.find((item: RecordValue) => item.id === args.id);
          w.testNative.copied = item.body;
          w.testNative.copiedImages = (item.images ?? []).map((image: RecordValue) => state.images[image.id]);
          w.testNative.copiedImage = w.testNative.copiedImages[0] ?? '';
        }
        else if (command === 'copy_item_text') { w.testNative.copied=args.body ?? state.items.find((item: RecordValue)=>item.id===args.id).body; w.testNative.copiedImage='';w.testNative.copiedImages=[]; }
        else if (command === 'read_clipboard' || command === 'import_images') {
          if (command === 'import_images' && w.testNative.importDelay) await new Promise(resolve => setTimeout(resolve, w.testNative.importDelay));
          const dataUrls = command === 'import_images' ? args.dataUrls : w.testNative.clipboardImage ? [w.testNative.clipboardImage] : [];
          const images = [];
          for (const data of dataUrls) {
            const decoded = new Image(); decoded.src = data; await decoded.decode();
            const id = crypto.randomUUID(); state.images[id] = data;
            images.push({id,width:decoded.naturalWidth,height:decoded.naturalHeight});
          }
          result = command === 'import_images' ? images : images.length ? {type:'image',image:images[0],text:w.testNative.clipboardImageText || null} : {type:'text',text:w.testNative.clipboard};
        }
        else if (command === 'read_image') return state.images[args.id];
        else if (command === 'copy_image') { w.testNative.copiedImage = state.images[args.id]; w.testNative.copied = ''; w.testNative.copiedImages = [w.testNative.copiedImage]; }
        else if (command === 'delete_item') {
          const item = state.items.find((item: RecordValue) => item.id === args.id);
          const token = crypto.randomUUID(); undo[token] = item;
          state.items = state.items.filter((item: RecordValue) => item.id !== args.id); result = token;
        } else if (command === 'undo_delete') { state.items.push(undo[args.token]); result = undo[args.token]; delete undo[args.token]; }
        else if (command === 'create_project') { result = { id: crypto.randomUUID(), name: args.name.trim(), createdAt: timestamp() }; state.projects.push(result); }
        else if (command === 'rename_project') state.projects.find((project: RecordValue) => project.id === args.id).name = args.name;
        else if (command === 'delete_project') {
          state.projects = state.projects.filter((project: RecordValue) => project.id !== args.id);
          for (const item of state.items) if (item.projectId === args.id) item.projectId = null;
          if (state.draft.projectId === args.id) state.draft.projectId = null;
          if (state.preferences.projectId === args.id) state.preferences.projectId = null;
        } else if (command === 'finish_window_action') w.testNative.finished = args.action;
        else if (command === 'set_shortcut') state.preferences.shortcut = args.shortcut;
        else if (command === 'set_theme') state.preferences.theme = args.theme;
        else if (command === 'set_auto_update_check') state.autoUpdateCheck = args.enabled;
        else if (command === 'export_data') return state.items.length;
        else if (command === 'import_data') return null;
        else if (command !== 'open_data_directory') throw `Unknown native command: ${command}`;
        persist(); return result;
      },
    };
  });
}
