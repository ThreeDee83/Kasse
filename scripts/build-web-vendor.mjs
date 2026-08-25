import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = join(projectRoot, "vendor");
const vendorFiles = [
  ["node_modules/@supabase/supabase-js/dist/umd/supabase.js", "supabase.js"],
  ["node_modules/xlsx/dist/xlsx.full.min.js", "xlsx.full.min.js"],
  ["node_modules/bcryptjs/dist/bcrypt.min.js", "bcrypt.min.js"],
  ["node_modules/pdf-lib/dist/pdf-lib.min.js", "pdf-lib.min.js"]
];

await mkdir(outputDir, { recursive: true });
for (const [source, target] of vendorFiles) {
  const sourcePath = join(projectRoot, source);
  await access(sourcePath);
  await copyFile(sourcePath, join(outputDir, target));
}

console.log(`OwnCash Offline-Bibliotheken erstellt: ${outputDir}`);
