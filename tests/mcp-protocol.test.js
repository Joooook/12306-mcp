import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

const port = 18081;
const endpoint = `http://127.0.0.1:${port}/mcp`;

async function waitForServer(child) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`MCP server exited with code ${child.exitCode}`);
        }
        try {
            const response = await fetch(endpoint, { method: 'GET' });
            if (response.status === 405) return;
        } catch {
            // The server is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for MCP server');
}

async function callMcp(method, id, params = {}) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    assert.equal(response.status, 200);
    return response.json();
}

test('MCP starts before upstream initialization and exposes tools', async (t) => {
    const child = spawn(process.execPath, ['build/index.js', '--port', String(port)], {
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    t.after(() => child.kill('SIGTERM'));

    await waitForServer(child);

    const initialized = await callMcp('initialize', 1, {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'mcp-protocol-test', version: '1.0.0' },
    });
    assert.equal(initialized.result.serverInfo.name, '12306-mcp');

    const tools = await callMcp('tools/list', 2);
    assert.ok(tools.result.tools.some((tool) => tool.name === 'get-tickets'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'search-stations'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'get-service-status'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'get-ticket-summary'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'get-train-operating-days'));
    assert.ok(tools.result.tools.some((tool) => tool.name === 'filter-tickets'));

    const status = await callMcp('tools/call', 3, {
        name: 'get-service-status',
        arguments: {},
    });
    assert.equal(status.result.structuredContent.initializationState, 'not_initialized');

    const currentDate = await callMcp('tools/call', 4, {
        name: 'get-current-date',
        arguments: {},
    });
    assert.match(currentDate.result.content[0].text, /^\d{4}-\d{2}-\d{2}$/);

    const filtered = await callMcp('tools/call', 5, {
        name: 'filter-tickets',
        arguments: {
            tickets: [
                { trainCode: 'G1', startTime: '06:30', arriveTime: '11:24', duration: '04:54' },
                { trainCode: 'K1', startTime: '08:00', arriveTime: '20:00', duration: '12:00' },
            ],
            trainFilterFlags: 'G',
            limit: 5,
        },
    });
    assert.equal(filtered.result.structuredContent.total, 1);
    assert.equal(filtered.result.structuredContent.tickets[0].trainCode, 'G1');
});
