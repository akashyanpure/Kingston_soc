import type { Db } from '@soc/db';
import type { Mailer } from './adapters/mail.js';
import type { Storage } from './adapters/storage.js';
import type { Config } from './config.js';
import type { PdfRenderer } from './pdf/renderer.js';

/** Everything a route or job needs. Injected by buildApp() so tests can swap adapters. */
export interface AppContext {
  db: Db;
  storage: Storage;
  mail: Mailer;
  config: Config;
  pdf: PdfRenderer;
  /** Wake the PDF worker right away (set when the worker runs in-process). */
  pdfWorkerKick?: () => void;
}
