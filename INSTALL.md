# Install GolfBox MCP

This private package contains local MCP integrations for Claude Desktop and Codex. Your GolfBox username and password stay on your own machine. Booking and cancellation tools are disabled by default.

## If you use Claude Desktop

1. Open `GolfBox MCP.mcpb`.
2. Follow Claude Desktop's install prompt.
3. Enter your GolfBox username and password in the extension settings.
4. Keep `Enable booking and cancellation tools` turned off unless you deliberately want real write actions.
5. Start a new Claude conversation and ask it to list GolfBox clubs or search for available tee times.

If tools do not appear, restart Claude Desktop and check Settings -> Extensions -> GolfBox MCP.

## If you use Codex

1. Unzip `golfbox-mcp-codex-plugin.zip`.
2. Install the `golfbox-mcp` plugin folder in Codex as a local/private plugin.
3. Configure the MCP server environment with either:
   - `GOLFBOX_USERNAME` and `GOLFBOX_PASSWORD`, or
   - `GOLFBOX_API_TOKEN`.
4. Keep `GOLFBOX_ENABLE_WRITE_TOOLS=false` unless you deliberately want real booking/cancellation tools.
5. Start a new Codex thread and ask it to use GolfBox MCP to authenticate, list clubs, or search tee times.

Recommended safe first prompt:

```text
Use GolfBox MCP to authenticate, list clubs, and search available tee times. Do not book or cancel anything.
```

## Safety defaults

- `GOLFBOX_PROVIDER=official`
- `GOLFBOX_COUNTRY=NO`
- `GOLFBOX_ENABLE_WRITE_TOOLS=false`
- `GOLFBOX_REQUIRE_CONFIRMATION=true`
- Network calls use HTTPS GolfBox endpoints and conservative timeouts.
