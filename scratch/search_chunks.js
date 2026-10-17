const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  const html = await fetchUrl('https://kick.com');
  const regex = /src="(https:\/\/assets\.kick\.com\/main\/_next\/static\/chunks\/[^"]+\.js)"/g;
  let m;
  const urls = [];
  while ((m = regex.exec(html)) !== null) {
    urls.push(m[1]);
  }
  console.log('Found', urls.length, 'chunks');
  for (const u of urls) {
    try {
      const code = await fetchUrl(u);
      if (code.includes('pusher') || code.includes('Pusher') || code.includes('ws-') || code.includes('cluster') || code.includes('ws.pusherapp')) {
        console.log('Found keyword in chunk:', u);
        const pMatches = code.match(/.{0,60}(pusher|cluster|ws-us|ws-eu).{0,60}/gi);
        console.log(pMatches?.slice(0, 5));
      }
    } catch(e) {}
  }
}

run();
