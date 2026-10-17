const puppeteer = require('puppeteer-core');

async function inspectFrames() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  cdp.on('Network.webSocketCreated', ({ url }) => {
    console.log('[WS CREATED]', url);
  });

  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    console.log('[SENT]', response.payloadData);
  });

  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    const data = response.payloadData;
    if (data.includes('ChatMessage') || data.includes('connect') || data.includes('subscribe') || data.includes('token')) {
      console.log('[RECV]', data.substring(0, 300));
    }
  });

  console.log('Navigating to xqc...');
  await page.goto('https://kick.com/xqc', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise(r => setTimeout(r, 6000));
  await browser.close();
}

inspectFrames().catch(console.error);
