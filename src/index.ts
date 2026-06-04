#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createGolfBoxClient } from "./golfbox/factory.js";
import { registerGolfBoxTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = createGolfBoxClient(config);

  const server = new McpServer({
    name: "golfbox-mcp",
    version: "0.1.0"
  });

  registerGolfBoxTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
