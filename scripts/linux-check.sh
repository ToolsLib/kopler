#!/bin/sh
set -eu
mkdir -p /work/src-tauri
tar -C /source/src-tauri --exclude=target --exclude=gen -cf - . | tar -C /work/src-tauri -xf -
cp -R /source/dist /work/dist
cd /work
export CARGO_BUILD_JOBS=2
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
cargo build --manifest-path src-tauri/Cargo.toml --locked
dbus-run-session -- sh /source/scripts/linux-smoke.sh
