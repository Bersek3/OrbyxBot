const puppeteer = require('puppeteer-core');

async function inspectKickDetailed() {
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
    console.log('=== [WS Created] ===', url);
  });

  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    console.log('>>> [SENT]:', response.payloadData);
  });

  cdp.on('Network.webSocketFrameReceived', ({ response }) => {
    console.log('<<< [RECV]:', response.payloadData.substring(0, 300));
  });

  page.on('request', req => {
    if (req.url().includes('websocket') || req.url().includes('token') || req.url().includes('realtime')) {
      console.log('--- [HTTP REQ] ---', req.method(), req.url(), req.postData());
    }
  });

  page.on('response', async res => {
    if (res.url().includes('websocket') || res.url().includes('token') || res.url().includes('realtime')) {
      try {
        const text = await res.text();
        console.log('--- [HTTP RES] ---', res.status(), res.url(), text);
      } catch(e) {}
    }
  });

  await page.goto('https://kick.com/xqc', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await new Promise(r => setTimeout(r, 6000));
  await browser.close();
}

inspectKickDetailed();
