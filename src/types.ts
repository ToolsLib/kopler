export type Kind = 'note' | 'task';
export type Filter = 'active' | 'completed' | 'all';
export type Theme = 'system' | 'light' | 'dark';
export interface WindowState { maximized: boolean; focused: boolean }
export type WindowControl = 'minimize' | 'toggle-maximize';
export interface ImageRef { id: string; width: number; height: number }
export type ClipboardContent = { type: 'text'; text: string } | { type: 'image'; image: ImageRef; text?: string | null };
export interface Item {
  id: string; projectId: string | null; kind: Kind; body: string;
  completedAt: string | null; createdAt: string; updatedAt: string;
  images?: ImageRef[];
}
export interface Project { id: string; name: string; createdAt: string }
export interface Draft { body: string; kind: Kind; projectId: string | null; images?: ImageRef[] }
export interface Preferences { shortcut: string; projectId: string | null; filter: Filter; theme: Theme }
export interface Bootstrap {
  data: { projects: Project[]; draft: Draft; preferences: Preferences };
  shortcutError: string | null; wayland: boolean; trayAvailable: boolean; dataPath: string;
  appVersion: string; canInstallUpdates: boolean; autoUpdateCheck: boolean;
}
export interface AvailableUpdate { version: string; notes: string | null }
export interface UpdateProgress { stage: 'downloading' | 'verifying' | 'installing' | 'restarting'; downloaded: number; total: number | null }
export interface Page { items: Item[]; total: number }
export interface Query { projectId: string | null; allProjects: boolean; filter: Filter; search: string; offset: number }
export interface ItemInput { body: string; kind: Kind; projectId: string | null; images?: ImageRef[] }
