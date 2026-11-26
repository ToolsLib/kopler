// Native updater diagnostics: no windows, store, tray, or single-instance plugin.
// `check` reads the configured public feed. `verify MANIFEST PACKAGE` verifies
// a local fixture without downloading or installing it, even at the current version.
use std::sync::{
    atomic::{AtomicI32, Ordering},
    Arc,
};
use tauri_plugin_updater::UpdaterExt;

async fn probe(app: &tauri::AppHandle, args: &[String]) -> Result<serde_json::Value, String> {
    match args.first().map(String::as_str).unwrap_or("check") {
        "check" => {
            let update = app
                .updater_builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|e| e.to_string())?
                .check()
                .await
                .map_err(|e| e.to_string())?;
            Ok(
                serde_json::json!({"currentVersion":app.package_info().version.to_string(),"available":update.map(|u|u.version)}),
            )
        }
        "verify" if args.len() == 3 => {
            let metadata = std::fs::read(&args[1]).map_err(|e| e.to_string())?;
            let metadata = serde_json::from_slice(&metadata).map_err(|e| e.to_string())?;
            let package = std::fs::read(&args[2]).map_err(|e| e.to_string())?;
            let updater = app
                .updater_builder()
                .version_comparator(|_, _| true)
                .build()
                .map_err(|e| e.to_string())?;
            let update = updater
                .restore_update(metadata)
                .map_err(|e| e.to_string())?
                .ok_or("No update fixture found.")?;
            update.verify(&package).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({"verified":true,"version":update.version}))
        }
        _ => Err("Usage: updater-check check | verify MANIFEST PACKAGE".into()),
    }
}

fn main() {
    eprintln!("Initializing windowless updater diagnostics");
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let result = Arc::new(AtomicI32::new(1));
    let outcome = result.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            eprintln!("Running updater verification");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let code = match probe(&handle, &args).await {
                    Ok(value) => {
                        println!("{value}");
                        0
                    }
                    Err(error) => {
                        eprintln!("{error}");
                        1
                    }
                };
                outcome.store(code, Ordering::SeqCst);
                handle.exit(code);
            });
            Ok(())
        })
        .build(context)
        .expect("Could not initialize updater diagnostics")
        .run(|_, _| {});
    std::process::exit(result.load(Ordering::SeqCst));
}
