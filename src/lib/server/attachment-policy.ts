import { env } from './env';

const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.scr',
  '.js',
  '.jse',
  '.vbs',
  '.ps1',
  '.jar',
  '.com',
  '.pif'
]);

const BLOCKED_MIME_PREFIXES = ['application/x-msdownload', 'application/x-dosexec'];

export type AttachmentPolicyResult = {
  allowed: boolean;
  reason: string | null;
  warnings: string[];
};

export function evaluateAttachmentPolicy(input: {
  filename: string;
  contentType?: string | null;
  sizeBytes?: number;
}) {
  const filename = (input.filename || '').toLowerCase();
  const contentType = (input.contentType || '').toLowerCase();
  const warnings: string[] = [];
  const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
  if (ext && BLOCKED_EXTENSIONS.has(ext)) {
    return {
      allowed: false,
      reason: `Blocked executable attachment extension: ${ext}`,
      warnings
    } satisfies AttachmentPolicyResult;
  }
  if (contentType && BLOCKED_MIME_PREFIXES.some((mime) => contentType.startsWith(mime))) {
    return {
      allowed: false,
      reason: `Blocked attachment MIME type: ${contentType}`,
      warnings
    } satisfies AttachmentPolicyResult;
  }
  const maxBytes = Math.max(1, env.ATTACHMENT_MAX_BYTES);
  if (typeof input.sizeBytes === 'number' && input.sizeBytes > maxBytes) {
    return {
      allowed: false,
      reason: `Attachment exceeds max allowed size (${maxBytes} bytes)`,
      warnings
    } satisfies AttachmentPolicyResult;
  }
  if (filename.endsWith('.zip') || filename.endsWith('.7z') || filename.endsWith('.rar')) {
    warnings.push('Archive attachment detected; review manually before opening.');
  }
  return { allowed: true, reason: null, warnings } satisfies AttachmentPolicyResult;
}

