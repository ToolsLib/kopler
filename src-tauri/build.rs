fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::build();
    // Tauri embeds Common Controls v6 for app binaries; native examples need it too.
    #[cfg(all(feature = "desktop", windows))]
    {
        println!("cargo:rerun-if-changed=examples/updater-check.manifest");
        println!("cargo:rustc-link-arg-examples=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-examples=/MANIFESTINPUT:{}",
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("examples/updater-check.manifest")
                .display()
        );
    }
}
