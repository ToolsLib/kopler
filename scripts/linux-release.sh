#!/bin/sh
set -eu
# /source is the read-only checkout; /work and Cargo use isolated reusable volumes.
tar -C /source --exclude=node_modules --exclude=.cache --exclude=.release \
  --exclude=.git --exclude=src-tauri/target --exclude=src-tauri/gen \
  --exclude=test-results --exclude=playwright-report --exclude=dist -cf - . | tar -C /work -xf -
cd /work
export CARGO_BUILD_JOBS=2
export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=1
npm ci
npm run release:check
npm run test:release
npm test
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --locked
npm run release:linux
version=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version')
mkdir -p "/output/$version/linux"
cp ".release/$version/linux/"* "/output/$version/linux/"
echo "Linux packages copied to /output/$version/linux"
