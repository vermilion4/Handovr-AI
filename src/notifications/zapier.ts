import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logMailer, type Mailer } from './notify';

/** Sends through the Zapier MCP email tool when it is configured, and to the server log otherwise. */
export function liveMailer(): Mailer {
  const url = process.env.ZAPIER_MCP_URL;
  const tool = process.env.ZAPIER_EMAIL_TOOL;
  if (!url || !tool) return logMailer;

  return {
    async send(message) {
      const client = new Client({ name: 'handovr', version: '1.0.0' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: 10_000 });
        const result = await client.callTool(
          {
            name: tool,
            arguments: {
              output_hint: 'whether the email was sent',
              to: [message.to],
              subject: message.subject,
              body: message.body,
              body_type: 'plain',
              from_name: 'Handovr',
            },
          },
          undefined,
          { timeout: 20_000 },
        );
        if (result.isError) throw new Error(`Zapier refused the email: ${JSON.stringify(result.content).slice(0, 300)}`);
      } finally {
        await client.close();
      }
    },
  };
}
