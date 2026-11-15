/**
 * HTML → PDF with Playwright's bundled Chromium (`pnpm --filter @soc/api exec playwright install chromium`).
 * One browser per process, launched lazily, a fresh context per render. The HTML must be
 * self-contained (photos inlined as data URIs) — network requests are blocked so output
 * depends only on the input.
 */
import type { Browser } from 'playwright';

export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
  close(): Promise<void>;
}

export class ChromiumPdfRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = import('playwright').then(({ chromium }) => chromium.launch({ headless: true }));
      this.browser.catch(() => {
        this.browser = null;
      });
    }
    const b = await this.browser;
    if (!b.isConnected()) {
      this.browser = null;
      return this.getBrowser();
    }
    return b;
  }

  async render(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
      return Buffer.from(pdf);
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    const b = await this.browser.catch(() => null);
    this.browser = null;
    await b?.close();
  }
}

/** Fake renderer for tests: returns a tiny PDF containing a hash of the HTML. */
export class FakePdfRenderer implements PdfRenderer {
  readonly rendered: string[] = [];
  async render(html: string): Promise<Buffer> {
    this.rendered.push(html);
    return Buffer.from(`%PDF-1.4\n% fake ${html.length}\n%%EOF\n`);
  }
  async close(): Promise<void> {}
}
