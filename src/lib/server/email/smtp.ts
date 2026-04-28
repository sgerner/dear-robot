import nodemailer from 'nodemailer';
import type { Account } from '../db/schema';
import { decryptSecret } from '../security';

export async function sendSmtp(
  account: Account,
  options: { to: string; subject: string; text: string; inReplyTo?: string | null }
) {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: {
      user: account.smtpUsername,
      pass: decryptSecret(account.smtpPasswordEncrypted)
    }
  });
  const result = await transporter.sendMail({
    from: account.email,
    to: options.to,
    subject: options.subject,
    text: options.text,
    inReplyTo: options.inReplyTo || undefined
  });
  return { messageId: result.messageId || '' };
}
