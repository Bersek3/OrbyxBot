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
  const code = await fetchUrl('https://assets.kick.com/main/_next/static/chunks/0vf3mmzsywzg3.js');
  // inspect surroundings of accepted_providers
  const idx = code.indexOf('accepted_providers');
  console.log('Snippet around accepted_providers:');
  console.log(code.substring(Math.max(0, idx - 200), idx + 600));
}

run();
