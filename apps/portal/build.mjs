import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', {recursive: true});
await build({entryPoints: ['src/main.ts'], bundle: true, format: 'esm', target: 'es2023', outfile: 'dist/app.js', minify: true});
await build({entryPoints: ['src/worldwide.ts'], bundle: true, format: 'esm', target: 'es2023', outfile: 'dist/worldwide.js', minify: true});
await build({entryPoints: ['src/backup-download-worker.ts'], bundle: true, format: 'iife', target: 'es2023', outfile: 'dist/backup-download-worker.js', minify: true});
await build({entryPoints: ['src/venue-dns-pdf.ts'], bundle: true, format: 'esm', target: 'es2023', outfile: 'dist/venue-dns-pdf.js', minify: true});
await copyFile('src/index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/app.css');
