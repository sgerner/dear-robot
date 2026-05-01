import { error } from '@sveltejs/kit';
import { getAttachment } from '$lib/server/services/messages';
import { evaluateAttachmentPolicy } from '$lib/server/attachment-policy';
import { env } from '$lib/server/env';

export function GET({ params }) {
  const attachment = getAttachment(Number(params.id), Number(params.attachmentId));
  if (!attachment) throw error(404, 'Attachment not found');
  if (!attachment.contentBase64) throw error(404, 'Attachment content unavailable');
  const policy = evaluateAttachmentPolicy({
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes
  });
  if (!policy.allowed || (env.ATTACHMENT_SCAN_STRICT && policy.warnings.length > 0)) {
    throw error(403, policy.reason || 'Attachment blocked by policy');
  }
  const bytes = Buffer.from(attachment.contentBase64, 'base64');
  const filename = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': attachment.contentType || 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${filename}"`
    }
  });
}
