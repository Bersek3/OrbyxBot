const puppeteer = require('puppeteer-core');

async function inspectKick() {
  console.log('Launching Edge...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0');

  // Intercept CDPSession to capture WebSocket frame and connection URLs
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  cdp.on('Network.webSocketCreated', ({ url }) => {
    console.log('>>> [CDP WebSocket Created]:', url);
  });

  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    try {
      console.log('>>> [CDP WS Received]:', response.payloadData.substring(0, 150));
    } catch(e) {}
  });

  page.on('response', response => {
    const url = response.url();
    if (url.includes('pusher') || url.includes('chatroom') || url.includes('token') || url.includes('ws')) {
      console.log('>>> [HTTP Response]:', response.status(), url);
    }
  });

  console.log('Navigating to kick.com...');
  try {
    await page.goto('https://kick.com/xqc', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch(e) {
    console.log('Goto note:', e.message);
  }

  console.log('Waiting 10s for chat sockets...');
  await new Promise(r => setTimeout(r, 10000));

  await browser.close();
  console.log('Done.');
}

inspectKick().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
