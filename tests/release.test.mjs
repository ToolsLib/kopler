import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAssets, checksums, checkVersion, platforms, stage } from '../scripts/release.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kopler-release-'));
  t.after(async () => {
    if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('kopler-release-')) throw new Error('Unexpected fixture cleanup path');
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(directory, 'src-tauri'), { recursive: true });
  await mkdir(join(directory, 'docs/releases'), { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(join(directory, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' } } }));
  await writeFile(join(directory, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(join(directory, 'src-tauri/Cargo.toml'), '[package]\nname = "kopler"\nversion = "0.1.0"\n\n[dependencies]\n');
  await writeFile(join(directory, 'src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "kopler"\nversion = "0.1.0"\n');
  await writeFile(join(directory, 'docs/releases/v0.1.0.md'), 'Release candidate notes');
  return directory;
}

async function bundle(directory, platform, kind, name, contents = 'fixture package') {
  const folder = join(directory, 'src-tauri/target', platforms[platform].target ?? '', 'release/bundle', kind);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, name), contents);
}

test('release checks require synchronized manifests/locks, matching tags, and release notes', async t => {
  const directory = await fixture(t);
  assert.equal(await checkVersion(directory, 'v0.1.0'), '0.1.0');
  await assert.rejects(checkVersion(directory, 'v0.2.0'), /does not match/);
  await writeFile(join(directory, 'src-tauri/Cargo.lock'), '[[package]]\nname = "kopler"\nversion = "0.2.0"\n');
  await assert.rejects(checkVersion(directory), /versions must match/);
  await writeFile(join(directory, 'src-tauri/Cargo.lock'), '[[package]]\nname = "kopler"\nversion = "0.1.0"\n');
  await rm(join(directory, 'docs/releases/v0.1.0.md'));
  await assert.rejects(checkVersion(directory), /ENOENT/);
});

test('staging finds native Windows and universal macOS bundles and records their exact hashes', async t => {
  const directory = await fixture(t);
  for (const [platform, kind, name] of [
    ['windows', 'nsis', 'Kopler_0.1.0_x64-setup.exe'],
    ['macos', 'dmg', 'Kopler_0.1.0_universal.dmg'],
  ]) {
    await bundle(directory, platform, kind, name);
    const output = await stage(directory, platform);
    const outputName = `Kopler_0.1.0_${platforms[platform].suffix}${platforms[platform].bundles[kind]}`;
    assert.equal(await readFile(join(output, outputName), 'utf8'), 'fixture package');
    assert.equal(await readFile(join(output, 'SHA256SUMS.txt'), 'utf8'), `${createHash('sha256').update('fixture package').digest('hex')}  ${outputName}\n`);
  }
});

test('staging rejects incomplete, wrong-version, empty, and ambiguous package sets', async t => {
  const directory = await fixture(t);
  await bundle(directory, 'linux', 'appimage', 'Kopler_0.1.0_amd64.AppImage');
  await bundle(directory, 'linux', 'deb', 'Kopler_0.0.9_amd64.deb');
  await assert.rejects(stage(directory, 'linux'), /Expected one.*deb/);
  await assert.rejects(readdir(join(directory, '.release')), /ENOENT/);
  await bundle(directory, 'linux', 'deb', 'Kopler_0.1.0_amd64.deb', '');
  await assert.rejects(stage(directory, 'linux'), /Empty release package/);
  await bundle(directory, 'linux', 'deb', 'Kopler_0.1.0_amd64.deb');
  await bundle(directory, 'linux', 'deb', 'Kopler_0.1.0_extra.deb');
  await assert.rejects(stage(directory, 'linux'), /found 2/);
});

test('release assembly requires all four current-version packages and excludes unexpected files', async t => {
  const directory = await fixture(t);
  const output = join(directory, 'combined');
  await mkdir(output);
  await assert.rejects(checksums(output), /No release packages/);
  for (const config of Object.values(platforms)) {
    for (const extension of Object.values(config.bundles)) {
      await writeFile(join(output, `Kopler_0.1.0_${config.suffix}${extension}`), 'release package');
    }
  }
  assert.equal((await checkAssets(output, '0.1.0')).length, 4);
  const original = await readFile(join(output, 'SHA256SUMS.txt'), 'utf8');
  await writeFile(join(output, 'Kopler_0.1.0_windows_x64-setup.exe'), 'changed package');
  await checkAssets(output, '0.1.0');
  assert.notEqual(await readFile(join(output, 'SHA256SUMS.txt'), 'utf8'), original);
  await writeFile(join(output, 'unexpected.exe'), 'unexpected package');
  await assert.rejects(checkAssets(output, '0.1.0'), /incomplete or unexpected/);
  await rm(join(output, 'unexpected.exe'));
  await rm(join(output, 'Kopler_0.1.0_macos_universal.dmg'));
  await assert.rejects(checkAssets(output, '0.1.0'), /incomplete or unexpected/);
});
