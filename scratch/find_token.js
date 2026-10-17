const puppeteer = require('puppeteer-core');

async function findTokenSource() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

  page.on('response', async res => {
    try {
      const text = await res.text();
      if (text.includes('eyJhbGciOiJIUzI1NiIn') || text.includes('platform.kick.com') || text.includes('token')) {
        console.log('TOKEN IN RESPONSE:', res.url(), text.substring(0, 200));
      }
    } catch(e) {}
  });

  await page.goto('https://kick.com/xqc', { waitUntil: 'domcontentloaded', timeout: 25000 });
  
  // Check window object or HTML
  const jwt = await page.evaluate(() => {
    return window.__NUXT__ || window.__INITIAL_STATE__ || document.querySelector('script#__NEXT_DATA__')?.innerText;
  });
  if (jwt) {
    console.log('Found in DOM:', typeof jwt === 'string' ? jwt.substring(0, 300) : JSON.stringify(jwt).substring(0, 300));
  }

  await browser.close();
}

findTokenSource().catch(console.error);
