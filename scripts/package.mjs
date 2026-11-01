import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.id, 'word-bridge-maimemo');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
const folder = manifest.id;
const runtime = path.join(root, 'dist', folder);
const release = path.join(root, 'release');
const files = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dictionary.json', 'main.js', 'manifest.json', 'styles.css', 'versions.json'];
assert.deepEqual((await readdir(runtime)).sort(), files);
await mkdir(release, { recursive: true });

// Standard ZIP records; fixed DOS timestamp keeps identical inputs reproducible.
const localParts = [], centralParts = [];
let offset = 0;
for (const file of files) {
  const data = await readFile(path.join(runtime, file));
  const name = Buffer.from(`${folder}/${file}`, 'utf8');
  const compressed = deflateRawSync(data, { level: 9 });
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(33, 12); // 1980-01-01
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  localParts.push(local, name, compressed);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centralParts.push(central, name);
  offset += local.length + name.length + compressed.length;
}
const central = Buffer.concat(centralParts);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);
const zipName = `${folder}-${manifest.version}.zip`;
await writeFile(path.join(release, zipName), Buffer.concat([...localParts, central, end]));
for (const file of files) await copyFile(path.join(runtime, file), path.join(release, file));
const hashes = [];
for (const file of [...files, zipName].sort()) {
  const digest = createHash('sha256').update(await readFile(path.join(release, file))).digest('hex');
  hashes.push(`${digest}  ${file}`);
}
await writeFile(path.join(release, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
console.log(`Release files ready: release/${zipName}`);
