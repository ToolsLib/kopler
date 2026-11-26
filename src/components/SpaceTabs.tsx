import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { FolderOpen, Inbox, Pencil, Trash2 } from 'lucide-react';
import type { Project } from '../types';

export const spaceTabId = (id: string | null) => `space-tab-${id ?? 'inbox'}`;

export function SpaceTabs({ projects, selectedId, selectedCount, busy, onSelect, onManage, onRemove }: {
  projects: Project[]; selectedId: string | null; selectedCount: number; busy: boolean; onSelect: (id: string | null) => void;
  onManage: (project: Project) => void; onRemove: (project: Project) => void;
}) {
  const tabs = [{ id: null as string | null, name: 'Inbox' }, ...projects];
  const [focusedId, setFocusedId] = useState(selectedId);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    setFocusedId(selectedId);
    buttons.current.get(spaceTabId(selectedId))?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, projects]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (busy || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    buttons.current.get(spaceTabId(tabs[next].id))?.focus();
  }

  return <div className="space-tabs" role="tablist" aria-label="Inboxes">
    {tabs.map((tab, index) => {
      const project = projects.find(project => project.id === tab.id);
      const button = <button
      key={spaceTabId(tab.id)} id={spaceTabId(tab.id)} type="button" role="tab"
      className="space-tab" aria-selected={selectedId === tab.id} aria-controls="space-panel"
      aria-label={tab.name} aria-disabled={busy} title={tab.name}
      aria-describedby={selectedId === tab.id ? `${spaceTabId(tab.id)}-count` : undefined}
      tabIndex={focusedId === tab.id ? 0 : -1}
      ref={button => { if (button) buttons.current.set(spaceTabId(tab.id), button); else buttons.current.delete(spaceTabId(tab.id)); }}
      onFocus={() => setFocusedId(tab.id)} onKeyDown={event => navigate(event, index)}
      onClick={() => { if (!busy) onSelect(tab.id); }}
      onMouseDown={event => { if (event.button === 1) event.preventDefault(); }}
      onAuxClick={event => { if (event.button === 1) { event.preventDefault(); if (!busy && project) onRemove(project); } }}
    >{tab.id === null ? <Inbox size={13} aria-hidden="true" /> : <FolderOpen size={13} aria-hidden="true" />}<span className="space-tab-label">{tab.name}</span>
      {selectedId === tab.id && <span className="count" id={`${spaceTabId(tab.id)}-count`} aria-label={`${selectedCount} matching items`}>{selectedCount}</span>}
    </button>;
      return project ? <ContextMenu.Root key={project.id}>
        <ContextMenu.Trigger asChild disabled={busy}>{button}</ContextMenu.Trigger>
        <ContextMenu.Portal><ContextMenu.Content className="project-menu" collisionPadding={8}
          onEscapeKeyDown={event => event.stopPropagation()}>
          <ContextMenu.Item className="project-menu-item" disabled={busy} onSelect={() => onManage(project)}><Pencil size={13} />Rename project</ContextMenu.Item>
          <ContextMenu.Item className="project-menu-item project-menu-danger" disabled={busy} onSelect={() => onRemove(project)}><Trash2 size={13} />Delete project</ContextMenu.Item>
        </ContextMenu.Content></ContextMenu.Portal>
      </ContextMenu.Root> : button;
    })}
  </div>;
}
