use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Default)]
pub struct UpdateState {
    pending: tauri::async_runtime::Mutex<Option<Update>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    stage: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

pub fn can_install() -> bool {
    !cfg!(debug_assertions)
        && supports_bundle(
            tauri::utils::platform::bundle_type(),
            std::env::var_os("APPIMAGE").is_some(),
        )
}

fn supports_bundle(bundle: Option<tauri::utils::config::BundleType>, appimage: bool) -> bool {
    use tauri::utils::config::BundleType;
    match bundle {
        Some(BundleType::Nsis | BundleType::Msi | BundleType::App | BundleType::Dmg) => true,
        Some(BundleType::AppImage) => appimage,
        _ => false,
    }
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Updates are managed in the main window.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::supports_bundle;
    use tauri::utils::config::BundleType;

    #[test]
    fn inherited_appimage_environment_does_not_enable_other_package_types() {
        assert!(!supports_bundle(Some(BundleType::Deb), true));
        assert!(!supports_bundle(Some(BundleType::Rpm), true));
        assert!(!supports_bundle(None, true));
        assert!(!supports_bundle(Some(BundleType::AppImage), false));
        assert!(supports_bundle(Some(BundleType::AppImage), true));
        assert!(supports_bundle(Some(BundleType::Nsis), false));
        assert!(supports_bundle(Some(BundleType::App), false));
    }
}

#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateState>,
) -> Result<Option<AvailableUpdate>, String> {
    main_only(&window)?;
    let mut pending = state
        .pending
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let mut update = updater
        .check()
        .await
        .map_err(|error| format!("Could not check GitHub for updates: {error}"))?;
    if let Some(update) = update.as_mut() {
        let url = &update.download_url;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || !url.path().starts_with(&format!(
                "/ToolsLib/kopler/releases/download/v{}/",
                update.version
            ))
        {
            return Err("The update package is not from the expected GitHub release.".into());
        }
        update.timeout = Some(Duration::from_secs(600));
    }
    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
        notes: update.body.clone(),
    });
    *pending = update;
    Ok(available)
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    main_only(&window)?;
    if !can_install() {
        return Err("Install this update using the package from GitHub Releases.".into());
    }
    let pending = state
        .pending
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let update = pending
        .as_ref()
        .ok_or("Check for updates before installing.")?;
    let mut downloaded = 0_u64;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let _ = app.emit_to(
        "main",
        "update-progress",
        Progress {
            stage: "downloading",
            downloaded,
            total: None,
        },
    );
    let bytes = update
        .download(
            |length, total| {
                downloaded += length as u64;
                if last_emit.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                    let _ = app.emit_to(
                        "main",
                        "update-progress",
                        Progress {
                            stage: "downloading",
                            downloaded,
                            total,
                        },
                    );
                    last_emit = Instant::now();
                }
            },
            || {
                let _ = app.emit_to(
                    "main",
                    "update-progress",
                    Progress {
                        stage: "verifying",
                        downloaded: 0,
                        total: None,
                    },
                );
            },
        )
        .await
        .map_err(|error| format!("The update could not be downloaded or verified: {error}"))?;
    app.save_window_state(StateFlags::SIZE | StateFlags::POSITION)
        .map_err(|error| error.to_string())?;
    let _ = app.emit_to(
        "main",
        "update-progress",
        Progress {
            stage: "installing",
            downloaded: 0,
            total: None,
        },
    );
    // The main UI flushes drafts and edits and becomes read-only before invoking this command.
    // The updater verifies both the signature and the signed version before replacing files.
    update
        .install(bytes)
        .map_err(|error| format!("The update could not be installed: {error}"))?;
    #[cfg(not(windows))]
    app.restart();
    #[cfg(windows)]
    Ok(())
}
