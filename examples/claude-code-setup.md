# Claude Code Setup Guide

## Hosted (Recommended)

One command, no installation required:

```bash
claude mcp add palaryn --url https://palaryn.com/mcp
```

Verify it works:

```
> Use the palaryn http_get tool to fetch https://httpbin.org/get
```

## Local Setup

### 1. Install

```bash
git clone https://github.com/Palanyr/mcp.git
cd mcp
npm install
```

### 2. Add to Claude Code

```bash
claude mcp add palaryn -- npx palaryn-mcp
```

### 3. Verify

```bash
claude mcp list
# Should show "palaryn" with 3 tools: http_request, http_get, http_post
```

## Project-Level Config

Create `.mcp.json` in your project root:

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

Everyone who clones the repo gets Palaryn automatically.

## Custom Policy

Use a stricter policy for production work:

```bash
claude mcp add palaryn \
  -e POLICY_PACK_PATH=./policy-packs/prod_strict.yaml \
  -- npx palaryn-mcp
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PALARYN_MCP_WORKSPACE` | `ws-claude-code` | Workspace ID |
| `PALARYN_MCP_ACTOR` | `claude-code` | Actor ID for audit trails |
| `PALARYN_MCP_PLATFORM` | `claude_code` | Platform identifier |
| `POLICY_PACK_PATH` | `./policy-packs/default.yaml` | Policy pack to enforce |

## What Happens When You Use It

When Claude Code uses the `http_get` tool:

1. MCP server receives the tool call via JSON-RPC
2. Request is rate-limited (prevents abuse)
3. Policy engine checks if the URL and method are allowed
4. DLP scanner checks arguments for leaked secrets
5. Budget manager checks cost limits
6. HTTP request is executed (with retries and caching)
7. Response is scanned for sensitive data (redacted if needed)
8. Full audit trail is logged
9. Response + metadata returned to Claude Code

All of this happens transparently in milliseconds.
