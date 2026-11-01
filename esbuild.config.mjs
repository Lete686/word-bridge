import esbuild from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv[2] === 'production';
const outdir = path.join(root, 'dist', 'word-bridge-maimemo');

const relativeOutput = path.relative(root, path.resolve(outdir));
if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
  throw new Error('Build output escaped the project directory');
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'src', 'main.ts')],
  bundle: true,
  external: ['obsidian', 'electron'],
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: production ? false : 'inline',
  minify: production,
  treeShaking: true,
  outfile: path.join(outdir, 'main.js'),
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
});

for (const file of ['manifest.json', 'styles.css', 'versions.json']) {
  await copyFile(path.join(root, file), path.join(outdir, file));
}
const dict = path.join(root, 'assets', 'dictionary.json');
if (!existsSync(dict)) throw new Error('缺少 assets/dictionary.json，请先运行 tools/build_dictionary.py');
await copyFile(dict, path.join(outdir, 'dictionary.json'));
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  if (existsSync(path.join(root, file))) {
    await copyFile(path.join(root, file), path.join(outdir, file));
  }
}

console.log(`built ${outdir}`);
