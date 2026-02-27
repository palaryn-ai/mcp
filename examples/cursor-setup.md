# Cursor Setup Guide

## Option 1: Hosted MCP Server

Add to your Cursor MCP settings (Settings > MCP Servers):

```json
{
  "mcpServers": {
    "palaryn": {
      "serverUrl": "https://app.palaryn.com/mcp"
    }
  }
}
```

## Option 2: Local (stdio)

### 1. Install

> **Prerequisite**: The gateway dependency is in a private GitHub repo. You need a GitHub token with access to `PJuniszewski/agent-gateway`. See the main README for details.

```bash
git clone https://github.com/palaryn-ai/mcp.git
cd mcp
npm install
```

### 2. Configure

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "palaryn": {
      "type": "stdio",
      "command": "npx",
      "args": ["palaryn-mcp"],
      "env": {
        "POLICY_PACK_PATH": "./policy-packs/default.yaml"
      }
    }
  }
}
```

## Option 3: Project-level (.mcp.json)

Create `.mcp.json` in your project root. Cursor will detect it automatically:

```json
{
  "mcpServers": {
    "palaryn": {
      "type": "stdio",
      "command": "npx",
      "args": ["palaryn-mcp"],
      "env": {
        "POLICY_PACK_PATH": "./policy-packs/default.yaml"
      }
    }
  }
}
```

## Available Tools

Once connected, Cursor can use these tools:

| Tool | Description |
|---|---|
| `http_request` | Any HTTP method (GET, POST, PUT, DELETE, etc.) |
| `http_get` | GET request shorthand |
| `http_post` | POST request shorthand |

All requests go through policy, DLP, and budget checks automatically.
