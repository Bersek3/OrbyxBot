async function test() {
  try {
    const res = await fetch('https://kick.com', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    console.log('Status:', res.status);
    const html = await res.text();
    console.log('HTML length:', html.length);
    // Find script tags
    const scriptMatches = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)].map(m => m[1]);
    console.log('Scripts found:', scriptMatches.slice(0, 5));

    for (const src of scriptMatches.slice(0, 8)) {
      const scriptUrl = src.startsWith('http') ? src : `https://kick.com${src}`;
      try {
        const sRes = await fetch(scriptUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (sRes.ok) {
          const sText = await sRes.text();
          const pusherMatch = sText.match(/pusher[^;,\n]{0,100}|cluster[^;,\n]{0,100}|ws-[a-z0-9]+/gi);
          if (pusherMatch) {
            console.log('Found in', scriptUrl, pusherMatch.slice(0, 5));
          }
          const appKeyMatch = sText.match(/[a-f0-9]{20}/g);
          if (appKeyMatch) {
            console.log('Hex20 in', scriptUrl, appKeyMatch.slice(0, 5));
          }
        }
      } catch(e) {}
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}
test();
