#!/usr/bin/env node
const { startMCPServer } = require('palaryn/dist/src/mcp/server.js');
startMCPServer().catch((err) => {
  process.stderr.write(`Palaryn MCP server fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
