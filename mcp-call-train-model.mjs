#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function printUsage() {
    console.error('Usage: node mcp-call-train-model.mjs <TRAIN_CODE> <YYYY-MM-DD> [text|json]');
    console.error('Example: node mcp-call-train-model.mjs G1 2026-02-27 text');
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        printUsage();
        process.exit(2);
    }

    const [trainCode, departDate, format = 'text'] = args;

    const transport = new StdioClientTransport({
        command: 'node',
        args: ['./build/index.js'],
        env: process.env,
    });

    const client = new Client(
        { name: 'mcp-train-model-client', version: '0.1.0' },
        { capabilities: {} }
    );

    try {
        await client.connect(transport);
        const result = await client.callTool({
            name: 'get-train-model-info',
            arguments: { trainCode, departDate, format },
        });

        if (result?.content?.length) {
            for (const item of result.content) {
                if (item.type === 'text') {
                    console.log(item.text);
                } else {
                    console.log(JSON.stringify(item, null, 2));
                }
            }
        } else {
            console.log(JSON.stringify(result, null, 2));
        }
    } catch (error) {
        console.error('MCP call failed:', error);
        process.exit(1);
    } finally {
        if (typeof client.close === 'function') {
            await client.close();
        }
    }
}

main();
