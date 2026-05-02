type Bucket = { count: number; windowStartMs: number };

const buckets = new Map<string, Bucket>();

export function checkRateLimit(input: { key: string; maxPerMinute: number; nowMs?: number }) {
  const now = input.nowMs ?? Date.now();
  const bucket = buckets.get(input.key);
  if (!bucket || now - bucket.windowStartMs >= 60_000) {
    buckets.set(input.key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: Math.max(0, input.maxPerMinute - 1) };
  }
  if (bucket.count >= input.maxPerMinute) {
    return { allowed: false, remaining: 0 };
  }
  bucket.count += 1;
  buckets.set(input.key, bucket);
  return { allowed: true, remaining: Math.max(0, input.maxPerMinute - bucket.count) };
}
