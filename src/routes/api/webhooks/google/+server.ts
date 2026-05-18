import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { accounts } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { syncAccount } from '$lib/server/sync';

export async function POST({ request }) {
  try {
    const payload = await request.json();
    
    if (!payload.message || !payload.message.data) {
      return json({ ok: true }); // Acknowledge to prevent retries if malformed
    }

    const data = JSON.parse(Buffer.from(payload.message.data, 'base64').toString('utf8'));
    
    if (data.emailAddress) {
      const account = db.select().from(accounts).where(eq(accounts.email, data.emailAddress)).get();
      if (account) {
        console.log(`[dear-robot] Received Google Pub/Sub push for ${data.emailAddress}, triggering sync`);
        // Trigger sync asynchronously so we can quickly ack the webhook
        void syncAccount(account.id).catch(err => {
          console.error('[dear-robot] Pub/Sub triggered sync failed:', err);
        });
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error('[dear-robot] Google Pub/Sub webhook error:', err);
    throw error(400, 'Invalid payload');
  }
}
