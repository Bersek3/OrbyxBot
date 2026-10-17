const puppeteer = require('puppeteer-core');

async function checkTokenEndpoint() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

  page.on('request', r => {
    if (r.url().includes('token')) {
      console.log('REQ:', r.method(), r.url(), r.headers(), r.postData());
    }
  });

  page.on('response', async r => {
    if (r.url().includes('token')) {
      try {
        console.log('RES:', r.status(), r.url(), await r.text());
      } catch(e) {}
    }
  });

  await page.goto('https://kick.com/xqc', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise(r => setTimeout(r, 6000));
  await browser.close();
}

checkTokenEndpoint().catch(console.error);
