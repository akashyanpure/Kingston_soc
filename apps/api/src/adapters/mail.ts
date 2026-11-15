/**
 * Outgoing mail behind an interface. Locally every message is written as an .eml file
 * into MAIL_DIR (open it with any mail client); SES / Google SMTP relay can replace it later.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}
export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(msg: MailMessage): Promise<{ id: string }>;
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const wrap76 = (b64: string) => b64.replace(/.{1,76}/g, (l) => `${l}\r\n`);
const safeName = (s: string) => s.replace(/[^A-Za-z0-9._ -]/g, '_');
const safeAddr = (s: string) => s.replace(/[\r\n]/g, '');

/** Build an RFC 5322 / MIME message. */
export function buildEml(from: string, msg: MailMessage, id: string, date: Date): string {
  const boundary = `soc-${id}`;
  const headers = [
    `From: ${safeAddr(from)}`,
    `To: ${msg.to.map(safeAddr).join(', ')}`,
    ...(msg.cc?.length ? [`Cc: ${msg.cc.map(safeAddr).join(', ')}`] : []),
    `Subject: ${encodeHeader(msg.subject.replace(/[\r\n]/g, ' '))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@soc.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const text = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(msg.text, 'utf8').toString('base64'))}`;
  const atts = (msg.attachments ?? []).map((a) => {
    const name = safeName(a.filename);
    return `--${boundary}\r\nContent-Type: ${a.contentType}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(a.content).toString('base64'))}`;
  });
  return `${headers.join('\r\n')}\r\n\r\n${text}${atts.join('')}--${boundary}--\r\n`;
}

export class FileMailer implements Mailer {
  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {}
  async send(msg: MailMessage) {
    const id = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${id}.eml`), buildEml(this.from, msg, id, new Date()));
    return { id };
  }
}

/** Collects messages in memory (tests). */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
    return { id: String(this.sent.length) };
  }
}
