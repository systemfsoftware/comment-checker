#!/usr/bin/env -S deno run --allow-read

import { type } from 'arktype'

const Semver = type('string')
const isNotFound = (e: unknown): boolean =>
  e !== null && typeof e === 'object' && 'name' in e && Reflect.get(e, 'name') === 'NotFound'

function extractVersion(content: string, header: string): string | null {
  const lines = content.split("\n");
  let inTarget = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inTarget = trimmed === header;
    } else if (inTarget && trimmed.startsWith("version")) {
      const m = /version\s*=\s*"([^"]+)"/.exec(trimmed);
      if (m) return Semver.assert(m[1]);
    }
  }
  return null;
}

function extractNixVersion(content: string): string | null {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith('version = "')) {
      const m = /version\s*=\s*"([^"]+)"/.exec(trimmed);
      if (m) return Semver.assert(m[1]);
    }
  }
  return null;
}

function extractJsonVersion(text: string, path: string): string {
  const m = /"version"\s*:\s*"([^"]+)"/.exec(text)
  if (!m) throw new Error(`no version field in ${path}`)
  return Semver.assert(m[1])
}

const npmText = await Deno.readTextFile("npm/packages/comment-checker/package.json")
const npmVersion = extractJsonVersion(npmText, "npm/packages/comment-checker/package.json")

const workspaceContent = await Deno.readTextFile("Cargo.toml");
const workspaceVersion = extractVersion(workspaceContent, "[workspace.package]");
if (!workspaceVersion) {
  console.error("check-versions: no version found under [workspace.package] in Cargo.toml");
  Deno.exit(1);
}

const mismatches: string[] = [];
if (workspaceVersion !== npmVersion) {
  mismatches.push(`Cargo.toml workspace ${workspaceVersion} != npm ${npmVersion}`);
}

for await (const entry of Deno.readDir("crates")) {
  if (!entry.isDirectory) continue;
  const path = `crates/${entry.name}/Cargo.toml`;
  try {
    const content = await Deno.readTextFile(path);
    const crateVersion = extractVersion(content, "[package]");
    if (crateVersion && crateVersion !== npmVersion) {
      mismatches.push(`${path} ${crateVersion} != npm ${npmVersion}`);
    }
  } catch (e) {
    if (isNotFound(e)) continue;
    throw e;
  }
}

try {
  const nixContent = await Deno.readTextFile("flake.nix");
  const nixVersion = extractNixVersion(nixContent);
  if (nixVersion && nixVersion !== npmVersion) {
    mismatches.push(`flake.nix ${nixVersion} != npm ${npmVersion}`);
  }
} catch (e) {
  if (!isNotFound(e)) throw e;
}
try {
  const rootText = await Deno.readTextFile("package.json")
  const rootVersion = extractJsonVersion(rootText, "package.json")
  if (rootVersion !== npmVersion) {
    mismatches.push(`package.json root ${rootVersion} != npm ${npmVersion}`);
  }
} catch (e) {
  if (!isNotFound(e)) throw e;
}

let pluginChecked = 0;
for (const p of [".claude-plugin/plugin.json"]) {
  try {
    const content = await Deno.readTextFile(p);
    const pluginVersion = extractJsonVersion(content, p)
    if (pluginVersion !== npmVersion) {
      mismatches.push(`${p} ${pluginVersion} != npm ${npmVersion}`);
    }
    pluginChecked++;
  } catch (e) {
    if (isNotFound(e)) continue;
    const isSyntax = e !== null && typeof e === 'object' && 'name' in e && Reflect.get(e, 'name') === 'SyntaxError'
    if (isSyntax) continue;
    throw e;
  }
}

if (mismatches.length > 0) {
  for (const m of mismatches) console.error(`check-versions: ${m}`);
  Deno.exit(1);
}

if (pluginChecked === 0) {
  console.log(`check-versions: ok npm=${npmVersion} workspace=${workspaceVersion} (plugin manifest: none tracked)`);
} else {
  console.log(`check-versions: ok npm=${npmVersion} workspace=${workspaceVersion}`);
}
