import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  MessageFlagSchema,
  MessageMoveSchema,
  MessageQuerySchema,
  MessageReadSchema,
  RegenerateSchema,
  executeSuggestion,
  getMessageDetail,
  listFoldersWithCounts,
  listMessages,
  moveMessage,
  regenerateSuggestion,
  setMessageFlagged,
  setMessageRead,
  suggestForMessage
} from '$lib/server/services/messages';

const ToolCallSchema = z.object({
  tool: z.enum([
    'search_emails',
    'get_email_context',
    'list_folders',
    'move_message',
    'set_read',
    'set_flagged',
    'generate_suggestion',
    'regenerate_suggestion',
    'execute_suggestion'
  ]),
  args: z.record(z.string(), z.unknown()).default({})
});

const MessageIdArgsSchema = z.object({
  message_id: z.coerce.number().int().positive()
});

const SuggestionIdArgsSchema = z.object({
  suggestion_id: z.coerce.number().int().positive()
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
          { name: 'get_email_context', args: { message_id: 'number' } },
          { name: 'list_folders', args: { account_id: 'number (optional)' } },
          { name: 'move_message', args: { message_id: 'number', folder_path: 'string' } },
          { name: 'set_read', args: { message_id: 'number', read: 'boolean' } },
          { name: 'set_flagged', args: { message_id: 'number', flagged: 'boolean' } },
          { name: 'generate_suggestion', args: { message_id: 'number' } },
          {
            name: 'regenerate_suggestion',
            args: { message_id: 'number', note: 'string (optional)' }
          },
          { name: 'execute_suggestion', args: { suggestion_id: 'number' } }
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

async function toolResponse(payload: unknown) {
  const call = ToolCallSchema.parse(payload);
  if (call.tool === 'search_emails') {
    const query = String(call.args.query || '');
    const messages = listMessages(MessageQuerySchema.parse({ q: query, limit: 20 })).map(
      (message) => ({
        id: message.id,
        subject: message.subject,
        from: message.from,
        date: message.date,
        category: message.category,
        riskLevel: message.riskLevel
      })
    );
    return json({ messages });
  }
  if (call.tool === 'get_email_context') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const detail = getMessageDetail(message_id);
    return json(detail ?? { error: 'not_found' });
  }
  if (call.tool === 'list_folders') {
    const accountIdValue = call.args.account_id;
    const accountId =
      accountIdValue == null || accountIdValue === ''
        ? undefined
        : z.coerce.number().int().positive().parse(accountIdValue);
    const folders = listFoldersWithCounts(accountId).map((folder) => ({
      id: folder.id,
      account_id: folder.accountId,
      account_email: folder.accountEmail,
      path: folder.path,
      role: folder.role,
      unread: folder.unread,
      total: folder.total
    }));
    return json({ folders });
  }
  if (call.tool === 'move_message') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const { folderPath } = MessageMoveSchema.parse({ folderPath: call.args.folder_path });
    const message = await moveMessage(message_id, folderPath);
    return json({ message });
  }
  if (call.tool === 'set_read') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const { read } = MessageReadSchema.parse({ read: call.args.read });
    const message = await setMessageRead(message_id, read);
    return json({ message });
  }
  if (call.tool === 'set_flagged') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const { flagged } = MessageFlagSchema.parse({ flagged: call.args.flagged });
    const message = await setMessageFlagged(message_id, flagged);
    return json({ message });
  }
  if (call.tool === 'generate_suggestion') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const suggestion = await suggestForMessage(message_id);
    return json({ suggestion });
  }
  if (call.tool === 'regenerate_suggestion') {
    const { message_id } = MessageIdArgsSchema.parse(call.args);
    const { note } = RegenerateSchema.parse({ note: call.args.note });
    const suggestion = await regenerateSuggestion(message_id, note);
    return json({ suggestion });
  }
  const { suggestion_id } = SuggestionIdArgsSchema.parse(call.args);
  const action = await executeSuggestion(suggestion_id);
  return json({ action });
}
