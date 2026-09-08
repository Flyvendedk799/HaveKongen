#!/usr/bin/env node
/**
 * Syntax-check the Supabase edge functions.
 *
 * These are Deno files with remote URL imports, so `tsc` and the app's ESLint
 * pass do not compile them and CI never used to look at them at all. A syntax
 * error therefore only showed up as a 503 BOOT_ERROR in production — which is
 * exactly how `await guard(...)` inside a non-async handler reached the live
 * site.
 *
 * esbuild parses each file without resolving its imports, which is enough to
 * catch that whole class of mistake.
 */

import { readdirSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");

const files = [];
for (const entry of readdirSync(FUNCTIONS, { withFileTypes: true })) {
  if (entry.name === "_shared") {
    for (const shared of readdirSync(join(FUNCTIONS, entry.name))) {
      if (shared.endsWith(".ts")) files.push(join(FUNCTIONS, entry.name, shared));
    }
    continue;
  }
  if (!entry.isDirectory()) continue;
  const index = join(FUNCTIONS, entry.name, "index.ts");
  if (existsSync(index)) files.push(index);
}

let failed = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  const label = file.slice(FUNCTIONS.length + 1).replace(/\\/g, "/");
  try {
    await transform(source, { loader: "ts", format: "esm", target: "esnext" });
    console.log(`ok    ${label}`);
  } catch (error) {
    failed++;
    const detail = error.errors?.map((e) => `${e.text} (line ${e.location?.line})`).join("; ") ?? error.message;
    console.error(`FAIL  ${label}\n      ${detail}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} edge functions parse cleanly.`);
process.exit(failed ? 1 : 0);
