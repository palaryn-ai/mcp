#!/usr/bin/env node
/**
 * Palaryn MCP Server Integration Tests
 *
 * Tests the MCP server over stdio JSON-RPC 2.0 protocol:
 *   1. Server starts without errors
 *   2. MCP initialize handshake
 *   3. tools/list — verify tool definitions
 *   4. tools/call — execute a real HTTP GET
 *   5. tools/call — SSRF protection
 *   6. ping health check
 */
const { spawn } = require('child_process');

const TIMEOUT_MS = 30000;
let passed = 0;
let failed = 0;

function startServer() {
  const child = spawn('node', ['bin/palaryn-mcp.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdoutBuf = '';
  let stderrBuf = '';
  const pendingResponses = [];
  let pendingResolvers = [];

  child.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (pendingResolvers.length > 0) {
          pendingResolvers.shift()(parsed);
        } else {
          pendingResponses.push(parsed);
        }
      } catch {}
    }
  });

  child.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  function send(msg) {
    child.stdin.write(JSON.stringify(msg) + '\n');
  }

  function waitForResponse(timeoutMs = 15000) {
    if (pendingResponses.length > 0) {
      return Promise.resolve(pendingResponses.shift());
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for response')), timeoutMs);
      pendingResolvers.push((resp) => {
        clearTimeout(timer);
        resolve(resp);
      });
    });
  }

  function getStderr() { return stderrBuf; }

  function close() {
    return new Promise((resolve) => {
      child.on('exit', resolve);
      child.stdin.end();
      setTimeout(() => { child.kill(); resolve(); }, 3000);
    });
  }

  return { send, waitForResponse, getStderr, close, child };
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function doInitialize(server) {
  server.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });
  const resp = await server.waitForResponse();
  server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return resp;
}

async function runTests() {
  console.log('Palaryn MCP Server — Integration Tests\n');

  // ── Test 1: Server starts without errors ──────────────────────────
  {
    const name = 'Test 1: Server starts without errors';
    try {
      const server = startServer();
      // Wait for startup message
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (server.getStderr().includes('Palaryn MCP server started')) {
            clearInterval(check);
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });
      const stderr = server.getStderr();
      assert(stderr.includes('Palaryn MCP server started'), 'Missing startup message in stderr');
      assert(!stderr.includes('fatal error'), 'Fatal error in stderr');
      await server.close();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  // ── Test 2: MCP initialize handshake ──────────────────────────────
  {
    const name = 'Test 2: MCP initialize handshake';
    const server = startServer();
    try {
      await new Promise((r) => setTimeout(r, 1000));
      const resp = await doInitialize(server);
      assert(resp.jsonrpc === '2.0', 'Missing jsonrpc field');
      assert(resp.id === 1, `Wrong id: ${resp.id}`);
      const result = resp.result;
      assert(result.protocolVersion === '2025-03-26', `Wrong protocolVersion: ${result.protocolVersion}`);
      assert(result.serverInfo && result.serverInfo.name === 'palaryn-mcp-bridge', `Wrong serverInfo: ${JSON.stringify(result.serverInfo)}`);
      assert(result.capabilities && result.capabilities.tools, 'Missing tools capability');
      console.log(`  ✓ ${name}`);
      console.log(`      protocolVersion: ${result.protocolVersion}`);
      console.log(`      serverInfo: ${JSON.stringify(result.serverInfo)}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
    await server.close();
  }

  // ── Test 3: tools/list ────────────────────────────────────────────
  {
    const name = 'Test 3: tools/list — verify tool definitions';
    const server = startServer();
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await doInitialize(server);

      server.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const resp = await server.waitForResponse();
      assert(resp.id === 2, `Wrong id: ${resp.id}`);
      const tools = resp.result.tools;
      assert(Array.isArray(tools), 'tools is not an array');
      assert(tools.length === 3, `Expected 3 tools, got ${tools.length}`);
      const names = tools.map((t) => t.name).sort();
      assert(JSON.stringify(names) === JSON.stringify(['http_get', 'http_post', 'http_request']),
        `Wrong tool names: ${JSON.stringify(names)}`);

      for (const tool of tools) {
        assert(tool.name, `Tool missing name`);
        assert(tool.description, `Tool ${tool.name} missing description`);
        assert(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
        assert(tool.inputSchema.properties && tool.inputSchema.properties.url,
          `Tool ${tool.name} missing url property in schema`);
      }

      console.log(`  ✓ ${name}`);
      console.log(`      tools: ${names.join(', ')}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
    await server.close();
  }

  // ── Test 4: tools/call — real HTTP GET ────────────────────────────
  {
    const name = 'Test 4: tools/call — execute a real HTTP GET';
    const server = startServer();
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await doInitialize(server);

      server.send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'http_get',
          arguments: { url: 'https://httpbin.org/get' },
        },
      });
      const resp = await server.waitForResponse(20000);
      assert(resp.id === 3, `Wrong id: ${resp.id}`);
      assert(resp.result, 'Missing result');
      const content = resp.result.content;
      assert(Array.isArray(content), 'content is not an array');
      assert(content.length >= 2, `Expected at least 2 content blocks, got ${content.length}`);

      // First block: HTTP response body
      const body = content[0].text;
      const bodyParsed = JSON.parse(body);
      assert(bodyParsed.url === 'https://httpbin.org/get', `Unexpected URL in response: ${bodyParsed.url}`);

      // Second block: Gateway metadata
      const metaText = content[1].text;
      assert(metaText.includes('Gateway Metadata'), 'Missing gateway metadata block');
      const metaJson = JSON.parse(metaText.replace('--- Gateway Metadata ---\n', ''));
      assert(metaJson.status === 'ok' || metaJson.status === 'success', `Expected status ok/success, got ${metaJson.status}`);
      assert(metaJson.policy, 'Missing policy in metadata');
      assert(metaJson.http_status === 200, `Expected http_status=200, got ${metaJson.http_status}`);

      console.log(`  ✓ ${name}`);
      console.log(`      http_status: ${metaJson.http_status}`);
      console.log(`      policy decision: ${metaJson.policy?.decision || 'N/A'}`);
      console.log(`      dlp detected: ${metaJson.dlp?.detected}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
    await server.close();
  }

  // ── Test 5: tools/call — SSRF protection ──────────────────────────
  {
    const name = 'Test 5: tools/call — SSRF protection';
    const server = startServer();
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await doInitialize(server);

      server.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'http_get',
          arguments: { url: 'http://169.254.169.254/latest/meta-data/' },
        },
      });
      const resp = await server.waitForResponse(10000);
      assert(resp.id === 4, `Wrong id: ${resp.id}`);
      assert(resp.result, 'Missing result');

      // The request should be blocked (isError: true) or the metadata should show DENY
      const content = resp.result.content;
      assert(Array.isArray(content), 'content is not an array');

      // Check for DENY/blocked in the response
      const allText = content.map((c) => c.text).join('\n');
      const hasBlock = allText.includes('DENY') ||
                       allText.includes('blocked') ||
                       allText.includes('denied') ||
                       resp.result.isError === true;
      assert(hasBlock, `Expected SSRF request to be denied, got: ${allText.substring(0, 200)}`);

      console.log(`  ✓ ${name}`);
      console.log(`      SSRF request correctly blocked`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
    await server.close();
  }

  // ── Test 6: ping ──────────────────────────────────────────────────
  {
    const name = 'Test 6: ping health check';
    const server = startServer();
    try {
      await new Promise((r) => setTimeout(r, 1000));
      await doInitialize(server);

      server.send({ jsonrpc: '2.0', id: 5, method: 'ping' });
      const resp = await server.waitForResponse();
      assert(resp.id === 5, `Wrong id: ${resp.id}`);
      assert(resp.jsonrpc === '2.0', 'Missing jsonrpc field');
      assert(resp.result !== undefined, 'Missing result');
      assert(typeof resp.result === 'object', `Expected object result, got ${typeof resp.result}`);

      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.log(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
    await server.close();
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
}

// Global timeout
const globalTimer = setTimeout(() => {
  console.error(`\nGlobal timeout (${TIMEOUT_MS / 1000}s) exceeded`);
  process.exit(2);
}, TIMEOUT_MS + 60000);

runTests().then(() => {
  clearTimeout(globalTimer);
}).catch((err) => {
  console.error('Unexpected error:', err);
  clearTimeout(globalTimer);
  process.exit(1);
});
