// Syntax-check every source module with `node --check` — cross-platform, no shell
// globbing, so it runs identically on Windows (cmd), Git Bash, and CI (Linux).
// Walks the repo from the cwd, skipping deps/data/dot-dirs.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'data' || name === 'profiles' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.mjs') || name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(process.cwd());
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f]);
  } catch (e) {
    failed++;
    console.error(`SYNTAX FAIL: ${f}\n${e.stderr?.toString() || e.message}`);
  }
}
if (failed) {
  console.error(`${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`syntax OK: ${files.length} file(s)`);
