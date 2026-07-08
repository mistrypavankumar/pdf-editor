// Copy the pdfjs worker into public/ so it is served as a static asset and
// never re-bundled/re-minified by webpack (the shipped worker is already
// minified ESM, which Terser can't re-parse). Kept in sync with the installed
// pdfjs-dist version by running before dev/build.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("pdfjs-dist/package.json");
const src = join(dirname(pkgPath), "build", "pdf.worker.min.mjs");
const destDir = join(process.cwd(), "public");
const dest = join(destDir, "pdf.worker.min.mjs");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-worker] ${src} -> ${dest}`);
