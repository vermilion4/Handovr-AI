import { openKernelBrowser } from '../src/verification/browser';

async function main() {
  const browser = await openKernelBrowser();
  try {
    console.log('open', await browser.open('https://example.com'));
    console.log('text', (await browser.pageText()).slice(0, 80));
    console.log('links', await browser.checkLinks());
    console.log('screenshot bytes', (await browser.screenshot()).length);
    console.log('load times', await browser.loadTimes('https://example.com', 2, 'phone_4g'));
    console.log('accessibility', await browser.accessibility());
    console.log('click', await browser.click('Learn more'));
  } finally {
    console.log('close', await browser.close());
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
