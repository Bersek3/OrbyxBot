const https = require('https');

https.get('https://kick.com', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
}, res => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const scripts = data.match(/src="([^"]+\.js)"/g);
    console.log('Scripts:', scripts ? scripts.slice(0, 15) : 'none');
  });
});
