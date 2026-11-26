# Kopler

A small, local desktop scratchpad for notes, snippets, prompts, and next steps. Built with Rust, Tauri 2, React, and SQLite. Kopler is the development codename; the public name is still open.

Windows is the current MVP delivery target. Linux has a native build and X11 smoke check; macOS validation is deferred. Release tooling prepares Windows x64 installers, universal macOS DMGs, and Linux x64 AppImage/DEB packages. See [release instructions](docs/releasing.md) and [validation results](docs/validation.md) for platform status.

## Run on Windows

Install Node.js 24, stable Rust (1.90 or newer), Microsoft C++ Build Tools with **Desktop development with C++**, and the WebView2 runtime. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri -- dev
```

Create a release executable and an unsigned installer:

```powershell
npm run release:windows
```

The installer and checksum are staged in `.release/0.1.3/windows/`; the original installer remains in `src-tauri/target/release/bundle/nsis/`. It provisions WebView2 if necessary; a runtime download is separate from the installer size. See [release instructions](docs/releasing.md) for GitHub Actions, local builds on every platform, signing, and creating a draft release.

`npm run dev` alone opens the interface in a browser, which deliberately has no access to desktop data. Use the Tauri command for the working application.

## Use

- **Ctrl+Shift+Space** shows or hides the window (Command+Shift+Space on macOS). Change it in Settings if registration conflicts with another app.
- The custom title bar follows Kopler's appearance. Drag its blank area to move the window, double-click to maximize/restore, and use its minimize/maximize/close buttons. Close saves pending work and hides the app; Settings or the tray menu provides Quit.
- Type or paste text/images and press **Ctrl+Enter** or **Command+Enter** to save. Notes and tasks always go into the currently selected Inbox or project, including when All projects is enabled.
- Creating a project switches browsing and capture to it immediately, keeps your draft text, and remembers the selection after restart.
- Switch inboxes using the browser-style tabs above search. The strip scrolls horizontally when needed; Left/Right and Home/End move tab focus, and Enter or Space selects a tab. Use + to add an inbox. Right-click a project tab to rename/delete it, or middle-click to remove it. Empty projects close immediately; projects containing items or an unfinished draft ask for confirmation and move their contents to Inbox. Inbox cannot be removed.
- **Capture clipboard** reads text or an image when clicked. Images append to the draft and keep its caption; replacing nonempty text requires confirmation. Normal image paste works in both capture and inline editing, retaining focus and the text selection. Images can be saved without text.
- Drag image files onto the capture box to append them without replacing the caption. Drop multiple files together; unsupported files reject the entire drop and preserve the existing draft.
- Click an image thumbnail to view it and **Copy image** to reuse it. On Windows, **Copy item** publishes exact plain text, the first image as PNG/bitmap, and rich HTML containing all images together. Mixed items also offer **Copy text only**. A receiving app may choose just the image or text; if so, paste the image first and then use Copy text only to add the caption. Remove an attachment using its × button while editing.
- Search and filters start collapsed. Toggle them with the search icon beside the inbox tabs, or use **Ctrl+F** / **Command+F** to reveal and focus search. Collapsing preserves the current query and filters; a dot on the toggle marks active filtering. Select the Items region to navigate with arrow keys, Enter to edit, or Ctrl+C/Command+C to copy the selected item.
- **All** is the default filter when opening the app or creating a project. Use Active or Completed to narrow the list during the session.
- Use an item's pencil icon to edit; it becomes a checkmark to save changes and close the editor. Item text stays selectable without opening editing. Editing autosaves; the checkmark, hiding, and quitting wait for pending writes. Failed saves keep the editor and text available for retry.
- The Delete icon is always visible on each item. A normal click asks for confirmation; Cancel and Escape keep the item. Ctrl-click (Command-click on macOS) deletes immediately. Both paths save pending edits first and offer Undo for 10 seconds.
- Close or Escape hides the window. Use the tray menu or **Settings → Quit Kopler** to exit.
- The Settings button at the bottom right provides JSON export/import, access to the local data directory, and update checks. Notes stay local; no account, sync, clipboard history, or AI connection is used.
- Starting with 0.1.2, Kopler checks public GitHub Releases on startup and every six hours, without taking capture focus. Settings lets you disable automatic checks, check manually, and install a verified update with **Install and restart**. Drafts and edits are saved before installation; failed saves or signature checks prevent it. Windows/macOS installations and Linux AppImages support in-app updates; DEB installations use the package download. Install 0.1.2 manually once when upgrading from an older version.

Items are limited to 256 KiB of UTF-8 text and eight images (each at most 8 MiB as PNG and 16 megapixels). Pasted JPEG, WebP, BMP, and GIF files are normalized to still PNG images. Project names are limited to 80 characters and import files to 64 MiB/100,000 records, including image records. Saved text renders as Markdown (headings, lists, fenced code, tables, and links); editing and copying retain the exact original source. HTML is escaped, remote Markdown images are not loaded, and only HTTP/HTTPS links open externally. Storage and exports are not encrypted. Deleted items have a 10-second Undo window during the current session.

Click an attached image to open a separate, resizable viewer (initially up to 1100 × 840). Use Fit, 100%, or the zoom buttons; drag to pan when zoomed. Ctrl/Command + scroll or +/- zooms, Ctrl/Command+0 fits, Ctrl/Command+1 shows actual size, and Escape closes just the viewer. Its Copy image button copies the original image.

## Data and recovery

The SQLite database lives in the operating system's application-data directory under `local.kopler.desktop`. Use **Settings → Open data folder** for the exact path. Drafts and saved items persist independently. JSON exports contain projects and saved items, excluding drafts, shortcuts, and window settings.

Imports merge previously unseen IDs, skip identical records, and reject conflicts atomically. Before changing a database schema, the application makes a consistent `kopler.pre-v*.sqlite3` backup. If startup fails, the recovery screen provides access to the data folder; preserve the original database and backups before attempting recovery. Newer database schemas are never downgraded.

Images and their thumbnails are stored inside SQLite; list requests contain only attachment metadata and load thumbnails near the viewport. Draft recovery, task completion, project moves, and Undo retain attachments. Exports containing images use JSON format version 2 and include original PNG data; text-only exports retain version 1, and both versions can be imported. Database schema version 2 migrates existing text notes after creating a backup. Unreferenced images are collected on startup and before new image imports, while preserving the current draft and active Undo entries.

Mixed copy on macOS/Linux publishes rich HTML with embedded images and a plain-text alternative; compatibility depends on the destination. Explicit Copy image continues to use the native image clipboard. Native mixed-copy validation currently covers Windows only, and one-paste acceptance inside Codex has not been verified.

For isolated testing, set `KOPLER_DATA_DIR` to a dedicated directory before launching. This changes the database directory; Tauri's window geometry file remains in the normal application configuration directory. Never point automated tests at your everyday notes.

## Linux and macOS

Install the platform dependencies listed in [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), then use the same npm commands. CI includes compile checks for Windows, macOS, and Linux. A passing compile is not equivalent to validating desktop behavior.

On Linux Wayland, the built-in global shortcut is disabled because the standard backend supports X11. Configure your desktop's custom keyboard shortcuts to run:

```text
/absolute/path/to/kopler --show
```

Launching the executable again activates its existing instance. `--toggle` toggles visibility. This desktop-managed invocation is the initial Wayland fallback; Settings explains the limitation. The app keeps a taskbar entry so access does not depend on a tray extension. X11 uses the app's configured shortcut.

macOS public builds require signing/notarization. Full platform support remains subject to the validation matrix in the [MVP specification](docs/mvp-spec.md).

## Checks

Interface text uses locally bundled Geist variable fonts, supplied by `@fontsource-variable/geist`. No font service is contacted at runtime. The included SIL Open Font License is distributed in `public/licenses/geist-OFL.txt`.

Settings includes System, Light, and Dark appearance modes. Changes apply immediately and are saved locally. System follows the desktop appearance, including changes while Kopler is open; existing installations start in System mode.

```powershell
npm run build
npm test
npm run test:core
npm run test:e2e
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Interface tests use Edge and an isolated native-command adapter. Rust tests use real SQLite to verify persistence, transactions, import conflicts, Unicode matching, undo, and migration recovery. Native window, tray, clipboard, and shortcut interactions require separate desktop checks.

The `scripts/native-smoke.mjs`, `scripts/crash-check.mjs`, and `scripts/native-performance.mjs` scripts additionally exercise a real Windows WebView2 session on localhost port 9223, with a dedicated `KOPLER_DATA_DIR`. Enable that port only for an isolated test launch using `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`; normal launches do not enable remote debugging. The performance script keeps its final app instance alive until it is quit, so it can be used for memory sampling. Focus its actual desktop window before running `node scripts/search-performance.mjs` to measure foreground interaction; inactive Windows views deliberately use a lower memory target. Close test instances before launching your everyday app, because single-instance behavior intentionally activates the already-running instance.

To seed and benchmark storage in an isolated directory:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --release --no-default-features --example benchmark -- .cache/benchmark-data
```

The benchmark creates 10,000 items of 1 KiB across 20 projects. Its timings cover storage queries only; report UI debounce, IPC, and rendering separately.
