import { appEvents } from '$lib/server/events';

export function GET({ request }) {
  let controller: ReadableStreamDefaultController<string>;
  let interval: NodeJS.Timeout;

  const onSyncComplete = (payload: { accountId: number }) => {
    try {
      controller.enqueue(`event: sync_complete\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (_e) {
      // Stream might be closed but listener not yet removed
    }
  };

  const cleanup = () => {
    if (interval) clearInterval(interval);
    appEvents.off('sync_complete', onSyncComplete);
  };

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      appEvents.on('sync_complete', onSyncComplete);

      // Send a heartbeat every 30 seconds to keep connection alive
      interval = setInterval(() => {
        try {
          controller.enqueue(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
        } catch (_e) {
          cleanup();
        }
      }, 30000);
    },
    cancel() {
      cleanup();
    }
  });

  request.signal.addEventListener('abort', () => {
    cleanup();
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
