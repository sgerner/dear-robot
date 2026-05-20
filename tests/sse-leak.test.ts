/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import { GET } from '../src/routes/api/events/+server';
import { appEvents } from '../src/lib/server/events';

describe('/api/events SSE Leak', () => {
  it('should clean up listeners when the request is aborted', async () => {
    const initialListeners = appEvents.listenerCount('sync_complete');
    
    // Mock the RequestEvent
    const controller = new AbortController();
    const mockEvent = {
      request: {
        signal: controller.signal
      }
    } as unknown as any;

    const response = await GET(mockEvent);
    expect(response.status).toBe(200);
    
    expect(appEvents.listenerCount('sync_complete')).toBe(initialListeners + 1);
    
    // Simulate client disconnect
    controller.abort();
    
    // Wait for the abort listener to fire
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(appEvents.listenerCount('sync_complete')).toBe(initialListeners);
  });
  
  it('should clean up listeners when the stream is cancelled', async () => {
    const initialListeners = appEvents.listenerCount('sync_complete');
    
    const mockEvent = {
      request: {
        signal: new AbortController().signal
      }
    } as unknown as any;

    const response = await GET(mockEvent);
    const reader = response.body?.getReader();
    
    expect(appEvents.listenerCount('sync_complete')).toBe(initialListeners + 1);
    
    await reader?.cancel();
    
    // Wait for the cancel listener to fire
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(appEvents.listenerCount('sync_complete')).toBe(initialListeners);
  });
});
