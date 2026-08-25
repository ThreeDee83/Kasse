import { access, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(projectRoot, "www");
if (outputDir !== join(projectRoot, "www")) throw new Error("Ungültiges Android-Ausgabeverzeichnis");

const runtimeFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "cloud.js",
  "config.js",
  "xlsx-export.js",
  "pdf-export.js",
  "manifest.webmanifest",
  "sw.js"
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(join(outputDir, "vendor"), { recursive: true });

for (const file of runtimeFiles) {
  await copyFile(join(projectRoot, file), join(outputDir, file));
}
await cp(join(projectRoot, "assets"), join(outputDir, "assets"), { recursive: true });

const vendorFiles = [
  ["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "vendor/supabase.js"],
  ["node_modules/xlsx/dist/xlsx.full.min.js", "vendor/xlsx.full.min.js"],
  ["node_modules/pdf-lib/dist/pdf-lib.min.js", "vendor/pdf-lib.min.js"]
];
for (const [source, target] of vendorFiles) {
  await access(join(projectRoot, source));
  await copyFile(join(projectRoot, source), join(outputDir, target));
}

const indexPath = join(outputDir, "index.html");
const nativeIndex = (await readFile(indexPath, "utf8"))
  .replace("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", "vendor/supabase.js")
  .replace("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "vendor/xlsx.full.min.js")
  .replace("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js", "vendor/pdf-lib.min.js");
await writeFile(indexPath, nativeIndex, "utf8");

console.log(`OwnCash Android-Webdateien erstellt: ${outputDir}`);
