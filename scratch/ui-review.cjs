const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
(async () => {
 const root = path.resolve('public');
 const server = http.createServer((req,res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (e,data) => { if(e) return res.writeHead(404).end(); res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(data); });
 });
 await new Promise(r => server.listen(4173,'127.0.0.1',r));
 const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page = await browser.newPage();
 await page.setRequestInterception(true);
 page.on('request', r => r.url().startsWith('http://127.0.0.1:4173') ? r.continue() : r.abort());
 await page.goto('http://127.0.0.1:4173', {waitUntil:'domcontentloaded'});
 // Inspect static UI independently of unavailable external auth and streaming services.
 await page.evaluate(() => { document.querySelectorAll('body > div').forEach(e => e.style.display='none'); document.querySelector('#dashboardAppView').style.display='flex'; });
 for (const width of [1440,768,390]) {
  await page.setViewport({width,height:1000});
  if(width===390) await page.evaluate(() => document.querySelector('#dashboardAppView').style.display='block');
  for(const id of await page.$$eval('.tab-pane', es => es.map(e=>e.id))) {
   await page.evaluate(id=>document.querySelectorAll('.tab-pane').forEach(e=>e.classList.toggle('active',e.id===id)),id);
   const result = await page.evaluate(() => ({viewport:innerWidth, width:document.documentElement.scrollWidth}));
   console.log(width,id,JSON.stringify(result));
   if(result.width > width) throw new Error('Horizontal overflow: '+id+' at '+width);
  }
  await page.evaluate(()=>document.querySelectorAll('.tab-pane').forEach(e=>e.classList.toggle('active',e.id==='tab-overlays')));
  await page.screenshot({path:'scratch/ui-'+width+'.png',fullPage:true});
 }
 console.log('UI_LAYOUT_PASS');
 } finally { await browser.close(); server.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
