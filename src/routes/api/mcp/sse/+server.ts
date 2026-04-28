import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { MessageQuerySchema, getMessageDetail, listMessages } from '$lib/server/services/messages';

const ToolCallSchema = z.object({
  tool: z.enum(['search_emails', 'get_email_context']),
  args: z.record(z.unknown()).default({})
});

export async function GET({ url }) {
  const tool = url.searchParams.get('tool');
  const payload = tool
    ? {
        tool,
        args: Object.fromEntries(url.searchParams.entries())
      }
    : null;
  if (!payload) {
    return new Response(
      `event: ready\ndata: ${JSON.stringify({
        tools: [
          { name: 'search_emails', args: { query: 'string' } },
          { name: 'get_email_context', args: { message_id: 'string' } }
        ]
      })}\n\n`,
      {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache'
        }
      }
    );
  }
  return toolResponse(payload);
}

export async function POST({ request }) {
  return toolResponse(await request.json());
}

function toolResponse(payload: unknown) {
  const call = ToolCallSchema.parse(payload);
  if (call.tool === 'search_emails') {
    const query = String(call.args.query || '');
    const messages = listMessages(MessageQuerySchema.parse({ q: query, limit: 20 })).map((message) => ({
      id: message.id,
      subject: message.subject,
      from: message.from,
      date: message.date,
      category: message.category,
      riskLevel: message.riskLevel
    }));
    return json({ messages });
  }
  const id = Number(call.args.message_id);
  const detail = getMessageDetail(id);
  return json(detail ?? { error: 'not_found' });
}
