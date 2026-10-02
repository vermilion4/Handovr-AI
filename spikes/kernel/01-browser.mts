import { writeFileSync } from 'node:fs';
import Kernel from '@onkernel/sdk';
import { chromium } from 'playwright-core';

const kernel = new Kernel();
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const session = await kernel.browsers.create({ headless: false, timeout_seconds: 120 });
console.log(elapsed(), 'browser created', session.session_id, 'live view:', Boolean(session.browser_live_view_url));

try {
  const replay = await kernel.browsers.replays.start(session.session_id);
  console.log(elapsed(), 'replay started', replay.replay_id);

  const browser = await chromium.connectOverCDP(session.cdp_ws_url);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  const response = await page.goto('https://example.com', { waitUntil: 'load' });
  console.log(elapsed(), 'loaded', response?.status(), JSON.stringify(await page.title()));

  writeFileSync('spikes/out/kernel-desktop.png', await page.screenshot());
  await page.setViewportSize({ width: 390, height: 844 });
  writeFileSync('spikes/out/kernel-phone.png', await page.screenshot());
  console.log(elapsed(), 'screenshots saved at desktop and phone width');

  await page.click('a');
  await page.waitForLoadState('load');
  console.log(elapsed(), 'clicked the link, now at', page.url());

  await browser.close();
  await kernel.browsers.replays.stop(replay.replay_id, { id_or_name: session.session_id });
  const replays = await kernel.browsers.replays.list(session.session_id);
  console.log(elapsed(), 'replay stopped', JSON.stringify(replays));

  const video = await kernel.browsers.replays.download(replay.replay_id, { id_or_name: session.session_id });
  const bytes = Buffer.from(await video.arrayBuffer());
  writeFileSync('spikes/out/kernel-replay.mp4', bytes);
  console.log(elapsed(), 'replay downloaded', bytes.length, 'bytes', video.headers.get('content-type'));
} finally {
  await kernel.browsers.deleteByID(session.session_id);
  console.log(elapsed(), 'browser deleted');
}
