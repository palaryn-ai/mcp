# Policy Packs

Pre-built policy configurations for common environments.

## Comparison

| Feature | `default` | `dev_fast` | `prod_strict` |
|---|---|---|---|
| SSRF protection | Yes | Yes | Yes |
| Read (GET) | Allow | Allow | Allow (allowlisted domains only) |
| Write (POST/PUT/PATCH) | Require approval | Allow | Require security review |
| Delete | Deny | Require approval | Deny |
| Admin | Deny | Require approval | Deny |
| Domain allowlist | No | No | Yes (`api.github.com`, `api.slack.com`) |
| IP blocking | Metadata only | Metadata only | Metadata + localhost + private IPs |

## Switching Packs

```bash
# Via environment variable
POLICY_PACK_PATH=./policy-packs/prod_strict.yaml npx palaryn-mcp

# Via Claude Code config
claude mcp add palaryn \
  -e POLICY_PACK_PATH=./policy-packs/dev_fast.yaml \
  -- npx palaryn-mcp
```

## Writing Custom Policies

Policy files are YAML with this structure:

```yaml
name: my-policy
version: "1.0.0"
description: "What this policy does"

domain_allowlist: []    # Only allow requests to these domains (empty = all)
domain_blocklist: []    # Always block these domains

rules:
  - name: "Rule name"
    description: "What this rule does"
    effect: ALLOW | DENY | REQUIRE_APPROVAL | TRANSFORM
    priority: 10        # Lower number = higher precedence
    conditions:
      capabilities:     # read, write, delete, admin
        - "read"
      domains:          # Target domains
        - "api.github.com"
      tools:            # Tool names
        - "http.request"
      methods:          # HTTP methods
        - "GET"
    approval:           # Only for REQUIRE_APPROVAL
      scope: "admin"
      ttl_seconds: 3600
      reason: "Human-readable reason"
```

Rules are evaluated by priority (lowest number first). First match wins.
