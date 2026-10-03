import Kernel from '@onkernel/sdk';
import axe from 'axe-core';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

export interface BrowserTools {
  open(url: string): Promise<{ status: number | null; finalUrl: string; title: string; error?: string }>;
  click(target: string): Promise<string>;
  type(target: string, text: string): Promise<string>;
  setViewport(width: number, height: number): Promise<void>;
  /** A JPEG of what is on screen. */
  screenshot(): Promise<Uint8Array>;
  pageText(): Promise<string>;
  consoleErrors(): string[];
  /** Milliseconds from navigation start to the load event, one per fresh visit. */
  loadTimes(url: string, runs: number, network: 'fast' | 'phone_4g'): Promise<number[]>;
  checkLinks(): Promise<Array<{ url: string; status: number | null }>>;
  accessibility(): Promise<{ score: number; violations: string[] }>;
  close(): Promise<{ replayUrl: string | null }>;
}

const TEXT_LIMIT = 6000;
const ACTION_TIMEOUT_MS = 10_000;
const PAGE_TIMEOUT_MS = 30_000;

export function truncate(text: string, limit = TEXT_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[cut: ${text.length - limit} more characters]`;
}

export function uniqueLinks(hrefs: string[], base: string, limit = 30): string[] {
  const seen = new Set<string>();
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    seen.add(url.href);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Finds an element by its label, placeholder, button or link name, visible text, then as a CSS selector. */
async function locate(page: Page, target: string): Promise<Locator> {
  const candidates: Array<() => Locator> = [
    () => page.getByLabel(target),
    () => page.getByPlaceholder(target),
    () => page.getByRole('button', { name: target }),
    () => page.getByRole('link', { name: target }),
    () => page.getByText(target),
    () => page.locator(target),
  ];
  for (const candidate of candidates) {
    try {
      const locator = candidate();
      if ((await locator.count()) > 0) return locator.first();
    } catch {
      // Not a valid selector of this kind; try the next.
    }
  }
  throw new Error(`Nothing on the page matches "${target}".`);
}

const PHONE_4G = { offline: false, latency: 100, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 };

export async function openKernelBrowser(): Promise<BrowserTools> {
  const kernel = new Kernel();
  const session = await kernel.browsers.create({ headless: false, timeout_seconds: 600 });
  const replayId = await kernel.browsers.replays
    .start(session.session_id)
    .then((replay) => replay.replay_id)
    .catch(() => null);

  let browser: Browser;
  let page: Page;
  try {
    browser = await chromium.connectOverCDP(session.cdp_ws_url);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize({ width: 1280, height: 800 });
  } catch (error) {
    // Nothing else holds the session yet, so it is ended here.
    await kernel.browsers.deleteByID(session.session_id).catch(() => undefined);
    throw error;
  }

  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  return {
    async open(url) {
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        // A slow page still counts as opened; its speed is a matter for the speed check.
        await page.waitForLoadState('load', { timeout: PAGE_TIMEOUT_MS }).catch(() => undefined);
        return { status: response?.status() ?? null, finalUrl: page.url(), title: await page.title() };
      } catch (error) {
        return { status: null, finalUrl: page.url(), title: '', error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
      }
    },

    async click(target) {
      await (await locate(page, target)).click({ timeout: ACTION_TIMEOUT_MS });
      await page.waitForLoadState('load', { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
      return `Clicked "${target}". The page is now ${page.url()}.`;
    },

    async type(target, text) {
      await (await locate(page, target)).fill(text, { timeout: ACTION_TIMEOUT_MS });
      return `Typed ${text.length} characters into "${target}".`;
    },

    async setViewport(width, height) {
      await page.setViewportSize({ width, height });
    },

    async screenshot() {
      return new Uint8Array(await page.screenshot({ type: 'jpeg', quality: 60 }));
    },

    async pageText() {
      return truncate(await page.innerText('body', { timeout: ACTION_TIMEOUT_MS }));
    },

    consoleErrors() {
      return [...errors];
    },

    async loadTimes(url, runs, network) {
      const times: number[] = [];
      for (let run = 0; run < runs; run++) {
        const fresh = await browser.newContext();
        try {
          const visit = await fresh.newPage();
          if (network === 'phone_4g') {
            const cdp = await fresh.newCDPSession(visit);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions', PHONE_4G);
          }
          const started = Date.now();
          await visit.goto(url, { waitUntil: 'load', timeout: 60_000 });
          const measured = await visit.evaluate(() => {
            const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
            return navigation ? navigation.loadEventEnd - navigation.startTime : 0;
          });
          times.push(Math.round(measured > 0 ? measured : Date.now() - started));
        } finally {
          await fresh.close();
        }
      }
      return times;
    },

    async checkLinks() {
      const hrefs = await page.$$eval('a[href]', (anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
      // Each link is opened by the remote browser, so no request comes from this server.
      const fresh = await browser.newContext();
      try {
        const visit = await fresh.newPage();
        const results: Array<{ url: string; status: number | null }> = [];
        for (const url of uniqueLinks(hrefs, page.url(), 20)) {
          const response = await visit.goto(url, { waitUntil: 'commit', timeout: ACTION_TIMEOUT_MS }).catch(() => null);
          results.push({ url, status: response?.status() ?? null });
        }
        return results;
      } finally {
        await fresh.close();
      }
    },

    async accessibility() {
      await page.addScriptTag({ content: axe.source });
      const result = await page.evaluate(async () => {
        const runner = (window as unknown as { axe: { run(): Promise<{ passes: unknown[]; violations: Array<{ id: string; help: string; nodes: unknown[] }> }> } }).axe;
        const outcome = await runner.run();
        return {
          passes: outcome.passes.length,
          violations: outcome.violations.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`),
        };
      });
      const total = result.passes + result.violations.length;
      return { score: total === 0 ? 100 : Math.round((result.passes / total) * 100), violations: result.violations };
    },

    async close() {
      let replayUrl: string | null = null;
      if (replayId) {
        await kernel.browsers.replays.stop(replayId, { id_or_name: session.session_id }).catch(() => undefined);
        const replays = await kernel.browsers.replays.list(session.session_id).catch(() => []);
        replayUrl = replays.find((replay) => replay.replay_id === replayId)?.replay_view_url ?? null;
      }
      await browser.close().catch(() => undefined);
      await kernel.browsers.deleteByID(session.session_id).catch(() => undefined);
      return { replayUrl };
    },
  };
}
