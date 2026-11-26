import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Tauri wraps the standard Minisign public key/signature text in base64.
// Verify both the prehashed payload and the trusted comment that binds its version.
export async function verifyUpdateSignature(path, encodedSignature, encodedKey, version) {
  const keyLines = Buffer.from(encodedKey.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const key = Buffer.from(keyLines[1] ?? '', 'base64');
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  const global = Buffer.from(lines[3] ?? '', 'base64');
  if (key.length !== 42 || key.subarray(0, 2).toString() !== 'Ed' || packet.length !== 74
      || packet.subarray(0, 2).toString() !== 'ED' || global.length !== 64
      || !key.subarray(2, 10).equals(packet.subarray(2, 10)) || !lines[2]?.startsWith('trusted comment: ')) {
    throw new Error('Invalid updater signature or signing key.');
  }
  const comment = lines[2].slice('trusted comment: '.length);
  if (!comment.split('\t').includes(`version:${version}`)) throw new Error('Updater signature does not match the release version.');
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), type: 'spki', format: 'der' });
  const signature = packet.subarray(10);
  const digest = createHash('blake2b512');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  if (!verify(null, digest.digest(), publicKey, signature)
      || !verify(null, Buffer.concat([signature, Buffer.from(comment)]), publicKey, global)) {
    throw new Error('Updater signature verification failed.');
  }
}
