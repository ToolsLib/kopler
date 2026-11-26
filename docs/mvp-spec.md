# Desktop capture app MVP specification

Status: Draft for implementation review  
Date: 13 November 2026  
Repository codename: Kopler  
Public name: Undecided; Sidequeue is a candidate.

Delivery update, 13 November 2026: macOS validation is deferred at the user's request. Windows is the first MVP delivery target. Linux build and X11 smoke checks remain included; native Wayland desktop validation must be reported separately. The macOS requirements below describe the later cross-platform release, rather than blocking this Windows-first delivery.

## Product and scope

A lightweight desktop companion for keeping useful text and next steps close while working across applications. Users can capture a thought, save copied text, queue a prompt or task, and retrieve it without opening a full notes workspace.

The core loop is **capture → find → copy → complete**. The primary audience is people who move between browsers, editors, terminals, and AI assistants during their work.

The agreed constraints are a Rust application core, a lightweight application, Windows as the first development target, and eventual MVP support for Windows, macOS, and Linux. This document proposes the remaining product details and performance budgets. It does not finalize the public name.

Copper is the workflow reference. The application will have its own visual identity and interaction details.

## Technical direction

| Area | MVP choice |
| --- | --- |
| Desktop shell | Tauri 2 |
| Application core | Rust owns persistence and operating-system integrations |
| Interface | React, TypeScript, and Vite; selected shadcn/ui components |
| Persistence | One local SQLite database, with schema migrations |
| Communication | Narrow, typed Tauri commands and events |
| Distribution | Installable desktop packages built on the corresponding operating systems |

Use the system webview. Keep dependencies small, render large lists incrementally, and avoid periodic background polling. The renderer has no direct filesystem or database access. There is no application server.

Keep shortcuts, clipboard access, window activation, tray behavior, and platform-specific paths behind Rust interfaces so platform differences do not spread into the UI.

## Core workflows

### Capture a thought

1. Press the configured global shortcut or open the app from the tray or launcher.
2. The compact window opens on the current display and focuses the capture field.
3. Type text and choose Note or Task. The destination is the currently selected Inbox or project; there is no separate capture destination selector.
4. Press Ctrl+Enter on Windows/Linux or Command+Enter on macOS to save.
5. The item appears in the list and the capture field clears only after persistence succeeds.

Enter inserts a newline. An item needs text or at least one image. New captures default to Note and always save into the currently selected Inbox or project. Switching projects preserves the draft text and images and changes its destination. Global search scope does not change the selected capture destination.

### Save copied text

1. Copy text in another application.
2. Open the app and choose **Capture clipboard**, or paste into the capture field normally.
3. Review or edit the text and save it.

Capture clipboard reads the current clipboard once, following an explicit action. Text fills the draft and never overwrites nonempty text without confirmation. An image appends to the draft without replacing text or other images. Empty or unsupported clipboard content produces an inline message. The app does not monitor clipboard history or read text selections in other apps.

### Keep a clipboard image

1. Copy an image or take a screenshot in another application.
2. Paste into the capture field or choose **Capture clipboard**. Normal paste also works while editing an item. Image import retains textarea focus, selection, and scroll position; mixed text/image paste places the caret after the inserted text.
3. Review its thumbnail, optionally add a caption, then save into the selected space. An image-only note or task is valid. Opening a thumbnail uses a separate resizable window, initially up to 1100 × 840, with fit, actual size, zoom, drag-to-pan, and copy controls. Escape closes only that viewer.
4. Open a thumbnail to view the original and choose **Copy image** to reuse it. The ordinary item copy action publishes text and images together: Windows receives exact Unicode text, a PNG/bitmap for the first image, and rich HTML containing all images. Mixed items also offer **Copy text only** for destinations that prioritize images over text. On macOS/Linux, mixed content uses HTML and a plain-text alternative; standalone images retain native image copying. Receiving apps choose which representations to consume; one-paste text plus image support in Codex is not guaranteed.

Image files can also be dragged onto the capture box, appending attachments without replacing existing text. Validate a batch before importing it, reject mixed unsupported files without partial attachment changes, and block file-navigation drops outside the capture box. Keep the existing image count/size limits and selected-space routing.

Support up to eight images per item/draft, with each normalized PNG limited to 8 MiB and 16 megapixels. Pasted JPEG, WebP, BMP, and GIF files become still PNG images. Use thumbnails near the viewport in lists, retain originals locally inside SQLite, and allow removal of individual attachments during capture or editing. Draft recovery, moves, completion, and Undo preserve attachments. Reject malformed or oversized images without clearing existing content. OCR, arbitrary file attachments, and rich-text editing remain outside scope.

### Reuse and complete an item

1. Browse a project or search for text.
2. Select an item and copy its complete body to the clipboard.
3. Return to the destination application and paste normally.
4. For a task, mark it complete when finished.

Copying does not complete a task. Completion is reversible. The app does not simulate typing or paste into another application.

## Functional requirements

### Window and lifecycle

- One application instance and one main window. Launching another instance activates the existing one.
- Use a custom title bar instead of OS decorations, styled to match the selected appearance. Provide a drag region, double-click maximize/restore, accessible minimize/maximize/restore/close controls, and retain edge resizing. Close follows the save-before-hide behavior. Keep controls available while loading and on the recovery screen.
- Start with a compact, resizable window, approximately 460 × 640 logical pixels, with a minimum usable size of 360 × 420.
- Dark appearance uses a neutral charcoal palette inspired by Codex: grayscale surfaces, borders, icons, and focus states, off-white primary actions, and red destructive/error feedback.
- Remember window size and position; clamp the window to a visible display after monitor changes.
- The global shortcut toggles visibility. If visible but unfocused, it activates the window instead of hiding it.
- Escape and the window close button hide the app after saving pending edits. Hide preserves drafts, selection, and scroll position.
- Keep the app running while hidden. An explicit Quit action saves pending work and exits.
- Provide tray/menu-bar actions for Open and Quit. If the desktop has no usable tray, retain a normal taskbar/dock entry and window access.
- Opening from the tray or launcher always shows the app, even when shortcut registration fails.
- Do not hide automatically on focus loss. Do not force the window to stay above other apps.
- Launch at login is outside the initial MVP.

### Notes and tasks

- Each item has a plain-text body, optional image attachments, and is either a Note or a Task.
- Allow creation, inline editing, copying, moving to another project, and deletion.
- Show a small pencil action on each item to enter editing; replace it with a checkmark to flush changes and close editing. Item text is selectable and does not enter editing on click. Omit the separate Done button. Keep the editor open on save failure, retaining changes for retry.
- Tasks can be completed and reopened. Notes have no completion state.
- Store and edit the original text, including Markdown syntax. Render saved items as Markdown with headings, lists, fenced code, tables, and web links; copying preserves the exact source for use in AI desktop apps. Accept plain-text and Markdown clipboard formats. Escape HTML and do not fetch remote Markdown images.
- Limit each item or draft to 256 KiB of UTF-8 text and eight images, project names to 80 characters, and imports to 64 MiB and 100,000 combined item/project/image records. Show validation errors without clearing the original content.
- Sort items by creation time, newest first, with a stable tie-breaker. Editing and completion do not change that order.
- Provide Active, Completed, and All filters. Active includes notes and incomplete tasks; Completed includes completed tasks only.
- Open with All selected by default, including when reopening a saved space. Keep All on the right of the filter group. Users can switch to Active or Completed during the session; completed tasks remain searchable when the current filter includes them.
- Show Delete directly on each item, including outside editing. Normal clicks require confirmation, with Cancel initially focused; Cancel or Escape preserves the item and pending edits. Ctrl-click (Command-click on macOS) bypasses confirmation for that item. Both paths flush pending edits before deleting and offer Undo for 10 seconds during the running session. Failed deletion retains the item and permits retry; the normal confirmation dialog stays open on failure. Deletion is final after the Undo interval or application exit; no Trash view is included.

### Projects and Inbox

- Inbox is the destination for unassigned items and cannot be renamed or deleted.
- Users can create, rename, and delete flat project lists.
- Show Inbox and each project as browser-style tabs above search, with a distinct active tab. Scroll the strip horizontally when the tabs do not fit, keeping add/manage controls available.
- Support Left/Right and Home/End to focus tabs, with Enter or Space to select one. Switching tabs flushes edits and preserves capture draft text.
- Creating a project immediately selects it for browsing and new captures, retains the draft text, and starts with the All filter and no search or global scope. Persist the selected project across restarts.
- Require a nonempty project name; prevent duplicate names after trimming and case folding, including the reserved Inbox name.
- Right-click a project tab for Rename/Delete, or middle-click it to remove it. Keep Inbox protected and preserve the selected space when removing a background tab.
- Empty projects are removed immediately. Projects containing saved items or an unfinished text/image draft require confirmation, regardless of search, completion filters, or global scope. Flush pending changes before checking. Move their items and draft to Inbox in the same transaction, preserving contents; initially focus Cancel in the confirmation.
- No nested projects, tags, folders, or manual item ordering.

### Search and keyboard access

- Search item bodies using case-insensitive text matching; preserve the original content.
- Search the selected project by default. Offer an explicit All projects scope, and respect the selected completion filter.
- Keep search and filter controls collapsed on startup. A toggle beside the inbox tabs reveals/hides both, with an active-filter indicator when a query, completion filter, or global scope is applied. Collapsing preserves those selections.
- Search updates as the user types, with a short debounce if needed.
- Ctrl+F or Command+F reveals and focuses search. Arrow keys move list selection when focus is in the list; Enter edits the selected item.
- Ctrl+C or Command+C copies the selected item's body when focus is in the list. Inside text fields, normal text-copy behavior applies.
- All core actions work without a mouse. Controls have accessible names and visible focus states.
- Offer System, Light, and Dark appearance in Settings, defaulting to System and persisting changes immediately. System follows live desktop appearance changes. Use readable contrast and reduced-motion preferences, and keep the interface usable with display scaling and long text.

### Shortcut settings

- Offer one configurable global shortcut to show or hide the window.
- Start with Ctrl+Shift+Space on Windows/Linux and Command+Shift+Space on macOS, subject to successful registration.
- Detect conflicts and registration errors, explain them, and allow a replacement. Retain the last working shortcut until a replacement succeeds.
- Do not intercept an existing operating-system binding or rely on double-Shift detection in the MVP.
- Do not request permission to read other applications' contents. Platform permission requests must explain the specific feature they enable.

### Saving and data ownership

- Persist saved items, projects, and preferences locally in the operating system's application-data directory.
- A new item is saved explicitly. Existing item edits autosave after approximately 300 ms of inactivity and flush before hide, quit, project switch, or opening another item.
- Show saving and error states. A failed save keeps the unsaved content visible and recoverable; do not dismiss it or clear it as if the operation succeeded.
- Preserve an unfinished capture draft across hide and clean restart. Persist draft changes with the same debounce, separately from saved items.
- Treat committed SQLite transactions as authoritative; retain completed saves after a process crash. Edits within the debounce interval may be lost on abrupt termination.
- Provide a settings action to open the data directory.
- Export all items and projects to a versioned JSON file, including task state, IDs, ordering timestamps, original text, and original PNG attachments. Image exports use format version 2; text-only exports retain version 1. Import both versions. Export excludes transient UI state, unfinished drafts, and shortcut settings.
- Import that same format atomically after validation. Merge unseen IDs, skip identical records, and reject conflicting records without partial writes. Report imported/skipped counts or the reason for rejection.
- Create a consistent database backup before a schema migration. On migration failure, preserve the original data and show a recovery action.

## Minimal data model

| Entity | Required fields |
| --- | --- |
| Item | ID, optional project ID, kind, body, image references, completion timestamp for completed tasks, creation timestamp, update timestamp |
| Image | ID, original PNG bytes, thumbnail PNG bytes, width, height |
| Project | ID, name, creation timestamp |
| Preferences | Global shortcut, appearance, last selected project, session filter state, window geometry; reopening starts with All |
| Draft | Body, kind, image references, optional destination project ID |

Use stable UUIDs and UTC timestamps. A null project ID means Inbox. Notes must have a null completion timestamp. Resolve sort ties by ID. Enforce references and invariants in Rust and the database, not only in the interface. Store the database schema version separately from the JSON export format version.

## Lightweight performance targets

These are initial engineering budgets, not measured results. Record measurements from the first packaged prototype. A missed target requires investigation or an explicit spec revision; do not silently redefine the metric.

Use a release build on a documented Windows 11 machine with at least four logical CPU cores, 8 GB RAM, and SSD storage. Benchmark with 10,000 items averaging 1 KiB of body text across 20 projects. Include the Rust process and all attributable webview child processes in memory and CPU totals.

| Metric | Initial target | Measurement |
| --- | --- | --- |
| Windows installer | At most 20 MiB | Compressed installer; report any separately downloaded WebView2 runtime size as well |
| Cold launch | At most 2 seconds at p95 | Launch request to interactive capture field, 20 launches with the app fully exited; document filesystem cache conditions |
| Warm reveal | At most 200 ms at p95 | Registered shortcut to visible, focused capture field, 30 repetitions |
| Hidden idle memory | At most 120 MiB | Sum of process-tree private working sets after 30 seconds hidden |
| Visible idle memory | At most 180 MiB | Same metric after 30 seconds showing the default list |
| Idle CPU | At most 0.2% of total machine capacity | Process-tree average across 60 seconds while hidden, with no user input |
| Search | At most 150 ms at p95 | Final keystroke to rendered results, including debounce, across 30 representative queries |

Collect corresponding macOS and Linux results before their release. Their memory metrics must be named explicitly and should not be treated as directly equivalent to Windows private working set. The first measured builds establish platform-specific budgets for review.

No clipboard polling or periodic database refreshes while idle. Opening and using notes requires no network connection. Starting in 0.1.2, enabled update checks contact public GitHub Releases after startup and every six hours; users can disable them. Update downloads run only after the user chooses installation.

## Privacy and application boundaries

- No account, cloud sync, telemetry, advertising, remote fonts, or AI API calls.
- Clipboard reads require an explicit capture or paste action; clipboard writes require a copy action.
- Treat all captured/imported text as untrusted content. Render it as text; do not execute HTML, scripts, shell commands, or embedded instructions.
- Bundle interface assets locally and restrict Tauri capabilities to the commands and plugins the app needs.
- Logs must not contain item bodies, clipboard contents, or drafts.
- Local storage and exports are not encrypted by the MVP. Do not claim secure deletion or position the app as a password vault.

## Platform support and delivery

Windows is the first usable milestone. It is not the entire cross-platform MVP. Keep builds working on the other operating systems during implementation, and validate desktop behavior on real sessions before claiming support.

Initial validation targets are proposed as Windows 11 x64, macOS 14 or newer on Apple Silicon, and Ubuntu 24.04 x64 with GNOME on X11 and Wayland. Intel macOS, Windows ARM, and additional Linux desktops are later targets unless added explicitly.

| Platform | Required validation |
| --- | --- |
| Windows | Installer, WebView2 provisioning, tray, shortcut conflicts, focus behavior, scaling, display changes, persistence, uninstall |
| macOS | App bundle, menu bar, Command shortcuts, focus behavior, permissions, and signed/notarized public distribution |
| Linux X11 | Packaged launch, global shortcut, clipboard, focus behavior, persistence, and access when no tray is available |
| Linux Wayland | Packaged launch, clipboard, persistence, window activation, and a working way to invoke the app from anywhere |

**Wayland is an early architecture gate.** Tauri's standard global-hotkey backend currently documents X11-only Linux support. Prototype a supported portal integration or a user-configured desktop shortcut that launches the existing instance before committing to platform parity. A desktop-shortcut fallback must have documented setup, and the app must expose its shortcut limitation clearly. Tray access alone is insufficient on a desktop without a tray. If neither approach provides reliable invocation, Wayland support remains blocked and requires a recorded architecture or support-scope decision.

Build installers on the appropriate operating systems through CI; Windows-first development does not mean all release artifacts are built on Windows. Choose one Linux package format after the packaging prototype passes. Internal Windows builds may be unsigned; review signing and installer reputation before public distribution.

## Outside the MVP

- Automatic clipboard history, selected-text extraction, and automatic pasting into other apps.
- Arbitrary files and non-image attachments, OCR, and rich-text editing.
- AI generation, model integrations, browser extensions, and IDE integrations.
- Cloud synchronization, accounts, collaboration, and mobile applications.
- Tags, nested folders, pinning, manual ordering, recurring tasks, reminders, and due dates.
- Double-Shift activation, launch at login, and plugin systems.
- Encryption at rest, secure deletion, and password-manager features.

## Implementation milestones

1. **Desktop feasibility:** package a minimal Windows application; prove shortcut registration/conflicts, reveal/focus/hide, tray fallback, clipboard reads/writes, and single-instance behavior. Record the first performance baseline. Build macOS/Linux shells and resolve the Wayland invocation gate before substantial UI work.
2. **Core workflow:** implement transactional persistence, capture, notes/tasks, projects, search, copy, completion, edit autosave, and drafts. The Windows build is useful for daily work at this point.
3. **Reliability:** implement undo, export/import, migration recovery, accessible keyboard interactions, installer behavior, and failure states. Recheck the performance budgets.
4. **Cross-platform release:** validate the complete workflow on the declared macOS and Linux targets, document any accepted shortcut differences, and prepare release packages.

## Acceptance checklist

- [ ] From another application, invoke the app, create a note or task, and return to work using only the keyboard.
- [ ] Capture clipboard text only after an explicit action; preserve a nonempty draft.
- [ ] Copy an item exactly, without completing it or sending it into another application.
- [ ] Edit, move, complete, reopen, delete, and undo deletion with the specified behavior.
- [ ] Delete a project without losing its items.
- [ ] Search project and global scopes with the correct completion filters at the benchmark dataset size.
- [ ] Restore saved content, preferences, and the capture draft after a clean restart; preserve committed records after a forced process termination.
- [ ] Handle a simulated save failure without clearing content or falsely reporting success.
- [ ] Round-trip all supported content through export/import. Reject malformed or conflicting imports without partial changes or data loss.
- [ ] Recover safely from a failed migration with the original database preserved.
- [ ] Handle shortcut conflicts, repeated launches, missing tray support, display changes, and display scaling.
- [ ] Complete the notes workflow offline; with automatic update checks disabled, make no intentional network requests.
- [ ] Meet the Windows performance budgets and record reviewed budgets/results for macOS and Linux.
- [ ] Pass the platform validation matrix, including the documented Wayland invocation path.
- [ ] Set the public name and application identifier before publishing installers.

## References

- [Copper workflow and product reference](https://shadcn.com/copper)
- [Tauri webview architecture](https://v2.tauri.app/reference/webview-versions/)
- [Tauri Windows development prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri global hotkey platform support](https://github.com/tauri-apps/global-hotkey)
- [Tauri distribution documentation](https://v2.tauri.app/distribute/)
