# GolfBox MCP

GolfBox MCP is a local MCP server for GolfBox tee-time workflows. It lets compatible agent clients authenticate with GolfBox, list clubs, search tee times, list bookings, list tournaments, and prepare bookings with conservative safety defaults.

The server runs locally. GolfBox credentials stay on the user's machine, and booking or cancellation tools are disabled unless explicitly enabled.

## Downloads

Latest builds from `main` are published to GitHub Pages:

```text
https://j4hr3n.github.io/golfbox-mcp/
```

The release bundle contains:

- `GolfBox MCP.mcpb` for Claude Desktop.
- `golfbox-mcp-codex-plugin.zip` for Codex.
- `INSTALL.md` with end-user setup instructions.

## Development

This repo uses Bun as the package manager, development runtime, and test runner. The built server output is Node-compatible for distribution.

```bash
bun install
bun test src/**/*.test.ts
bun run build
bun run dev
```

Build a private release package locally:

```bash
bun run build:private-release
```

The script writes release artifacts to `release/`, including a static Pages site under `release/site/`.

## Local MCP Config

After building, the server can be registered in any stdio MCP-compatible client:

```json
{
  "mcpServers": {
    "golfbox": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/golfbox-mcp/dist/index.js"],
      "env": {
        "GOLFBOX_PROVIDER": "official",
        "GOLFBOX_USERNAME": "your-username",
        "GOLFBOX_PASSWORD": "your-password",
        "GOLFBOX_COUNTRY": "NO",
        "GOLFBOX_ENABLE_WRITE_TOOLS": "false"
      }
    }
  }
}
```

For the local Codex setup in this repo, credentials can be stored in `.env.local`:

```bash
bun run set-credentials
```

The script prompts for username and password, writes `.env.local`, and sets file permissions to `600`.

If you already have a valid MobileHub token, set `GOLFBOX_API_TOKEN` instead of `GOLFBOX_USERNAME` and `GOLFBOX_PASSWORD`.

## Tools

- `golfbox_authenticate`: authenticate and validate the current GolfBox credentials.
- `golfbox_list_clubs`: list GolfBox clubs known by the adapter.
- `golfbox_search_tee_times`: search available tee times for a club and date.
- `golfbox_list_bookings`: list tee-time bookings for the authenticated user.
- `golfbox_list_tournaments`: list tournaments the authenticated user is registered for or has participated in.
- `golfbox_prepare_booking`: validate and summarize a booking without creating it.
- `golfbox_create_booking`: create a booking when write tools are enabled and confirmed.
- `golfbox_cancel_booking`: cancel a booking when write tools are enabled and confirmed.

## Safety Defaults

Booking and cancellation are off by default with `GOLFBOX_ENABLE_WRITE_TOOLS=false`.

When write tools are enabled, booking still requires `confirmedByUser=true`, explicit confirmation text, and an `idempotencyKey`. The adapter stores idempotency only in memory while the MCP server is running.

Network calls require HTTPS and known GolfBox hosts by default. Error messages redact known sensitive values, and response-body snippets are disabled unless `GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS=true` is set for local debugging.

Common environment defaults:

```text
GOLFBOX_PROVIDER=official
GOLFBOX_COUNTRY=NO
GOLFBOX_ENABLE_WRITE_TOOLS=false
GOLFBOX_REQUIRE_CONFIRMATION=true
GOLFBOX_SAVE_TEE_TIME_TIMEOUT_MS=20000
GOLFBOX_REQUEST_TIMEOUT_MS=15000
GOLFBOX_WEB_REQUEST_TIMEOUT_MS=15000
GOLFBOX_ALLOW_UNTRUSTED_URLS=false
GOLFBOX_INCLUDE_ERROR_BODY_SNIPPETS=false
```

## Project Notes

The GolfBox integration is based on the MobileHub/web flows used by GolfBox clients. Deeper implementation notes and endpoint details live in `docs/` so the README can stay focused on usage and release flow.
