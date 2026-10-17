const crypto = require('crypto');
const WebSocket = require('ws');

async function testCentrifugoConnection() {
  const clientId = crypto.randomUUID();
  console.log('ClientId:', clientId);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'x-app-platform': 'web',
    'Referer': 'https://kick.com/',
    'Origin': 'https://kick.com'
  };

  // 1. POST realtime/connection
  const connRes = await fetch('https://web.kick.com/api/v1/realtime/connection', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      client: { id: clientId, type: 'web' },
      capabilities: { accepted_providers: [{ provider: 'centrifugo' }] }
    })
  });
  const connData = await connRes.json();
  console.log('ConnData:', JSON.stringify(connData));

  // 2. POST realtime/auth/connection
  const authRes = await fetch('https://web.kick.com/api/v1/realtime/auth/connection', {
    method: 'POST',
    headers,
    body: JSON.stringify({ client_id: clientId })
  });
  const authData = await authRes.json();
  console.log('AuthData:', JSON.stringify(authData));

  const token = authData.data?.token;
  const wsUrl = connData.data?.endpoint || 'wss://realtime.us-west-2.platform.kick.com/connection/websocket';
  console.log('WS URL:', wsUrl, 'Token:', token ? token.substring(0, 30) + '...' : 'none');

  if (!token) return;

  const ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Origin': 'https://kick.com'
    }
  });

  ws.on('open', () => {
    console.log('WS Open! Enviando connect...');
    ws.send(JSON.stringify({
      connect: { token, name: 'js' },
      id: 1
    }));
  });

  ws.on('message', data => {
    const text = data.toString();
    console.log('WS Msg:', text);
    try {
      const msg = JSON.parse(text);
      if (msg.id === 1 && msg.connect) {
        console.log('Connect exitoso! Subscribiendo a chatrooms.36939677.v2...');
        ws.send(JSON.stringify({
          subscribe: { channel: 'chatrooms.36939677.v2', flag: 1 },
          id: 2
        }));
      }
      if (msg.id === 2 && msg.subscribe) {
        console.log('Subscripción confirmada! 🎉🎉');
      }
    } catch(e) {}
  });

  ws.on('error', e => console.error('WS Error:', e.message));
  ws.on('close', (c, r) => console.log('WS Close:', c, r.toString()));

  setTimeout(() => {
    ws.close();
    console.log('Prueba terminada.');
  }, 10000);
}

testCentrifugoConnection().catch(console.error);
