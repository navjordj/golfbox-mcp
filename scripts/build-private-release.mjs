#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(rootDir, "release");
const buildDir = path.join(releaseDir, "build");
const packageDir = path.join(releaseDir, "package");
const siteDir = path.join(releaseDir, "site");

const rootPackage = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const version = rootPackage.version;
const bundleBaseName = `golfbox-mcp-private-v${version}`;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? rootDir,
      stdio: options.quiet ? "ignore" : "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...options.env }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function tryRun(command, args, options = {}) {
  try {
    await run(command, args, options);
    return true;
  } catch (error) {
    if (!options.quiet) {
      console.warn(error instanceof Error ? error.message : String(error));
    }
    return false;
  }
}

async function copyDir(source, target, options = {}) {
  await fs.mkdir(target, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (options.exclude?.(sourcePath, entry)) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function installProductionDependencies(targetDir) {
  await writeJson(path.join(targetDir, "package.json"), {
    name: rootPackage.name,
    version,
    private: true,
    type: "module",
    dependencies: rootPackage.dependencies
  });
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: targetDir
  });
}

async function validateCodexPlugin(pluginDir) {
  const validator = "/Users/christofferjahren/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py";
  const hasValidator = await tryRun("python3", ["-c", `import os, sys; sys.exit(0 if os.path.exists(${JSON.stringify(validator)}) else 1)`], {
    quiet: true
  });
  const hasYaml = await tryRun("python3", ["-c", "import yaml"], { quiet: true });
  if (hasValidator && hasYaml) {
    await run("python3", [validator, pluginDir]);
    return;
  }

  const pluginJson = JSON.parse(
    await fs.readFile(path.join(pluginDir, ".codex-plugin", "plugin.json"), "utf8")
  );
  const mcpJson = JSON.parse(await fs.readFile(path.join(pluginDir, ".mcp.json"), "utf8"));
  const skill = await fs.readFile(path.join(pluginDir, "skills", "golfbox", "SKILL.md"), "utf8");
  const errors = [];

  for (const field of ["name", "version", "description", "author", "interface", "mcpServers"]) {
    if (pluginJson[field] === undefined) {
      errors.push(`plugin.json missing ${field}`);
    }
  }
  if (pluginJson.name !== "golfbox-mcp") {
    errors.push("plugin.json name must be golfbox-mcp");
  }
  if (pluginJson.mcpServers !== "./.mcp.json") {
    errors.push("plugin.json mcpServers must point to ./.mcp.json");
  }
  if (!mcpJson.mcpServers?.golfbox) {
    errors.push(".mcp.json missing mcpServers.golfbox");
  }
  if (mcpJson.mcpServers?.golfbox?.command !== "node") {
    errors.push(".mcp.json golfbox server must use node");
  }
  if (!skill.startsWith("---\nname: golfbox\n")) {
    errors.push("golfbox skill is missing expected frontmatter");
  }

  if (errors.length > 0) {
    throw new Error(`Codex plugin fallback validation failed:\n${errors.join("\n")}`);
  }
  console.warn("Used built-in Codex plugin fallback validation.");
}

async function prepareServer(targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  await copyDir(path.join(rootDir, "dist"), path.join(targetDir, "dist"), {
    exclude: (sourcePath, entry) => entry.isFile() && /\.test\.js$/.test(sourcePath)
  });
  await installProductionDependencies(targetDir);
}

async function prepareMcpb() {
  const mcpbDir = path.join(buildDir, "mcpb", "golfbox-mcp");
  await prepareServer(path.join(mcpbDir, "server"));
  await writeJson(path.join(mcpbDir, "manifest.json"), {
    $schema: "https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest.schema.json",
    manifest_version: "0.3",
    name: "golfbox-mcp",
    display_name: "GolfBox MCP",
    version,
    description: "Local MCP tools for safe GolfBox tee-time search and booking preparation.",
    long_description:
      "GolfBox MCP lets Claude Desktop authenticate with GolfBox, list known clubs, search tee times, list bookings, and prepare bookings. Booking and cancellation tools are disabled by default.",
    author: {
      name: "Christoffer Jahren"
    },
    server: {
      type: "node",
      entry_point: "server/dist/index.js",
      mcp_config: {
        command: "node",
        args: ["${__dirname}/server/dist/index.js"],
        env: {
          GOLFBOX_PROVIDER: "official",
          GOLFBOX_USERNAME: "${user_config.GOLFBOX_USERNAME}",
          GOLFBOX_PASSWORD: "${user_config.GOLFBOX_PASSWORD}",
          GOLFBOX_COUNTRY: "${user_config.GOLFBOX_COUNTRY}",
          GOLFBOX_ENABLE_WRITE_TOOLS: "${user_config.GOLFBOX_ENABLE_WRITE_TOOLS}",
          GOLFBOX_REQUIRE_CONFIRMATION: "true",
          GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS: "20000",
          GOLFBOX_REQUEST_TIMEOUT_MS: "15000",
          GOLFBOX_WEB_REQUEST_TIMEOUT_MS: "15000",
          GOLFBOX_ALLOW_UNTRUSTED_URLS: "false",
          GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS: "false"
        }
      }
    },
    tools: [
      { name: "golfbox_authenticate", description: "Authenticate with GolfBox and validate the current credentials." },
      { name: "golfbox_list_clubs", description: "List GolfBox clubs known by the adapter." },
      { name: "golfbox_search_tee_times", description: "Search available tee times for a club and date." },
      { name: "golfbox_list_bookings", description: "List tee-time bookings for the authenticated GolfBox user." },
      { name: "golfbox_prepare_booking", description: "Validate and summarize a booking without creating it." },
      { name: "golfbox_create_booking", description: "Create a booking only when write tools are explicitly enabled." },
      { name: "golfbox_cancel_booking", description: "Cancel a booking only when write tools are explicitly enabled." }
    ],
    keywords: ["golf", "golfbox", "tee-time", "mcp"],
    license: "UNLICENSED",
    compatibility: {
      platforms: ["darwin", "win32"],
      runtimes: {
        node: ">=18.0.0"
      }
    },
    privacy_policies: ["https://www.golfbox.net/privacy-policy"],
    user_config: {
      GOLFBOX_USERNAME: {
        type: "string",
        title: "GolfBox username",
        description: "Your GolfBox username or email.",
        required: true
      },
      GOLFBOX_PASSWORD: {
        type: "string",
        title: "GolfBox password",
        description: "Your GolfBox password. Claude Desktop stores this as a sensitive local setting.",
        sensitive: true,
        required: true
      },
      GOLFBOX_COUNTRY: {
        type: "string",
        title: "GolfBox country",
        description: "Two-letter GolfBox country code.",
        default: "NO",
        required: false
      },
      GOLFBOX_ENABLE_WRITE_TOOLS: {
        type: "boolean",
        title: "Enable booking and cancellation tools",
        description: "Keep this off unless you deliberately want Claude to be able to book or cancel tee times.",
        default: false,
        required: false
      }
    }
  });
  await fs.writeFile(
    path.join(mcpbDir, ".mcpbignore"),
    [".env*", "*.log", "npm-debug.log*", "package-lock.json"].join("\n"),
    "utf8"
  );
  const outputFile = path.join(packageDir, "GolfBox MCP.mcpb");
  await run("npx", ["-y", "@anthropic-ai/mcpb", "validate", mcpbDir]);
  await run("npx", ["-y", "@anthropic-ai/mcpb", "pack", mcpbDir, outputFile]);
}

async function prepareCodexPlugin() {
  const pluginDir = path.join(buildDir, "codex-plugin", "golfbox-mcp");
  await prepareServer(path.join(pluginDir, "server"));
  await writeJson(path.join(pluginDir, ".codex-plugin", "plugin.json"), {
    name: "golfbox-mcp",
    version,
    description: "Local GolfBox MCP tools for Codex.",
    author: {
      name: "Christoffer Jahren"
    },
    keywords: ["golf", "golfbox", "tee-time", "mcp"],
    mcpServers: "./.mcp.json",
    skills: "./skills/",
    interface: {
      displayName: "GolfBox MCP",
      shortDescription: "Search and prepare GolfBox tee times from Codex.",
      longDescription:
        "Local MCP tools for GolfBox authentication, club listing, tee-time search, booking listing, and safe booking preparation. Booking and cancellation tools are disabled by default.",
      developerName: "Christoffer Jahren",
      category: "Productivity",
      capabilities: ["MCP", "Local", "GolfBox"],
      brandColor: "#1F7A5C",
      defaultPrompt: [
        "Authenticate with GolfBox and list known clubs.",
        "Search GolfBox tee times without booking anything.",
        "Prepare a GolfBox booking summary only."
      ]
    }
  });
  await writeJson(path.join(pluginDir, ".mcp.json"), {
    mcpServers: {
      golfbox: {
        command: "node",
        args: ["./server/dist/index.js"],
        env: {
          GOLFBOX_PROVIDER: "official",
          GOLFBOX_COUNTRY: "NO",
          GOLFBOX_ENABLE_WRITE_TOOLS: "false",
          GOLFBOX_REQUIRE_CONFIRMATION: "true",
          GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS: "20000",
          GOLFBOX_REQUEST_TIMEOUT_MS: "15000",
          GOLFBOX_WEB_REQUEST_TIMEOUT_MS: "15000",
          GOLFBOX_ALLOW_UNTRUSTED_URLS: "false",
          GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS: "false"
        },
        env_vars: ["GOLFBOX_USERNAME", "GOLFBOX_PASSWORD", "GOLFBOX_API_TOKEN"]
      }
    }
  });
  await fs.mkdir(path.join(pluginDir, "skills", "golfbox"), { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "skills", "golfbox", "SKILL.md"),
    [
      "---",
      "name: golfbox",
      "description: Use GolfBox MCP to authenticate, list clubs, search tee times, list bookings, and prepare bookings safely.",
      "---",
      "",
      "Use the bundled GolfBox MCP server for GolfBox tasks. Start with `golfbox_authenticate` when credentials are needed, then prefer read-only tools such as `golfbox_list_clubs`, `golfbox_search_tee_times`, and `golfbox_list_bookings`.",
      "",
      "Do not create or cancel bookings unless the user explicitly asks for that exact action and confirms write tools are enabled. Prefer `golfbox_prepare_booking` before any write action.",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(pluginDir, "README.md"),
    [
      "# GolfBox MCP Codex plugin",
      "",
      "This private plugin bundles the local GolfBox MCP server for Codex.",
      "",
      "Configure credentials in Codex's MCP environment using either `GOLFBOX_USERNAME` + `GOLFBOX_PASSWORD`, or `GOLFBOX_API_TOKEN`. Booking and cancellation are disabled by default with `GOLFBOX_ENABLE_WRITE_TOOLS=false`.",
      ""
    ].join("\n"),
    "utf8"
  );
  await validateCodexPlugin(pluginDir);
  await zipDirectory(pluginDir, path.join(packageDir, "golfbox-mcp-codex-plugin.zip"));
}

async function zipDirectory(sourceDir, outputFile) {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.rm(outputFile, { force: true });
  await run("zip", ["-qr", outputFile, "."], { cwd: sourceDir });
}

async function createSourceSummary() {
  await fs.copyFile(path.join(rootDir, "INSTALL.md"), path.join(packageDir, "INSTALL.md"));
  await fs.writeFile(
    path.join(packageDir, "README.txt"),
    `GolfBox MCP private release v${version}\n\nContents:\n- GolfBox MCP.mcpb: install this in Claude Desktop.\n- golfbox-mcp-codex-plugin.zip: private Codex plugin bundle.\n- INSTALL.md: short end-user setup instructions.\n\nCredentials stay local on each user's machine. Booking and cancellation tools are disabled by default.\n`,
    "utf8"
  );
  await zipDirectory(packageDir, path.join(releaseDir, `${bundleBaseName}.zip`));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function downloadLink(fileName) {
  return `downloads/${encodeURIComponent(fileName).replaceAll("%2F", "/")}`;
}

async function createPagesSite() {
  const downloadsDir = path.join(siteDir, "downloads");
  await fs.rm(siteDir, { recursive: true, force: true });
  await fs.mkdir(downloadsDir, { recursive: true });

  const files = [
    `${bundleBaseName}.zip`,
    "GolfBox MCP.mcpb",
    "golfbox-mcp-codex-plugin.zip",
    "INSTALL.md",
    "README.txt"
  ];

  for (const fileName of files) {
    const sourceDir = fileName === `${bundleBaseName}.zip` ? releaseDir : packageDir;
    await fs.copyFile(path.join(sourceDir, fileName), path.join(downloadsDir, fileName));
  }

  const buildDate = new Date().toISOString();
  const commitSha = process.env.GITHUB_SHA ?? "local";
  const rows = files
    .map((fileName) => {
      const label =
        fileName === `${bundleBaseName}.zip`
          ? "Complete release bundle"
          : fileName === "GolfBox MCP.mcpb"
            ? "Claude Desktop MCPB"
            : fileName === "golfbox-mcp-codex-plugin.zip"
              ? "Codex plugin bundle"
              : fileName;
      return `<li><a href="${downloadLink(fileName)}">${escapeHtml(label)}</a><span>${escapeHtml(fileName)}</span></li>`;
    })
    .join("\n");

  await fs.writeFile(
    path.join(siteDir, "index.html"),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GolfBox MCP downloads</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f8f5;
      --text: #17211c;
      --muted: #5b665f;
      --line: #d9ded6;
      --accent: #126b52;
      --surface: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111713;
        --text: #edf3ef;
        --muted: #a9b5ae;
        --line: #2c3932;
        --accent: #6fddb8;
        --surface: #18211c;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      width: min(880px, calc(100% - 32px));
      margin: 0 auto;
      padding: 56px 0;
    }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 6vw, 4rem);
      line-height: 1;
      letter-spacing: 0;
    }
    p {
      margin: 0;
      max-width: 680px;
      color: var(--muted);
      font-size: 1.05rem;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 32px 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      overflow: hidden;
    }
    li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: center;
      padding: 18px 20px;
      border-top: 1px solid var(--line);
    }
    li:first-child { border-top: 0; }
    a {
      color: var(--accent);
      font-weight: 700;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    span {
      color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.88rem;
      word-break: break-word;
    }
    footer {
      color: var(--muted);
      font-size: 0.9rem;
    }
    @media (max-width: 640px) {
      li {
        grid-template-columns: 1fr;
        gap: 6px;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>GolfBox MCP downloads</h1>
    <p>Latest private build from main. Credentials stay local on each user's machine, and booking or cancellation tools are disabled by default.</p>
    <ul>
${rows}
    </ul>
    <footer>Version ${escapeHtml(version)}. Built ${escapeHtml(buildDate)} from ${escapeHtml(commitSha.slice(0, 12))}.</footer>
  </main>
</body>
</html>
`,
    "utf8"
  );
}

await fs.rm(buildDir, { recursive: true, force: true });
await fs.rm(packageDir, { recursive: true, force: true });
await fs.mkdir(packageDir, { recursive: true });

if (!(await tryRun("bun", ["run", "build"]))) {
  await run("npm", ["run", "build"]);
}
await prepareMcpb();
await prepareCodexPlugin();
await createSourceSummary();
await createPagesSite();

console.log(`\nCreated ${path.join(releaseDir, `${bundleBaseName}.zip`)}`);
console.log(`Created ${path.join(siteDir, "index.html")}`);
