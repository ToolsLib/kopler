# Release builds

The release version is currently **0.1.3**. The release tooling prepares native installers and checksums; it does not publish a public release automatically.

| Platform | Runner | Download |
| --- | --- | --- |
| Windows x64 | Windows 2025 | NSIS `.exe`, installs for the current user |
| macOS 14+, Intel and Apple Silicon | macOS 15 | Universal `.dmg` |
| Linux x64 | Ubuntu 22.04 | `.AppImage` and `.deb` |

Windows ARM and Linux ARM packages are not included in this initial matrix. The macOS minimum version comes from `src-tauri/tauri.conf.json`. Linux packages require a suitable desktop environment; the DEB declares its system dependencies. AppImage is more portable and larger, but still depends on a compatible glibc and graphics stack. The local Linux container uses Debian 12, so its baseline differs from hosted Ubuntu 22.04 builds.

## GitHub Actions

The repository is [ToolsLib/kopler](https://github.com/ToolsLib/kopler). Commit and push the workflow files with Actions enabled; the first branch push starts the desktop checks. Hosted results are available in [GitHub Actions](https://github.com/ToolsLib/kopler/actions).

For downloadable test builds, open **Actions → Release builds → Run workflow** on the desired branch. This validates matching versions and release notes, runs unit/storage tests (plus Windows UI tests), builds all three native platforms, verifies both macOS architectures and the app signature, and runs an isolated Linux X11 release smoke check. Manual runs create a prerelease draft named `candidate-0.1.3-<run-id>` targeting the selected commit, with all four packages and combined checksums attached. Find those downloads in **Releases**; drafts require repository access and remain until published or deleted. Reruns refresh the same draft. Neither release builds nor routine desktop checks use Actions artifact storage.

To create a draft GitHub Release, tag the reviewed commit after updating all versions and release notes:

```sh
npm run release:check
git tag v0.1.3
git push origin v0.1.3
```

The workflow rejects a tag that differs from the app version. Tagged runs prepare a **draft** release using `docs/releases/v0.1.3.md`, and each platform uploads its packages directly to that draft after its checks pass. After every platform succeeds, assembly requires four manual packages, the macOS updater archive, and three signatures. It cryptographically verifies every updater package and its signed version against the app's public key, generates `latest.json` and `SHA256SUMS.txt`, and finalizes the ten-asset draft. Manual candidates use the same Release storage route with their own candidate draft. Failed builds can leave an incomplete draft, which must not be published. Every upload refuses to modify a published release.

Review the draft's artifacts, signing status, release notes, and native platform behavior before manually publishing it. macOS building happens on the hosted Mac runner; a Mac is not needed on the Windows development machine. Compiling is not a claim that native desktop behavior has been validated on that platform.

## Local builds

Use Node.js 24, Rust 1.90 or newer, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Start with `npm ci`.

```sh
npm run release:check
npm run test:release
npm run release:windows  # on Windows x64
npm run release:linux    # on Linux x64
```

For the universal macOS bundle, install both Rust targets on a Mac:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run release:macos
```

Build commands use Cargo's lockfile, check the app/package/Cargo versions and release notes before building, and stage packages into `.release/<version>/<platform>/` with a local `SHA256SUMS.txt`. Original Tauri bundles remain in `src-tauri/target/release/bundle/`; macOS universal bundles use `src-tauri/target/universal-apple-darwin/release/bundle/`. `node scripts/release.mjs stage windows` can stage an already-built Windows installer without rebuilding it. Staging checks the package names/version and rejects missing, empty, or ambiguous bundles; it does not certify their signing status or freshness against source.

### Linux packages from Windows with Docker

The following PowerShell commands use dedicated build/cache volumes, read the source checkout without modifying it, and copy finished packages back under `.release/`. Node dependencies are installed inside Linux rather than reusing Windows `node_modules`.

```powershell
docker build -f scripts/linux.Dockerfile -t kopler-linux-check:local .
$koplerSource = (Get-Location).Path
$koplerOutput = Join-Path $koplerSource '.release'
New-Item -ItemType Directory -Force -Path $koplerOutput | Out-Null
docker run --rm --env CARGO_HOME=/cargo-cache --mount "type=bind,source=$koplerSource,target=/source,readonly" --mount "type=bind,source=$koplerOutput,target=/output" --mount type=volume,source=kopler-linux-work,target=/work --mount type=volume,source=kopler-linux-cargo,target=/cargo-cache kopler-linux-check:local sh /source/scripts/linux-release.sh
```

Packaging runs with `APPIMAGE_EXTRACT_AND_RUN=1` so build tools can run without privileged FUSE mounts, and `NO_STRIP=1` to avoid stripping bundled system libraries with an incompatible tool. Rust's release binary is already stripped. These are build environment settings, not app runtime settings. The sandbox-disabling environment variables in `linux-smoke.sh` are confined to its isolated X11 check and are not part of release configuration.

## Signing and public distribution

The initial pipeline makes **unsigned Windows candidates** and **ad-hoc signed macOS candidates**. The macOS helper supplies the ad-hoc identity `-` only when `APPLE_SIGNING_IDENTITY` is absent. Ad-hoc signing does not establish an Apple-verified publisher or replace notarization; downloaded candidates can require Gatekeeper approval. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

For Apple Developer signing/notarization, add a temporary-keychain import step to the macOS build job using repository secrets `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, and a temporary keychain password, then pass `APPLE_SIGNING_IDENTITY` to the build. The plain Tauri CLI does not import a certificate secret automatically. Also pass either `APPLE_ID`, `APPLE_PASSWORD` (app-specific), and `APPLE_TEAM_ID`, or the App Store Connect API credentials documented by Tauri. Follow the linked signing guide for keychain access and cleanup. Never commit certificates or credentials. For Windows signing, configure a trusted code-signing identity and Tauri's signing settings/provider before distributing broadly; see [Tauri's Windows signing guide](https://v2.tauri.app/distribute/sign/windows/). Signing credentials are not configured by this change.

Kopler and `local.kopler.desktop` remain the current development name/identifier. Keep the identifier stable for existing installations unless there is an explicit data migration plan.

## Signed automatic updates

The public repository hosts `https://github.com/ToolsLib/kopler/releases/latest/download/latest.json`. The updater checks stable releases only; candidates remain prerelease drafts. The feed maps Windows x64 and Linux x64 to their signed NSIS/AppImage packages, and both Mac architectures to the signed universal `.app.tar.gz`. The DMG and DEB remain manual installation packages. The manifest contains the signature contents, rather than signature URLs. Its URLs always point to the owning Release, including for manual candidate builds.

`bundle.createUpdaterArtifacts` is enabled. The verification key is embedded in `tauri.conf.json`, and `requireSignedVersion` prevents replaying an older signed package under a newer version number. The release job uses the encrypted repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Never expose them in logs or place a private key in Git or Release assets. The `.sig` files and public key are safe to publish. Updater signatures are independent of Windows publisher signing and Apple signing/notarization.

For local release packaging, set the same environment variables before `npm run release:windows`, `release:macos`, or `release:linux`. Tauri build accepts the encrypted key's file path as `TAURI_SIGNING_PRIVATE_KEY`. The signer CLI instead uses `TAURI_SIGNING_PRIVATE_KEY_PATH` when signing by file path. Normal development and `tauri build --no-bundle` do not need the private key.

The original encrypted key backup is `.cache/keys/kopler-updater.key`; its password is protected for the current Windows account and machine in `.cache/keys/kopler-updater-password.dpapi`. Keep a separate secure, portable backup of the key and password: the Windows password blob alone cannot be recovered on another machine, and GitHub does not reveal stored secret values. Losing the signing key prevents updates to installations that trust its public key. Key rotation requires an update signed by the existing key and a planned trust migration.

Versions up to 0.1.1 require a one-time manual upgrade to 0.1.2. The app then checks after startup and every six hours, with an opt-out and manual check in Settings. Installation requires an explicit **Install and restart** action, flushes pending writes first, and verifies signatures before replacing files. Linux package-managed installations offer the release download instead of modifying package-manager files. Opening and editing notes still works offline; an unavailable update endpoint reports a retryable error only in Settings.

For native diagnostics without opening Kopler, accessing notes, or installing anything:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --example updater-check -- check
cargo run --manifest-path src-tauri/Cargo.toml --example updater-check -- verify latest.json /path/to/package
```

The `verify` mode uses the real Tauri updater verifier and the embedded public key. It permits the current version only for this offline diagnostic; normal application checks require a newer version. Use the package for the machine's platform. A corrupted package or a manifest version different from its signed version must fail.

## Preparing the next version

Update `package.json`, both root versions in `package-lock.json`, the package version in `src-tauri/Cargo.toml`, the Kopler package entry in `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` together. Add `docs/releases/v<version>.md`, run `npm run release:check` and the checks above, then build/tag that version. Release notes should state any unvalidated native platform behavior and candidate signing limitations.

Verify download integrity from the folder containing the packages:

```sh
sha256sum --check SHA256SUMS.txt  # Linux
shasum -a 256 --check SHA256SUMS.txt  # macOS
```

On Windows, compare `(Get-FileHash .\Kopler_0.1.3_windows_x64-setup.exe -Algorithm SHA256).Hash` against its entry in `SHA256SUMS.txt`. Checksums detect file changes; they do not replace publisher signatures.
