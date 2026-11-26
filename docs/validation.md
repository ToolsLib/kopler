# MVP validation

## Signed updates — 26 November 2026

Version 0.1.2 introduces automatic GitHub Release checks, a persisted opt-out, manual checks, available-update notification, progress, and explicit installation/restart. Installation flushes pending writes first and leaves edits/drafts available after save or download failures. Linux package-managed builds offer a release download instead of self-installation. The opt-out is stored in its own settings record, preserving the existing preferences JSON for older installations. Self-installation requires an actual supported bundle type; an inherited APPIMAGE environment variable cannot enable it for DEB, RPM, or unpackaged binaries.

All 37 production interface tests, 17 storage/image/clipboard Rust tests, a native package-policy test, seven release-tool tests, and three pending-write tests passed locally. Rust formatting, Clippy, and actionlint passed. Signature verification was checked against a real version-bound Tauri CLI signature. A windowless native diagnostic also verified that fixture with Tauri's actual updater and rejected both corrupted package bytes and a mismatched signed version, without opening Kopler or its store. Windows examples explicitly embed Common Controls v6, matching the app's existing requirement. Release tests reject modified packages, changed signing keys, forged trusted comments, mismatched signed versions, missing signature files, and incomplete asset sets; they also verify the four-platform update manifest and checksums. The signing key is stored as encrypted repository secrets with an encrypted local backup; only its public key is embedded in the app.

Older versions require one manual installation of 0.1.2. A full in-app replacement between two published updater-enabled versions, native macOS update interaction, and native Linux AppImage replacement remain pending. Hosted builds validate the cross-platform updater packages and signatures before publication. Update downloads and manifests continue to use Release storage, without Actions artifacts.

## Capture, image viewer, and Markdown follow-up — 26 November 2026

Image paste keeps capture/edit textareas focused throughout processing and preserves selection and scroll position; mixed text/image paste restores the caret after the inserted text. Attachments open in a separate resizable image window, initially up to 1100 × 840, with fit, actual size, zoom, panning, native image copying, independent window controls, and live appearance updates. Saved notes render Markdown while editing and copying retain the original source. HTML is escaped, remote Markdown images are not fetched, and only HTTP/HTTPS links open externally. The selected tab no longer has a top accent line.

All 32 production interface tests passed, including a deliberately delayed image import with no blur, image/text caret placement, a large image viewer resizing/zoom/pan test, exact Markdown round-trips, and unsafe content handling. All 16 Rust tests, three pending-write unit tests, and four release-tool tests passed. Rust formatting and Clippy passed; the local filesystem emitted incremental-cache hard-link warnings. The Windows NSIS installer was rebuilt successfully.

An isolated Windows desktop check confirmed real clipboard image paste with no blur and the original selection retained, exact Markdown clipboard copying, a separate viewer larger than the main window, native resize, zoom, original image copying, independent maximize/restore, live light/dark updates, Escape closing only the viewer, and reopening it. Light/dark viewer and Markdown layouts were inspected. The test restored the original clipboard and window geometry and used a dedicated data directory. Linux/macOS native validation of these changes remains pending.

The updated Windows installer is 2,248,789 bytes; SHA-256: `e1c1cf61eeee1717340f58aaf8476282c223f1d86b8857ff5a82934d35cc0f38`. This local build has not been published as a new GitHub release.

The v0.1.1 release preparation initially reached a GitHub Actions artifact storage quota error after the macOS executable had compiled successfully. Tagged builds now upload packages directly to a guarded draft Release, and assembly downloads those packages to validate the complete set and generate combined checksums. Manual runs use separate prerelease drafts for their candidates. Routine desktop checks no longer upload duplicate binaries. Neither workflow uses Actions artifact storage. Existing artifacts and v0.1.0 release downloads were preserved.

## Initial MVP validation — 13 November 2026

Validated on 13 November 2026. Windows is the first MVP delivery target. macOS validation is deferred at the user's request. Linux has a successful native build and X11 smoke test; Wayland desktop behavior remains a separate validation item.

## Delivered behavior

The Windows application implements notes and tasks, Inbox and project lists, Unicode case-insensitive search, exact-text copying, completion/reopening, editing with autosave, draft restoration, deletion with a 10-second Undo window, JSON export/import, a configurable global shortcut, tray access, single-instance activation, and hide-on-close behavior.

SQLite transactions protect saved records. Failed writes keep text available for retry. Captured text is rendered literally. The app requires no account or application server and makes no intentional network requests during normal use.

Kopler remains the development codename and uses the development application identifier `local.kopler.desktop`. The installer is unsigned. Public naming, signing, and broader platform release preparation are separate from this internal MVP.

## Automated checks

| Check | Result |
| --- | --- |
| Production TypeScript/Vite build | Passed |
| Rust formatting | Passed |
| Rust Clippy with warnings denied | Passed; the restricted filesystem can emit a Cargo incremental-cache hard-link warning unrelated to source lints |
| Rust storage/image/clipboard tests | 16 passed on Windows; 10 storage tests passed in the earlier Linux validation |
| Write coalescing, serialization, and failed-save retry tests | 3 passed |
| Production-bundle interface tests in Edge | 27 passed |
| npm dependency audit | No vulnerabilities reported after updating the test tooling |

Interface tests cover capture, literal content, copy, completion, reopening, edit persistence, deletion/Undo, draft restoration, clipboard replacement confirmation, save failures blocking hide, project deletion, search scopes, keyboard navigation, minimum window size, save-before-quit, unapplied shortcut settings, and accessible export feedback inside Settings.

Interface tests use an isolated native-command adapter. Rust tests separately exercise real SQLite, including atomic import rollback, failed writes, Unicode case folding, project rehoming, Undo expiry, migration backup preservation, and refusal to downgrade a newer database.

Follow-up on 13 November: creating a project now immediately selects it for browsing and capture, retains the draft, clears the previous search/global scope, and persists the selection. The production build and all eight interface tests passed again, including this flow across a reload. The native and performance measurements below describe the initial MVP validation; the Windows package was rebuilt for this follow-up.

Layout follow-up on 13 November: the branding/tagline/local-badge header was removed, and Settings moved to the bottom-right footer beside the shortcut hint. All eight interface tests passed again. Light, dark, and 360 × 420 layouts were visually checked, with Settings opening correctly from its new location and no horizontal overflow.

The redundant text beneath the capture box and the label above it were subsequently removed. Capture clipboard and the save shortcut hint remain aligned to the right. The production build passed for these copy cleanups.

Capture routing follow-up: the separate capture destination dropdown was removed. New notes and tasks always use the selected Inbox/project, including with All projects enabled. Switching spaces preserves draft text and updates the destination, and restored drafts follow the selected space. All nine interface tests passed, including saves in both directions between Inbox and a project, draft preservation, global scope, and reopening the selected project after reload. The toolbar was also checked at minimum size with Save still aligned right.

Filter-default follow-up: All stays on the right and is selected when opening the app or creating a space. Reopening starts with All even if the previous session saved Active or Completed, so existing installations adopt the new default. All nine interface tests and ten storage tests passed; coverage includes completed tasks remaining visible by default, manual filtering, reopening, new spaces, and fresh storage preferences.

Inbox-tab follow-up: the project dropdown was replaced with browser-style tabs and a horizontally scrollable strip. Add/manage controls remain outside the scrolling area, long names have full-name labels/tooltips, and the selected tab is linked to its content panel. Left/Right and Home/End move focus; Enter or Space selects. All ten interface tests passed, including keyboard switching, overflow at 360 × 420, draft preservation, selected-space capture, reopening, and project deletion. Light/dark previews were inspected with transitions settled, and the active long-name tab remained fully within the narrow scrolling viewport.

Typography follow-up: interface text now uses locally bundled Geist variable fonts, including the empty-state heading. The five WOFF2 character subsets total 76,420 bytes and load only when needed; their SIL Open Font License is included in the packaged frontend. All ten interface tests passed. With external requests blocked, normal and semibold Geist loaded successfully for Latin, extended Latin, Cyrillic, and Vietnamese sample text. Light/dark layouts and the minimum 360 × 420 window were inspected, with no page overflow and the selected long-name tab still reachable.

Footer follow-up: the idle "Saved on this device" text and dot were removed. Saving, unsaved-change, and failed-save feedback remain available in the live status region; shortcut and Settings controls stay on the right. All ten interface tests passed; persistence checks now wait for the status region to clear before reloading persisted data.

Appearance follow-up: Settings now offers System, Light, and Dark, applied after successful persistence. System is the default for fresh and existing preferences and follows live desktop appearance changes. Explicit modes override the desktop appearance, including native window theming. Twelve interface tests and eleven Windows storage tests passed, covering both overrides, reopening, live system changes, failed saves/retry, and legacy preferences. Rust formatting and Clippy also passed.

The appearance Settings layout was visually inspected in light/dark production previews and at 360 × 420; keyboard selection and dialog containment passed. The Windows installer rebuilt successfully. A new native runtime check was skipped because an existing user session was running; the earlier native checks below predate this appearance setting.

Clipboard-image follow-up: images can be pasted into capture or inline editing, or appended through Capture clipboard without replacing text. Notes/tasks can contain images without a caption. Thumbnails are loaded near the viewport; full-size viewing and explicit image copying are available. Images remain in SQLite through draft recovery, completion, project moves, Undo, and JSON export/import. Database schema 2 migrates existing notes with a pre-migration backup; image exports use JSON format 2, while text-only format 1 remains supported.

All fifteen interface tests and fifteen Rust storage/image tests passed, along with formatting and Clippy. Checks cover PNG transparency/limits, thumbnails, legacy-schema migration and backup contents, image draft recovery, image-only tasks, selected-space capture, multiple attachments, inline paste/removal, copy, Undo, export/import pixel preservation, import rollback, failed saves, and orphan-image collection. Draft/list/full-size image layouts were inspected in light/dark mode and at 360 × 420 without page or dialog overflow. The existing text-only performance measurements below have not been repeated with an image-heavy dataset.

An isolated native Windows session also passed actual Ctrl+V from the Windows image clipboard, Capture clipboard for an image-only task, native Copy image with matching decoded pixels, draft recovery after a full process restart, and saved-image recovery after another restart. The original system clipboard was restored after the check. Test fixtures and the compact result are under `.cache/images-native-*`; no everyday notes were accessed.

Drag/drop and mixed-copy follow-up: image files can be dropped on the capture box, including multiple files and image extensions without MIME metadata. Unsupported/mixed batches preserve the existing draft. The webview uses HTML file-drop handling, with default navigation prevented for file drops outside capture. Windows Copy item now publishes Unicode text, PNG, DIBV5, and rich HTML together; HTML includes every attachment while the native image formats contain the first. Mixed notes also expose Copy text only. Normal mixed paste inserts text at the selection and appends the image; Capture clipboard retains any accompanying text.

All seventeen interface tests and sixteen Rust storage/image/clipboard tests passed, including selected-space drop routing, persistence, rejection of unsupported files, text/image selection replacement, the text-only fallback, safe HTML escaping, and bitmap channel/orientation encoding. Formatting and Clippy passed. A fresh native Windows session verified a file-backed WebView2 drag/drop event, simultaneous exact text and image clipboard availability, matching copied pixels, a single actual Ctrl+V restoring both into capture, and Copy text only removing the image format. The original clipboard was restored. Results are under `.cache/drop-copy-native-*`.

Codex compatibility is not an end-to-end claim: the installed Codex package exposes its window as ChatGPT, and the computer-use skill forbids automating that UI. Read-only inspection of installed bundles found file-oriented paste handlers that can consume the event before text insertion, but did not establish the active chat composer's behavior. A destination may select only one clipboard representation. macOS/Linux mixed copy supplies HTML plus plain text and has not been natively validated; explicit Copy image retains its native image behavior.

Windows no-HTML copy experiment (26 November): Copy item now publishes only exact Unicode text, native PNG, and DIBV5 for the first image, omitting rich HTML that a destination may reduce to “Attached image.” A standalone native check exercised the actual clipboard-writing function and verified all three representations, byte-for-byte text/PNG preservation, and removal of stale HTML; the original clipboard was restored. All 17 core Rust tests and the local Windows debug build passed. The test executable is `src-tauri/target/debug/kopler.exe`. The subsequent manual Codex check pasted only the text, so omitting HTML does not provide a combined text/image paste in the tested Codex input. Additional images can be copied individually from the viewer; separate text and native-image pastes remain the fallback.

Copy-action follow-up: every image thumbnail has a direct Copy image button. Item, text-only, and image copying use an independent clipboard lock, without the global busy state or a save-queue flush. Native item/text copy commands accept the current editor snapshot without writing it to storage. All 44 UI tests and 17 core Rust tests passed; Clippy and Rust formatting passed. The copy regression checks hold clipboard operations open and verify that editors stay editable, unrelated controls remain enabled, pending writes are not flushed, current unsaved Markdown is copied, and failed autosaves do not block copying. Normal autosave continues independently. A final isolated native Windows session verified both item and text-only editor snapshots through the actual commands and confirmed that the stored item remained unchanged; the clipboard and window geometry were restored.

Delete-action follow-up: Delete is now always visible in each item's action row, with a confirmation dialog before removal. Pending edits are flushed before confirmation; Cancel initially receives focus and Escape cancels. A failed deletion leaves the item and dialog intact with an accessible error; retry and the existing 10-second Undo work. The duplicate editor-only Delete button was removed. All eighteen interface tests passed, including text/image deletion, cancellation, pending-edit preservation, failure/retry, and Undo. Light/dark and 360 × 420 production previews were visually checked; the action is visible outside editing, Cancel receives focus, and the dialog fits without horizontal overflow.

Custom-title-bar follow-up: OS decorations are disabled. A compact title bar follows the selected app appearance and provides minimize, maximize/restore, and save-before-hide Close controls. Loading and recovery screens retain window controls. Tauri's built-in drag region handles dragging and platform-specific double-click behavior, with only its start-dragging and internal-maximize permissions added. Native state events update the restore icon and inactive styling; minimize/maximize commands run asynchronously. The window remains resizable.

All twenty-one interface tests passed, covering window-state updates, minimize/close draft flushing, failed saves preventing close, the native drag-region hook, and recovery controls. Rust formatting and Clippy passed. Light/dark and 360 × 420 layouts fit. Isolated native checks verified minimize/unminimize, maximize/restore, app themes, and draft persistence before minimizing/closing; desktop inspection confirmed the OS title bar was replaced. The previous window geometry was restored after testing. Automated pointer-drag attempts with the earlier manual handler did not establish movement, so that handler was replaced with Tauri's built-in implementation; real-pointer dragging and border resize remain separate manual checks unless recorded below.

The final packaged build passed the native control/draft checks again, and an actual desktop double-click on Tauri's built-in title-bar region visibly maximized the window. Automated drag attempts did not establish a changed saved position, including with the built-in handler, so dragging and border resizing are not reported as natively verified. The title bar uses Tauri's documented native implementation; these interactions remain manual QA items. The test process was closed and the prior geometry file restored.

Search/filter disclosure follow-up: search and completion/global-scope controls now start collapsed. A search icon beside the inbox tabs toggles both, exposes its expanded state accessibly, and marks active criteria with a dot. Collapsing retains current search/filter choices. Ctrl+F/Command+F reveals and focuses search, including when it was hidden. All twenty-two interface checks passed, including default/reload collapse, click and shortcut opening, retained queries and filtering, and active indicators. Light/dark and 360 × 420 collapsed/expanded layouts were visually inspected without horizontal overflow. Native smoke/benchmark scripts now reveal the controls before interacting with them; performance measurements were not repeated for this UI-only change.

## Native Windows checks

The release executable was exercised through its actual WebView2 session with isolated test data, rather than substituting its Rust commands.

- Tray initialization and successful global-shortcut registration were verified.
- Capture wrote real SQLite records. Copy returned the exact original text through the system clipboard.
- Completion, reopening, and inline edits persisted correctly.
- Escape flushed a pending draft before hiding. A second process revealed the existing instance.
- The global shortcut hid the focused native window in a computer-use check.
- A forced process termination preserved the committed item and previously persisted draft; both were verified directly in SQLite and again after relaunch.
- Native Save/Open dialogs exported and re-imported a 10,000-item, 20-project JSON file. The export contained all records, and the import completed without errors or changing the record count. Atomic conflict and duplicate handling are also covered by the Rust tests.
- Light and dark appearances were inspected. Minimum-size keyboard interaction was checked in the interface suite.

Save-dialog automation exposed an accessibility issue in feedback displayed outside the Settings dialog. Notifications now render inside the active dialog, with a regression test checking their accessible status role.

The NSIS installer completed a silent installation into a new directory inside the workspace with exit code 0. The installed executable passed the same native workflow checks. Its only byte differences from the standalone executable were Tauri's expected three-byte bundle-type marker (`UNK` to `NSS`). The test uninstaller also returned 0, removed its installation directory and registration, and preserved the separate notes database. No existing Kopler installation was present before this check. Windows signing/reputation checks remain a public-distribution task.

## Windows performance

Machine: AMD Ryzen 7 6800H, 16 logical processors, approximately 32 GB RAM, Windows 11 Home build 26300. The dataset contained 10,000 items averaging 1,024 bytes of body text across 20 projects. Measurements used an optimized release build.

| Metric | Result | Initial budget |
| --- | --- | --- |
| Compressed Windows installer | 2,046,502 bytes / 1.95 MiB | At most 20 MiB |
| Standalone executable | 5,251,072 bytes / 5.01 MiB | Informational |
| Process-cold launch, p95 over 20 launches | 947 ms | At most 2,000 ms |
| Foreground search, p95 over 30 queries | 143 ms | At most 150 ms |
| Reveal via second-process `--show`, p95 over 30 repetitions | 121 ms | 200 ms shortcut-reveal target; this is a proxy measurement |
| Visible idle private working set | 157.59 MiB | At most 180 MiB |
| Hidden idle private working set | 6.42 MiB | At most 120 MiB |
| Hidden idle CPU, average over 60 seconds | 0.0098% of machine capacity | At most 0.2% |

Process-cold launches used a warm filesystem cache. Launch timing includes the test runner's WebView attachment overhead. Search timing starts before input is filled and ends two animation frames after the actual filtered DOM changes, including debounce, native IPC, query work, rendering, and test input overhead. The search result above was measured with the native window focused and the background builds finished. An inactive/concurrent-build run measured 186 ms at p95, so background measurements should not be treated as equivalent to foreground interaction.

The reveal timing uses a second process invoking `--show`, including process-launch overhead. The shortcut itself was functionally exercised, but its exact end-to-end latency was not separately instrumented.

Memory and CPU include the Rust process and six attributable WebView2 descendants. Memory is the sum of Windows `WorkingSetPrivate`, measured after 30 seconds in each state with 60 notes visible before hiding. These figures describe resident private memory; shared pages and committed memory have different accounting. The first hidden measurement was approximately 200 MiB. Windows integration now selects WebView2's supported low-memory target while hidden or inactive and restores the normal target when shown or focused. This retains the page and permits save/quit events while trimming inactive resident memory. See [Microsoft's memory-target API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2_19).

WebView2 runtime provisioning is separate from the compressed installer size. Actual runtime download size depends on the installed system and the runtime selected by Microsoft's Evergreen installer.

## Linux checks

The final source built natively in an isolated Debian 12 container using Rust 1.97.1, GTK/WebKitGTK, D-Bus, Xvfb, and Openbox. All 10 real SQLite tests passed. The desktop smoke check verified a visible X11 launch, hiding with the global shortcut, revealing with a second `--show` invocation, and a single remaining app instance.

The first shortcut check lacked a window manager and did not establish the focus state needed by the toggle behavior. It passed after adding Openbox. This is why the reproducible Linux check includes a window manager.

The shortcut plugin is completely skipped in Wayland sessions, avoiding startup failure from its X11-only manager. Settings explains how to configure a desktop shortcut invoking `kopler --show`; the app retains a taskbar entry. Actual Wayland compositor activation, clipboard behavior, and tray fallback still require a desktop-session check. Ubuntu 24.04/GNOME and Linux release packages have not been validated here.

## Reproduction

Use the commands in the [README](../README.md). Additional scripts are provided for:

- Real Windows native workflows: `scripts/native-smoke.mjs`.
- Committed-data crash survival: `scripts/crash-check.mjs`.
- Process-cold launch, render, and reveal timing: `scripts/native-performance.mjs`.
- Foreground search timing after focusing the actual app window: `scripts/search-performance.mjs`.
- Process-tree private working set and idle CPU: `scripts/measure-windows.ps1`.
- Isolated Linux build, storage tests, and X11 smoke checks: `scripts/linux.Dockerfile`, `scripts/linux-check.sh`, and `scripts/linux-smoke.sh`.

Test scripts require dedicated data directories. Windows native automation additionally requires a test-only WebView2 debugging port; ordinary application launches do not open that port. Test fixtures, screenshots, raw measurements, and build caches are under the ignored `.cache` directory.

Project-removal follow-up: project tabs now provide a themed right-click Rename/Delete menu and middle-click removal. Empty projects close immediately, while saved notes/tasks (including completed or filtered-out records) and unfinished text/image drafts require confirmation with Cancel initially focused. Removal keeps content in Inbox and preserves the selection when deleting a background tab. The same conditional confirmation applies through Manage project. Inbox stays protected. All 27 production interface tests passed across the suite and targeted follow-up runs, including cancellation, failed-delete retry, draft/image recovery after reload, keyboard menus/rename, and background-tab removal. Menus and confirmation dialogs were visually inspected in light/dark mode and at 360 × 420 without page overflow. The existing Rust transaction handles content moves; no storage changes were required.

Item-editing follow-up: each item now shows a pencil icon that becomes a checkmark during inline editing. The checkmark flushes pending writes before closing the editor; failed saves retain the editor and text for retry. Clicking item text selects the item without opening editing, and the separate Done button has been removed. Opening the editor focuses its text field after pending writes finish; saving returns focus to the Items region. All 27 production interface tests passed, including click behavior, focus, failed save/retry, attachment editing, and persistence after reload. Light/dark and minimum-size layouts were checked with the checkmark accessible above the editor.

Dark-palette follow-up: the dark theme now uses neutral charcoal/grayscale surfaces and controls inspired by Codex, replacing the green tint in backgrounds, text, icons, borders, focus states, buttons, and overlays. Primary actions use off-white backgrounds with dark text. Destructive/error colors and pending-save feedback remain distinct. All 27 production interface tests passed, including persisted Light/Dark overrides and live System appearance changes. Capture, notes/completed tasks, filters, inline editing, settings, project menus, and the minimum 360 × 420 layout were visually checked; light mode retains its existing palette.

Release-preparation follow-up: `.github/workflows/release.yml` builds Windows x64 NSIS, a universal Intel/Apple Silicon macOS DMG, and Linux x64 AppImage/DEB packages. It validates matching app/package/Cargo versions and release notes, requires all four packages before assembling checksums, and creates a draft only for version-tag pushes. Manual runs produce downloadable Actions artifacts. An existing public release is not overwritten. Hosted Mac steps verify both architectures and the bundle signature; Linux includes an isolated release smoke check.

Local validation passed four release-tool tests on Windows and Linux, three pending-write unit tests on each, sixteen Linux storage/image/clipboard tests, all 27 production interface tests, and actionlint for both workflows. Playwright explicitly discovers only the interface `.spec.ts` files, keeping the Node release-tool tests separate. The Windows release helper built/staged an unsigned installer successfully. The final Linux container script completed successfully and built both packages; DEB metadata confirms version 0.1.0, amd64, and GTK/WebKit/AppIndicator dependencies. The packaged AppImage and an installed DEB each passed offline X11 launch, shortcut hide, second-launch reveal, and single-instance checks in disposable containers with isolated test data. macOS packages are produced by the hosted workflow; no local macOS artifact was built during this preparation. The macOS helper defaults to ad-hoc signing, and Apple notarization/Windows publisher signing are not configured.

Linux artifacts staged under `.release/0.1.0/linux/`:

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| `Kopler_0.1.0_linux_x64.AppImage` | 99,473,912 | `d0137d40b6c0b5bb9d793c85f884ac45d953537aceb3226c7107eaf3b56cd2da` |
| `Kopler_0.1.0_linux_x64.deb` | 3,407,904 | `b60f0bcdbc62a18b97a387468036d9a2c092ef5860bede3f09c91435b9bdc3aa` |

These local Linux packages were built on Debian 12. The hosted workflow targets Ubuntu 22.04; its outputs have not been produced or tested yet. The AppImage includes desktop dependencies, explaining its larger size. Each platform staging folder includes `SHA256SUMS.txt`.

CI follow-up, 14 November: updated fixed-size pixel loops for Rust 1.100 Clippy, corrected macOS architecture verification to inspect the app inside the finished DMG, and fixed an X11 shortcut race where the keyboard grab temporarily cleared GTK's focus flag. X11 now uses the window manager's active-window property, with native focus as a fallback on other backends. The Linux smoke check shares its display environment with D-Bus services, waits for a real capture draft to persist, and checks focused hide, background focus, hidden reveal, and single-instance behavior. Fresh isolated offline Linux runs exercised those states successfully. Hosted workflow outcomes are linked in GitHub Actions above.

## Artifact hashes

Historical SHA-256 of the 13 November Windows artifacts, rebuilt through `npm run release:windows` with the neutral charcoal dark theme, pencil/checkmark item editing, project tab context menus/middle-click removal and conditional confirmation, collapsible search/filter controls, the custom title bar, visible Delete actions and confirmation, image drag/drop, mixed clipboard copying, appearance settings, locally bundled Geist, inbox tabs, and selected-space capture routing (installer size: 2,182,943 bytes). The installer staged at that time under `.release/0.1.0/windows/Kopler_0.1.0_windows_x64-setup.exe` had the same hash:

```text
kopler.exe
7D9917588C26DCED466379033249CD5CDC3DFE91E1671A3F28487B60A6612892

Kopler_0.1.0_x64-setup.exe
60561ACA24088D16304F097CDC3C9B346D83DB6DF0E14D8DB8F1084C95D648FF
```

The three-platform check workflow is in `.github/workflows/check.yml`, and installer builds/draft releases are in `.github/workflows/release.yml`. Both passed actionlint. The configured remote is [ToolsLib/kopler](https://github.com/ToolsLib/kopler); hosted build results are reported in [GitHub Actions](https://github.com/ToolsLib/kopler/actions) independently of these local checks. macOS universal build/signature checks are prepared for the hosted Mac runner; native macOS runtime checks have not been performed here. See `docs/releasing.md` for usage and signing configuration.

Manual follow-up checks include monitor disconnection/reconnection, uncommon display-scaling combinations, and a real Wayland/GNOME session. The current desktop checks do not claim those configurations have been exercised.
