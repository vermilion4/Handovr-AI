import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function main() {
  const url = process.env.ZAPIER_MCP_URL;
  if (!url) throw new Error('ZAPIER_MCP_URL is not set.');

  const client = new Client({ name: 'handovr-probe', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  for (const tool of (await client.listTools()).tools) {
    console.log(tool.name);
    console.log(JSON.stringify(tool.inputSchema, null, 2));
  }
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
