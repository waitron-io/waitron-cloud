import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive: true});
await build({entryPoints: ['src/main.ts'], bundle: true, format: 'esm', target: 'es2023', outfile: 'dist/app.js', minify: true});
await copyFile('src/index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/app.css');
