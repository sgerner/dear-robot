import nodemailer from 'nodemailer';
import type { Account } from '../db/schema';
import { decryptSecret } from '../security';
import type { SendMailOptions } from './types';
import { getGoogleAccessToken } from '../oauth/google';

export async function sendSmtp(account: Account, options: SendMailOptions) {
  const accessToken = await getGoogleAccessToken(account);
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: {
      user: account.smtpUsername,
      ...(accessToken
        ? {
            type: 'OAuth2',
            accessToken
          }
        : { pass: decryptSecret(account.smtpPasswordEncrypted) })
    }
  });
  const result = await transporter.sendMail({
    from: account.email,
    to: options.to,
    cc: options.cc || undefined,
    bcc: options.bcc || undefined,
    subject: options.subject,
    text: options.text,
    html: options.html || undefined,
    inReplyTo: options.inReplyTo || undefined,
    references: options.references || undefined,
    attachments: options.attachments?.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType || undefined,
      content: Buffer.from(attachment.contentBase64, 'base64')
    }))
  });
  return { messageId: result.messageId || '' };
}
