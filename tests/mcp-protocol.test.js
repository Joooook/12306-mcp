import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const port = 18084;
const endpoint = `http://127.0.0.1:${port}/mcp`;

async function waitForServer(child) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`server exited: ${child.exitCode}`);
        try {
            const response = await fetch(endpoint);
            if (response.status === 405) return;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('timed out waiting for MCP server');
}

async function callMcp(method, id, params = {}) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    assert.equal(response.status, 200);
    return response.json();
}

test('MCP protocol exposes train schedule query', async (t) => {
    const child = spawn(process.execPath, ['build/index.js', '--port', String(port)], {
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    t.after(() => child.kill('SIGTERM'));
    await waitForServer(child);

    const initialized = await callMcp('initialize', 1, {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'schedule-test', version: '1.0.0' },
    });
    assert.equal(initialized.result.serverInfo.name, '12306-mcp');

    const tools = await callMcp('tools/list', 2);
    const scheduleTool = tools.result.tools.find((tool) => tool.name === 'get-train-schedule');
    const routeStationsTool = tools.result.tools.find((tool) => tool.name === 'get-train-route-stations');
    assert.ok(scheduleTool);
    assert.ok(tools.result.tools.some((tool) => tool.name === 'get-train-on-time-status'));
    assert.match(scheduleTool.description, /指定车次时刻表接口/);
    assert.match(scheduleTool.description, /路线级车次列表/);
    assert.match(routeStationsTool.description, /不要使用本工具/);
});
