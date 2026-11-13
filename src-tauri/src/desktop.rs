use crate::images::{self, ImageRef};
use crate::store::{
    self, Bootstrap, Draft, Export, ImportReport, Item, ItemInput, Page, Project, Query, Store,
};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

struct AppState {
    store: Mutex<store::Result<Store>>,
    directory: PathBuf,
    active_shortcut: Mutex<Option<String>>,
    shortcut_error: Mutex<Option<String>>,
    ready: AtomicBool,
    tray_available: AtomicBool,
}

async fn database<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&mut Store) -> store::Result<T> + Send + 'static,
) -> store::Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state
            .store
            .lock()
            .map_err(|_| "Storage is unavailable. Restart the app.")?;
        f(guard.as_mut().map_err(|error| error.clone())?)
    })
    .await
    .map_err(|_| "The storage operation was interrupted.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InitialState {
    data: Bootstrap,
    shortcut_error: Option<String>,
    wayland: bool,
    tray_available: bool,
    data_path: String,
}

fn wayland() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn native_theme(theme: store::ThemePreference) -> Option<tauri::Theme> {
    match theme {
        store::ThemePreference::System => None,
        store::ThemePreference::Light => Some(tauri::Theme::Light),
        store::ThemePreference::Dark => Some(tauri::Theme::Dark),
    }
}

#[tauri::command]
async fn bootstrap(app: AppHandle) -> store::Result<InitialState> {
    let data = database(app.clone(), |db| db.bootstrap()).await?;
    let state = app.state::<AppState>();
    let shortcut_error = state
        .shortcut_error
        .lock()
        .map_err(|_| "Shortcut state unavailable.")?
        .clone();
    Ok(InitialState {
        data,
        shortcut_error,
        wayland: wayland(),
        tray_available: state.tray_available.load(Ordering::Relaxed),
        data_path: state.directory.display().to_string(),
    })
}
#[tauri::command]
async fn list_items(app: AppHandle, query: Query) -> store::Result<Page> {
    database(app, move |db| db.list(&query)).await
}
#[tauri::command]
async fn create_item(app: AppHandle, input: ItemInput) -> store::Result<Item> {
    database(app, move |db| db.create_item(input)).await
}
#[tauri::command]
async fn update_item(app: AppHandle, id: String, input: ItemInput) -> store::Result<Item> {
    database(app, move |db| db.update_item(&id, input)).await
}
#[tauri::command]
async fn complete_item(app: AppHandle, id: String, completed: bool) -> store::Result<Item> {
    database(app, move |db| db.complete(&id, completed)).await
}
#[tauri::command]
async fn delete_item(app: AppHandle, id: String) -> store::Result<String> {
    database(app, move |db| db.delete_item(&id)).await
}
#[tauri::command]
async fn undo_delete(app: AppHandle, token: String) -> store::Result<Item> {
    database(app, move |db| db.undo_delete(&token)).await
}
#[tauri::command]
async fn create_project(app: AppHandle, name: String) -> store::Result<Project> {
    database(app, move |db| db.create_project(&name)).await
}
#[tauri::command]
async fn rename_project(app: AppHandle, id: String, name: String) -> store::Result<()> {
    database(app, move |db| db.rename_project(&id, &name)).await
}
#[tauri::command]
async fn delete_project(app: AppHandle, id: String) -> store::Result<()> {
    database(app, move |db| db.delete_project(&id)).await
}
#[tauri::command]
async fn save_draft(app: AppHandle, draft: Draft) -> store::Result<()> {
    database(app, move |db| db.save_draft(&draft)).await
}
#[tauri::command]
async fn save_view(
    app: AppHandle,
    project_id: Option<String>,
    filter: String,
) -> store::Result<()> {
    database(app, move |db| {
        let mut preferences = db.preferences()?;
        preferences.project_id = project_id;
        preferences.filter = filter;
        db.save_preferences(&preferences)
    })
    .await
}
#[tauri::command]
async fn read_clipboard(app: AppHandle) -> store::Result<ClipboardContent> {
    let clipboard = app.clone();
    database(app, move |db| {
        if let Ok(image) = clipboard.clipboard().read_image() {
            let text = clipboard
                .clipboard()
                .read_text()
                .ok()
                .filter(|text| !text.trim().is_empty());
            if text.as_ref().is_some_and(|text| text.len() > 256 * 1024) {
                return Err("Clipboard text exceeds the 256 KiB item limit.".into());
            }
            let image = db.put_image(images::prepare_rgba(
                image.width(),
                image.height(),
                image.rgba(),
            )?)?;
            return Ok(ClipboardContent::Image { image, text });
        }
        let text = clipboard
            .clipboard()
            .read_text()
            .map_err(|_| "The clipboard contains no readable text or image.")?;
        if text.trim().is_empty() {
            return Err("The clipboard is empty.".into());
        }
        if text.len() > 256 * 1024 {
            return Err("Clipboard text exceeds the 256 KiB item limit.".into());
        }
        Ok(ClipboardContent::Text { text })
    })
    .await
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClipboardContent {
    Text {
        text: String,
    },
    Image {
        image: ImageRef,
        text: Option<String>,
    },
}

#[tauri::command]
async fn import_images(app: AppHandle, data_urls: Vec<String>) -> store::Result<Vec<ImageRef>> {
    database(app, move |db| {
        if data_urls.is_empty() || data_urls.len() > images::MAX_IMAGES {
            return Err("Paste between 1 and 8 images.".into());
        }
        let prepared = data_urls
            .iter()
            .map(|data| images::from_data_url(data))
            .collect::<store::Result<Vec<_>>>()?;
        db.put_images(prepared)
    })
    .await
}

#[tauri::command]
async fn read_image(app: AppHandle, id: String, thumbnail: bool) -> store::Result<String> {
    database(app, move |db| {
        Ok(images::data_url(&db.image_bytes(&id, thumbnail)?))
    })
    .await
}

#[tauri::command]
async fn copy_image(app: AppHandle, id: String) -> store::Result<()> {
    let clipboard = app.clone();
    database(app, move |db| {
        let (width, height, rgba) = images::decode_rgba(&db.image_bytes(&id, false)?)?;
        clipboard
            .clipboard()
            .write_image(&tauri::image::Image::new_owned(rgba, width, height))
            .map_err(|_| "Could not copy the image. Try again.".into())
    })
    .await
}
#[tauri::command]
async fn copy_item(app: AppHandle, id: String) -> store::Result<()> {
    let clipboard = app.clone();
    database(app, move |db| {
        let item = db.item(&id)?;
        if item.images.is_empty() {
            return clipboard
                .clipboard()
                .write_text(item.body)
                .map_err(|_| "Could not copy text. Try again.".into());
        }
        let images = item
            .images
            .iter()
            .map(|image| db.image_bytes(&image.id, false))
            .collect::<store::Result<Vec<_>>>()?;
        #[cfg(windows)]
        {
            crate::clipboard::write_mixed(&item.body, &images)
        }
        #[cfg(not(windows))]
        {
            if item.body.trim().is_empty() {
                let (width, height, rgba) = images::decode_rgba(&images[0])?;
                return clipboard
                    .clipboard()
                    .write_image(&tauri::image::Image::new_owned(rgba, width, height))
                    .map_err(|_| "Could not copy the image. Try again.".into());
            }
            clipboard
                .clipboard()
                .write_html(
                    crate::clipboard::content_html(&item.body, &images),
                    Some(item.body),
                )
                .map_err(|_| "Could not copy text and images. Try again.".into())
        }
    })
    .await
}

#[tauri::command]
async fn copy_item_text(app: AppHandle, id: String) -> store::Result<()> {
    let clipboard = app.clone();
    database(app, move |db| {
        clipboard
            .clipboard()
            .write_text(db.item(&id)?.body)
            .map_err(|_| "Could not copy text. Try again.".into())
    })
    .await
}

#[tauri::command]
async fn set_theme(app: AppHandle, theme: store::ThemePreference) -> store::Result<()> {
    database(app.clone(), move |db| {
        let mut preferences = db.preferences()?;
        preferences.theme = theme;
        db.save_preferences(&preferences)
    })
    .await?;
    app.set_theme(native_theme(theme));
    Ok(())
}

#[tauri::command]
async fn set_shortcut(app: AppHandle, shortcut: String) -> store::Result<()> {
    if wayland() {
        return Err("On Wayland, configure a desktop shortcut to run: kopler --show".into());
    }
    let shortcut = shortcut.trim().to_string();
    let tokens: Vec<_> = shortcut.split('+').collect();
    if shortcut.len() > 100
        || tokens.len() < 2
        || !tokens.iter().any(|t| {
            ["ctrl", "control", "alt", "command", "cmd", "super"]
                .contains(&t.to_ascii_lowercase().as_str())
        })
    {
        return Err("Use a shortcut with Ctrl, Alt, or Command, such as Ctrl+Shift+Space.".into());
    }
    let state = app.state::<AppState>();
    let old = state
        .active_shortcut
        .lock()
        .map_err(|_| "Shortcut state unavailable.")?
        .clone();
    if old.as_ref() == Some(&shortcut) {
        return Ok(());
    }
    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|_| {
            "That shortcut is invalid or already in use. Your previous shortcut is still active."
        })?;
    let candidate = shortcut.clone();
    if let Err(error) = database(app.clone(), move |db| {
        let mut preferences = db.preferences()?;
        preferences.shortcut = candidate;
        db.save_preferences(&preferences)
    })
    .await
    {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
        return Err(error);
    }
    if let Some(old) = &old {
        if app.global_shortcut().unregister(old.as_str()).is_err() {
            let previous = old.clone();
            let _ = database(app.clone(), move |db| {
                let mut p = db.preferences()?;
                p.shortcut = previous;
                db.save_preferences(&p)
            })
            .await;
            let _ = app.global_shortcut().unregister(shortcut.as_str());
            return Err("Could not replace the old shortcut. It remains active.".into());
        }
    }
    *state
        .active_shortcut
        .lock()
        .map_err(|_| "Shortcut state unavailable.")? = Some(shortcut);
    *state
        .shortcut_error
        .lock()
        .map_err(|_| "Shortcut state unavailable.")? = None;
    Ok(())
}

#[tauri::command]
async fn export_data(app: AppHandle) -> store::Result<Option<usize>> {
    let data = database(app.clone(), |db| db.export()).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = app
            .dialog()
            .file()
            .set_title("Export notes and projects")
            .add_filter("Kopler export", &["json"])
            .set_file_name("kopler-export.json")
            .blocking_save_file();
        let Some(file) = file else {
            return Ok(None);
        };
        let mut path = file.into_path().map_err(|_| "Choose a local file.")?;
        match path.extension().and_then(|s| s.to_str()) {
            None => {
                path.set_extension("json");
            }
            Some(extension) if extension.eq_ignore_ascii_case("json") => {}
            _ => return Err("Choose a .json filename for the export.".into()),
        }
        let temp = path.with_file_name(format!(".kopler-export-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)
                .map_err(|_| "Could not create the export file.")?;
            serde_json::to_writer_pretty(&mut file, &data)
                .map_err(|_| "Could not write the export.")?;
            file.write_all(b"\n")
                .map_err(|_| "Could not finish the export.")?;
            file.sync_all()
                .map_err(|_| "Could not persist the export.")?;
            drop(file);
            std::fs::rename(&temp, &path)
                .map_err(|_| "Could not save the export at that location.")?;
            Ok(Some(data.items.len()))
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    })
    .await
    .map_err(|_| "Export was interrupted.".to_string())?
}

#[tauri::command]
async fn import_data(app: AppHandle) -> store::Result<Option<ImportReport>> {
    let picker = app.clone();
    let data = tauri::async_runtime::spawn_blocking(move || -> store::Result<Option<Export>> {
        let file = picker
            .dialog()
            .file()
            .set_title("Import a Kopler export")
            .add_filter("Kopler export", &["json"])
            .blocking_pick_file();
        let Some(file) = file else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|_| "Choose a local file.")?;
        let file = std::fs::File::open(path).map_err(|_| "Could not open that import file.")?;
        let mut bytes = Vec::new();
        file.take(64 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read the import file.")?;
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("Import files must be no larger than 64 MiB.".into());
        }
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "This is not a valid Kopler JSON export. Nothing was imported.".into())
    })
    .await
    .map_err(|_| "Import was interrupted.".to_string())??;
    match data {
        Some(data) => database(app, move |db| db.import(data)).await.map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
fn open_data_directory(app: AppHandle) -> store::Result<()> {
    let path = app.state::<AppState>().directory.display().to_string();
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|_| "Could not open the data directory.".into())
}

fn set_low_memory(window: &tauri::WebviewWindow, low: bool) {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;
        // WebView2 keeps scripts and DOM alive at the low target, so hidden-window
        // save/quit events still work. Older runtimes simply keep their default.
        let _ = window.with_webview(move |webview| unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = core.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
    #[cfg(not(windows))]
    let _ = (window, low);
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        set_low_memory(&window, false);
        // Window-state restores geometry; recover a title bar moved onto a disconnected display.
        if let (Ok(position), Ok(size), Ok(monitors)) = (
            window.outer_position(),
            window.outer_size(),
            window.available_monitors(),
        ) {
            let visible = monitors.iter().any(|m| {
                let p = m.position();
                let s = m.size();
                position.x + size.width.min(120) as i32 > p.x
                    && position.x < p.x + s.width as i32 - 40
                    && position.y >= p.y
                    && position.y < p.y + s.height as i32 - 40
            });
            if !visible {
                let _ = window.center();
            }
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("capture-focus", ());
    }
}
fn request_action(app: &AppHandle, action: &str) {
    if app
        .try_state::<AppState>()
        .is_some_and(|state| state.ready.load(Ordering::Relaxed))
    {
        let _ = app.emit("window-action", action);
    } else if action == "quit" {
        app.exit(0);
    } else if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}
#[cfg(target_os = "linux")]
fn x11_main_active(window: &tauri::WebviewWindow) -> Option<bool> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use x11rb::{connection::Connection, protocol::xproto::ConnectionExt};
    let native_id = match window.window_handle().ok()?.as_raw() {
        RawWindowHandle::Xlib(handle) => u32::try_from(handle.window).ok()?,
        RawWindowHandle::Xcb(handle) => handle.window.get(),
        _ => return None,
    };
    let (connection, screen) = x11rb::connect(None).ok()?;
    let root = connection.setup().roots.get(screen)?.root;
    let atom = connection
        .intern_atom(true, b"_NET_ACTIVE_WINDOW")
        .ok()?
        .reply()
        .ok()?
        .atom;
    let reply = connection
        .get_property(
            false,
            root,
            atom,
            x11rb::protocol::xproto::AtomEnum::WINDOW,
            0,
            1,
        )
        .ok()?
        .reply()
        .ok()?;
    let active_id = reply.value32()?.next()?;
    Some(active_id == native_id)
}

fn main_has_focus(window: &tauri::WebviewWindow) -> bool {
    // X11's passive hotkey grab temporarily clears GTK's focus flag. The window
    // manager's active-window property still identifies the foreground app.
    #[cfg(target_os = "linux")]
    if let Some(active) = x11_main_active(window) {
        return active;
    }
    window.is_focused().unwrap_or(false)
}

fn toggle_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && main_has_focus(&window) {
            request_action(app, "hide");
        } else {
            show_main(app);
        }
    }
}

#[tauri::command]
fn ready(app: AppHandle) {
    app.state::<AppState>().ready.store(true, Ordering::Relaxed);
    show_main(&app);
}

#[derive(Clone, Serialize)]
struct WindowState {
    maximized: bool,
    focused: bool,
    minimized: bool,
}
fn current_window_state(window: &tauri::WebviewWindow) -> store::Result<WindowState> {
    Ok(WindowState {
        maximized: window
            .is_maximized()
            .map_err(|_| "Could not read window state.")?,
        focused: window
            .is_focused()
            .map_err(|_| "Could not read window state.")?,
        minimized: window
            .is_minimized()
            .map_err(|_| "Could not read window state.")?,
    })
}
#[tauri::command]
fn window_state(window: tauri::WebviewWindow) -> store::Result<WindowState> {
    current_window_state(&window)
}
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
enum WindowControl {
    Minimize,
    ToggleMaximize,
}
#[tauri::command]
async fn window_control(
    window: tauri::WebviewWindow,
    action: WindowControl,
) -> store::Result<WindowState> {
    match action {
        WindowControl::Minimize => window.minimize(),
        WindowControl::ToggleMaximize => {
            if window
                .is_maximized()
                .map_err(|_| "Could not read window state.")?
            {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
    }
    .map_err(|_| "Could not change the window. Try again.")?;
    current_window_state(&window)
}
#[tauri::command]
fn finish_window_action(app: AppHandle, action: String) -> store::Result<()> {
    if action == "quit" {
        let _ = app.save_window_state(StateFlags::SIZE | StateFlags::POSITION);
        app.exit(0);
    } else if action == "hide" {
        app.save_window_state(StateFlags::SIZE | StateFlags::POSITION)
            .map_err(|_| "Could not save window position.")?;
        if let Some(window) = app.get_webview_window("main") {
            window.hide().map_err(|_| "Could not hide the window.")?;
            set_low_memory(&window, true);
        }
    } else {
        return Err("Unknown window action.".into());
    }
    Ok(())
}

pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--toggle") {
                toggle_main(app);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION)
                .build(),
        );
    // Initializing the X11-only manager can itself fail on a pure Wayland session.
    if !wayland() {
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main(app);
                    }
                })
                .build(),
        );
    }
    let application=builder
        .setup(|app| {
            let directory=std::env::var_os("KOPLER_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            let store=Store::open(&directory);
            let preferences=store.as_ref().ok().and_then(|db|db.preferences().ok()).unwrap_or_default();
            app.set_theme(native_theme(preferences.theme));
            let shortcut=preferences.shortcut;
            app.manage(AppState {store:Mutex::new(store),directory,active_shortcut:Mutex::new(None),shortcut_error:Mutex::new(None),ready:AtomicBool::new(false),tray_available:AtomicBool::new(false)});
            let error=if wayland() {Some("On Wayland, assign a desktop shortcut to run: kopler --show. Opening Kopler again activates this window.".to_string())}
                else { match app.global_shortcut().register(shortcut.as_str()) {
                    Ok(())=>{*app.state::<AppState>().active_shortcut.lock().unwrap()=Some(shortcut);None},
                    Err(_)=>Some("Your global shortcut could not be registered. Open Settings to choose another; the tray and launcher still work.".to_string()),
                }};
            *app.state::<AppState>().shortcut_error.lock().unwrap()=error;
            let open=MenuItem::with_id(app,"open","Open Kopler",true,None::<&str>)?;
            let quit=MenuItem::with_id(app,"quit","Quit Kopler",true,None::<&str>)?;
            let separator=PredefinedMenuItem::separator(app)?;
            let menu=Menu::with_items(app,&[&open,&separator,&quit])?;
            #[cfg(target_os="macos")]
            {
                use tauri::menu::Submenu;
                let app_quit=MenuItem::with_id(app,"app-quit","Quit Kopler",true,Some("Cmd+Q"))?;
                let app_menu=Submenu::with_items(app,"Kopler",true,&[&app_quit])?;
                let edit_menu=Submenu::with_items(app,"Edit",true,&[
                    &PredefinedMenuItem::undo(app,None)?, &PredefinedMenuItem::redo(app,None)?,
                    &PredefinedMenuItem::separator(app)?, &PredefinedMenuItem::cut(app,None)?,
                    &PredefinedMenuItem::copy(app,None)?, &PredefinedMenuItem::paste(app,None)?,
                    &PredefinedMenuItem::select_all(app,None)?,
                ])?;
                app.set_menu(Menu::with_items(app,&[&app_menu,&edit_menu])?)?;
                app.on_menu_event(|app,event| {if event.id.as_ref()=="app-quit" {request_action(app,"quit");}});
            }
            if let Some(icon)=app.default_window_icon() {
                let tray=TrayIconBuilder::with_id("main").icon(icon.clone()).tooltip("Kopler · Notes and next steps").menu(&menu).show_menu_on_left_click(false)
                    .on_menu_event(|app,event|match event.id.as_ref() {"open"=>show_main(app),"quit"=>request_action(app,"quit"),_=>{}})
                    .on_tray_icon_event(|tray,event| {
                        if let TrayIconEvent::Click {button:MouseButton::Left,button_state:MouseButtonState::Up,..}=event {show_main(tray.app_handle());}
                    }).build(app);
                app.state::<AppState>().tray_available.store(tray.is_ok(),Ordering::Relaxed);
            }
            if let Some(window)=app.get_webview_window("main") {
                let handle=app.handle().clone();
                let resource_window=window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested {api,..}=event {api.prevent_close();request_action(&handle,"hide");}
                    if let tauri::WindowEvent::Focused(focused)=event {set_low_memory(&resource_window,!focused);}
                    if matches!(event,tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)) {
                        if let Ok(state)=current_window_state(&resource_window) { let _=resource_window.emit("window-state",state); }
                    }
                });
                // Show a recoverable interface even if frontend initialization fails.
                show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![bootstrap,list_items,create_item,update_item,complete_item,delete_item,undo_delete,create_project,rename_project,delete_project,save_draft,save_view,read_clipboard,import_images,read_image,copy_image,copy_item,copy_item_text,set_shortcut,set_theme,export_data,import_data,open_data_directory,ready,window_state,window_control,finish_window_action])
        .build(tauri::generate_context!())
        .expect("Could not initialize the desktop application");
    application.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            show_main(app);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
