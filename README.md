# Palaryn MCP Server

**Security, DLP, and cost controls for every HTTP request your AI agent makes -- exposed as an MCP server.**

Palaryn MCP wraps the [Palaryn gateway](https://github.com/PJuniszewski/agent-gateway) as a [Model Context Protocol](https://modelcontextprotocol.io/) server, giving Claude Code, Cursor, Windsurf, and any MCP-compatible client policy-enforced access to external APIs with zero code changes.

---

## What It Does

Every HTTP request your AI agent makes flows through the Palaryn pipeline:

```
Claude Code / Cursor / MCP Client
        |
        | stdio (JSON-RPC 2.0) or HTTP (/mcp)
        v
  Palaryn MCP Server
        |
        +---> Rate Limiting     (per-actor sliding window)
        +---> Anomaly Detection (statistical outlier flagging)
        +---> Policy Engine     (YAML rules: allow / deny / require approval)
        +---> DLP Scanner       (secrets & PII detection + redaction)
        +---> Budget Check      (per-task / user / org cost limits)
        +---> HTTP Execution    (retries, backoff, caching)
        +---> Audit Logging     (immutable append-only trace)
        |
        v
   External API
```

**Three MCP tools exposed:**

| Tool | Method | Capability | Description |
|---|---|---|---|
| `http_request` | Any | Inferred | Execute any HTTP request (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) |
| `http_get` | GET | `read` | GET request shorthand |
| `http_post` | POST | `write` | POST request shorthand |

Each tool accepts: `url` (required), `headers`, `body`, `timeout_ms`, `max_cost_usd`, `purpose`, `labels`.

---

## Quick Start

### Option 1: Hosted (requires a Palaryn account)

```bash
claude mcp add --transport http palaryn https://app.palaryn.com/mcp
```

Done. All requests from Claude Code now route through Palaryn. You will be prompted to log in via OAuth on first use.

### Option 2: Project-level config

Create `.mcp.json` in your project root (see `.mcp.json.example`):

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

> **Note**: Ensure `palaryn-mcp` is installed (e.g., via `npm install palaryn-mcp`) so `npx` can resolve it.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PALARYN_MCP_WORKSPACE` | `ws-claude-code` | Workspace ID for tool calls |
| `PALARYN_MCP_ACTOR` | `claude-code` | Actor ID for audit trails |
| `PALARYN_MCP_PLATFORM` | `claude_code` | Platform identifier |
| `POLICY_PACK_PATH` | `./policy-packs/default.yaml` | Path to the active policy pack |

### Custom Policy Pack

Pass a custom policy via environment variable:

```bash
claude mcp add palaryn \
  -e POLICY_PACK_PATH=./policy-packs/prod_strict.yaml \
  -- node bin/palaryn-mcp.js
```

---

## Policy Packs

Three pre-built policy packs are included:

### `default.yaml` -- Sensible starter rules

- Block SSRF (cloud metadata endpoints)
- Allow all read operations (GET)
- Require human approval for writes (POST/PUT/PATCH)
- Deny delete and admin operations

### `dev_fast.yaml` -- Permissive for development

- Block SSRF
- Allow reads and writes without approval
- Require approval for delete/admin operations

### `prod_strict.yaml` -- Minimal permissions for production

- Block SSRF + internal IPs + localhost
- Allow reads only to allowlisted domains (e.g., `api.github.com`, `api.slack.com`)
- Require security review for all writes
- Deny all delete and admin operations
- Require admin approval for anything unmatched

### Custom Policy Example

```yaml
name: my-policy
version: "1.0.0"
description: "Custom policy for my project"

domain_blocklist:
  - "169.254.169.254"

rules:
  - name: "Allow GitHub API"
    effect: ALLOW
    priority: 10
    conditions:
      capabilities: ["read"]
      domains: ["api.github.com"]

  - name: "Require approval for writes"
    effect: REQUIRE_APPROVAL
    priority: 20
    conditions:
      capabilities: ["write"]
    approval:
      scope: "admin"
      ttl_seconds: 3600
      reason: "Write operations require approval"

  - name: "Deny everything else"
    effect: DENY
    priority: 100
    conditions: {}
```

---

## How It Works

### Architecture

Palaryn MCP server is a thin adapter layer that translates MCP tool calls into the Palaryn gateway pipeline:

```
MCP Client (Claude Code, Cursor, etc.)
     |
     | JSON-RPC 2.0 over stdio
     v
+-----------------------------+
|   Palaryn MCP Server        |
|                             |
|  tools/list -> 3 HTTP tools |
|  tools/call -> Gateway      |
+-----------------------------+
     |
     v
+-----------------------------+
|   Palaryn Gateway Pipeline  |
|                             |
|  1. Rate Limiting           |
|  2. Anomaly Detection       |
|  3. Policy Evaluation       |
|  4. DLP Scan (args)         |
|  5. Budget Check            |
|  6. HTTP Execution          |
|  7. DLP Scan (response)     |
|  8. Audit Logging           |
+-----------------------------+
     |
     v
   External API
```

### MCP Protocol

The server implements the [Model Context Protocol](https://modelcontextprotocol.io/) specification:

| Method | Description |
|---|---|
| `initialize` | Protocol handshake -- returns server info and capabilities |
| `tools/list` | Returns the 3 HTTP tool definitions with JSON schemas |
| `tools/call` | Executes a tool through the gateway pipeline |
| `ping` | Health check |

### Two Transport Modes

| Mode | Protocol | Best For |
|---|---|---|
| **Stdio** | JSON-RPC 2.0 over stdin/stdout | Claude Code, Cursor, local IDE agents |
| **HTTP** | Streamable HTTP at `/mcp` | Hosted/remote deployment, shared servers |

### Response Format

Every tool call returns two content blocks:

1. **Primary content**: The actual HTTP response body (or error message)
2. **Gateway metadata**: Policy decision, DLP report, budget breakdown, timing

```json
{
  "content": [
    { "type": "text", "text": "{\"data\": \"response from API\"}" },
    { "type": "text", "text": "--- Gateway Metadata ---\n{...}" }
  ],
  "isError": false
}
```

---

## Security Features

### DLP (Data Loss Prevention)

- Scans request arguments and response bodies for secrets and PII
- Detects API keys, tokens, passwords, SSNs, credit card numbers, etc.
- Automatically redacts sensitive data before it reaches the agent
- Configurable severity levels and detection backends

### Policy Engine

- YAML-based policy rules with priority ordering
- Four decisions: `ALLOW`, `DENY`, `TRANSFORM`, `REQUIRE_APPROVAL`
- Conditions: capability level, HTTP method, target domain, tool name
- Optional OPA/Rego integration for advanced policy logic

### SSRF Protection

- Blocks requests to cloud metadata endpoints (169.254.169.254, etc.)
- Blocks private/reserved IP ranges
- Domain allowlisting for production environments

### Budget Controls

- Per-task, per-user, and per-organization cost limits
- Prevents runaway spending from agent loops
- Real-time budget tracking with remaining balance in responses

### Rate Limiting

- Sliding-window rate limiting per actor and per workspace
- Prevents abuse and ensures fair resource allocation

---

## Integration Patterns

### Claude Code

```bash
# Hosted (requires Palaryn account)
claude mcp add --transport http palaryn https://app.palaryn.com/mcp
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "palaryn": {
      "type": "stdio",
      "command": "npx",
      "args": ["palaryn-mcp"]
    }
  }
}
```

### Windsurf

Add to your Windsurf MCP configuration:

```json
{
  "mcpServers": {
    "palaryn": {
      "serverUrl": "https://app.palaryn.com/mcp"
    }
  }
}
```

### Remote MCP (HTTP)

For hosting Palaryn as a remote MCP server, see the [full gateway](https://github.com/PJuniszewski/agent-gateway) which includes the `/mcp` HTTP endpoint.

---

## Tool Reference

### `http_request`

Execute an arbitrary HTTP request through the Palaryn gateway.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | Target URL |
| `method` | string | No | HTTP method (default: GET) |
| `headers` | object | No | HTTP headers as key-value pairs |
| `body` | string | No | Request body (typically JSON) |
| `timeout_ms` | number | No | Request timeout in milliseconds |
| `max_cost_usd` | number | No | Maximum cost budget for this request |
| `purpose` | string | No | Why this request is being made |
| `labels` | string[] | No | Classification labels |

### `http_get`

Shorthand for GET requests. Same parameters as `http_request` minus `method` and `body`.

### `http_post`

Shorthand for POST requests. Same parameters as `http_request` minus `method`.

---

## Related

- [Palaryn Gateway](https://github.com/PJuniszewski/agent-gateway) -- Full gateway with API, SDK, proxy, and admin dashboard
- [Model Context Protocol](https://modelcontextprotocol.io/) -- MCP specification
- [MCP Servers Directory](https://github.com/modelcontextprotocol/servers) -- Community MCP servers

---

## License

MIT
