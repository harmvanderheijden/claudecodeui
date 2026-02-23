#!/usr/bin/env node
/**
 * Copy pdfjs-dist WASM files to public/pdfjs-wasm/
 *
 * PDF.js needs OpenJPEG WASM for decoding JPEG 2000 images (common in scanned PDFs).
 * The worker loads these from the wasmUrl option, which must point to same-origin files
 * to avoid CORS issues. This script copies them from node_modules so they're served
 * locally by both the Vite dev server and the production build.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'wasm');
const dest = path.join(__dirname, '..', 'public', 'pdfjs-wasm');

async function copyWasm() {
  try {
    await fs.mkdir(dest, { recursive: true });
    const files = await fs.readdir(src);
    for (const file of files) {
      await fs.copyFile(path.join(src, file), path.join(dest, file));
    }
    console.log(`[postinstall] Copied ${files.length} pdfjs-dist WASM files to public/pdfjs-wasm/`);
  } catch (err) {
    console.warn(`[postinstall] Warning: Could not copy pdfjs WASM files: ${err.message}`);
  }
}

copyWasm();
