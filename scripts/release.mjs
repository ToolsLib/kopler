import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const platforms = {
  windows: { os: 'win32', arch: 'x64', suffix: 'windows_x64', bundles: { nsis: '-setup.exe' } },
  macos: { os: 'darwin', suffix: 'macos_universal', target: 'universal-apple-darwin', bundles: { dmg: '.dmg' } },
  linux: { os: 'linux', arch: 'x64', suffix: 'linux_x64', bundles: { appimage: '.AppImage', deb: '.deb' } },
};
const json = async path => JSON.parse(await readFile(path, 'utf8'));

export async function checkVersion(directory = root, tag) {
  const pkg = await json(join(directory, 'package.json'));
  const lock = await json(join(directory, 'package-lock.json'));
  const config = await json(join(directory, 'src-tauri/tauri.conf.json'));
  const cargo = await readFile(join(directory, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoLock = await readFile(join(directory, 'src-tauri/Cargo.lock'), 'utf8');
  const cargoVersion = cargo.match(/\[package\]([\s\S]*?)(?=\n\[|$)/)?.[1].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockedVersion = cargoLock.split('[[package]]').find(block => /^name\s*=\s*"kopler"/m.test(block))?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const versions = [pkg.version, lock.version, lock.packages?.['']?.version, config.version, cargoVersion, lockedVersion];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version) || versions.some(version => version !== pkg.version)) {
    throw new Error(`Release versions must match in package.json, package-lock.json, Cargo.toml, Cargo.lock, and tauri.conf.json: ${versions.join(', ')}`);
  }
  if (tag && tag !== `v${pkg.version}`) throw new Error(`Tag ${tag} does not match v${pkg.version}.`);
  await readFile(join(directory, 'docs/releases', `v${pkg.version}.md`), 'utf8');
  return pkg.version;
}

async function hash(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export async function checksums(directory) {
  const names = (await readdir(directory)).filter(name => /^Kopler_.*(?:\.exe|\.dmg|\.AppImage|\.deb)$/.test(name)).sort();
  if (!names.length) throw new Error(`No release packages found in ${directory}.`);
  const lines = [];
  for (const name of names) {
    if (!(await stat(join(directory, name))).size) throw new Error(`Empty release package: ${name}`);
    lines.push(`${await hash(join(directory, name))}  ${name}`);
  }
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  return names;
}

export async function stage(directory, platform) {
  const config = platforms[platform];
  if (!config) throw new Error(`Unknown release platform: ${platform}`);
  const version = await checkVersion(directory);
  const bundleRoot = join(directory, 'src-tauri/target', config.target ?? '', 'release/bundle');
  const destination = join(directory, '.release', version, platform);
  // Resolve every expected bundle before copying any of them. Missing/stale versions fail closed.
  const sources = [];
  for (const [bundle, extension] of Object.entries(config.bundles)) {
    const folder = join(bundleRoot, bundle);
    const candidates = (await readdir(folder)).filter(name => name.startsWith(`Kopler_${version}_`) && name.endsWith(extension));
    if (candidates.length !== 1) throw new Error(`Expected one ${platform} ${bundle} package for ${version}; found ${candidates.length}.`);
    const source = join(folder, candidates[0]);
    if (!(await stat(source)).size) throw new Error(`Empty release package: ${source}`);
    sources.push([source, `Kopler_${version}_${config.suffix}${extension}`]);
  }
  await mkdir(destination, { recursive: true });
  for (const [source, name] of sources) await copyFile(source, join(destination, name));
  await checksums(destination);
  return destination;
}

export async function checkAssets(directory, version) {
  const expected = Object.values(platforms).flatMap(config => Object.values(config.bundles).map(extension => `Kopler_${version}_${config.suffix}${extension}`)).sort();
  const actual = (await readdir(directory)).filter(name => name !== 'SHA256SUMS.txt').sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Release assets are incomplete or unexpected. Required: ${expected.join(', ')}`);
  return checksums(directory);
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
  const version = await checkVersion(root, tag);
  if (command === 'check') {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    console.log(`Release v${version}: all versions and release notes match.`); return;
  }
  if (command === 'checksums') { await checksums(resolve(argument)); return; }
  if (command === 'verify-assets') { await checkAssets(resolve(argument), version); return; }
  if (!['build', 'stage'].includes(command) || !platforms[argument]) throw new Error('Usage: release.mjs check | build|stage windows|macos|linux | checksums|verify-assets DIRECTORY');
  if (command === 'build') {
    const config = platforms[argument];
    if (process.platform !== config.os || (config.arch && process.arch !== config.arch)) throw new Error(`Build ${argument} on its native ${config.arch ?? 'macOS'} host.`);
    const args = [join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--ci', '--bundles', Object.keys(config.bundles).join(',')];
    if (config.target) args.push('--target', config.target);
    const env = { ...process.env };
    if (argument === 'macos' && !env.APPLE_SIGNING_IDENTITY) env.APPLE_SIGNING_IDENTITY = '-';
    args.push('--', '--locked');
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native ${argument} release build failed (${result.status ?? result.signal}).`);
  }
  console.log(`Release packages: ${await stage(root, argument)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
