#!/usr/bin/env node
/* iter-137.l · Stamp the current git commit SHA into public/service-worker.js
 * so every production build ships a UNIQUE `VERSION` value. That single
 * change guarantees:
 *   - The activate() handler treats every cache from an older build as stale
 *     and purges it (keys are VERSION-suffixed).
 *   - Browsers detect the SW file has changed content → install → skipWaiting
 *     → clients.claim() → auto-reload — no more "blank page after deploy"
 *     because of stale cached JS bundles.
 *
 * Runs from package.json:  "prebuild": "node scripts/stamp-sw-version.js"
 * Falls back to a timestamp when git is unavailable (Emergent's build image
 * may not have git installed).
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const SW_PATH = path.join(__dirname, "..", "public", "service-worker.js");

function getSha() {
  // 1. Explicit env override (CI/CD can pin whatever it wants).
  const envSha = process.env.REACT_APP_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT;
  if (envSha) return String(envSha).slice(0, 12);
  // 2. Local git.
  try {
    const sha = execSync("git rev-parse --short=12 HEAD", { cwd: path.join(__dirname, "..", "..") }).toString().trim();
    if (sha) return sha;
  } catch { /* fallthrough */ }
  // 3. Timestamp fallback — still monotonic per build.
  return `t${Date.now().toString(36)}`;
}

function main() {
  if (!fs.existsSync(SW_PATH)) {
    console.warn(`[stamp-sw-version] ${SW_PATH} not found; skipping.`);
    return;
  }
  const sha = getSha();
  const stamp = `v-${sha}`;
  const src = fs.readFileSync(SW_PATH, "utf8");
  const re = /const\s+VERSION\s*=\s*"[^"]*";/;
  if (!re.test(src)) {
    console.warn("[stamp-sw-version] Could not find `const VERSION = \"...\";` line — SW format changed. Aborting to avoid a silent no-op.");
    process.exit(1);
  }
  const next = src.replace(re, `const VERSION = "${stamp}";`);
  if (next !== src) {
    fs.writeFileSync(SW_PATH, next, "utf8");
    console.log(`[stamp-sw-version] service-worker VERSION → ${stamp}`);
  } else {
    console.log(`[stamp-sw-version] service-worker VERSION unchanged (${stamp}) — no rewrite needed`);
  }
}

main();
