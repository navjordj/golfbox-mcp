#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(rootDir, ".env.local");

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!process.env[key]) {
      process.env[key] = parseEnvValue(rawValue);
    }
  }
}

process.env.GOLFBOX_PROVIDER ??= "official";
process.env.GOLFBOX_COUNTRY ??= "NO";
process.env.GOLFBOX_ENABLE_WRITE_TOOLS ??= "false";
process.env.GOLFBOX_REQUIRE_CONFIRMATION ??= "true";
process.env.GOLFBOX_REQUEST_TIMEOUT_MS ??= "15000";
process.env.GOLFBOX_WEB_REQUEST_TIMEOUT_MS ??= "15000";
process.env.GOLFBOX_ALLOW_UNTRUSTED_URLS ??= "false";
process.env.GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS ??= "false";

await import(pathToFileURL(path.join(rootDir, "dist/index.js")).href);
