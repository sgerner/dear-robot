import { appEvents } from '$lib/server/events';

export function GET() {
  let controller: ReadableStreamDefaultController<any>;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      const onSyncComplete = (payload: { accountId: number }) => {
        try {
          controller.enqueue(`event: sync_complete\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch (e) {
          console.error('[dear-robot] Failed to enqueue SSE', e);
        }
      };

      appEvents.on('sync_complete', onSyncComplete);

      // Send a heartbeat every 30 seconds to keep connection alive
      const interval = setInterval(() => {
        try {
          controller.enqueue(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
        } catch (e) {
          // stream closed
        }
      }, 30000);

      // Clean up on client disconnect
      return () => {
        clearInterval(interval);
        appEvents.off('sync_complete', onSyncComplete);
      };
    },
    cancel() {
      // Stream cancelled by client
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
