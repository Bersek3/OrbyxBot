const WebSocket = require('ws');

async function testCentrifugo() {
  console.log('1. Obteniendo token de https://web.kick.com/api/v1/realtime/auth/connection ...');
  const res = await fetch('https://web.kick.com/api/v1/realtime/auth/connection', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    }
  });

  const json = await res.json();
  console.log('Token obtenido:', json);

  const token = json.data?.token;
  if (!token) {
    console.error('No se pudo obtener token');
    return;
  }

  const wsUrl = 'wss://realtime.us-east-1.platform.kick.com/connection/websocket';
  console.log('2. Conectando a', wsUrl);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('✅ WebSocket abierto!');
    // Enviar connect con el token
    const connectMsg = {
      connect: {
        token: token,
        name: 'js'
      },
      id: 1
    };
    ws.send(JSON.stringify(connectMsg));
    console.log('Enviado connect frame');
  });

  ws.on('message', data => {
    console.log('📩 Recibido:', data.toString());
    const msg = JSON.parse(data.toString());
    // Si connect tuvo éxito
    if (msg.id === 1 && msg.connect) {
      console.log('🎉 CONNECT EXITOSO! Subscribiendo a chatrooms.36939677.v2 (canal bersek3)...');
      ws.send(JSON.stringify({
        subscribe: {
          channel: 'chatrooms.36939677.v2',
          flag: 1
        },
        id: 2
      }));
    }
    if (msg.id === 2 && msg.subscribe) {
      console.log('🎉🎉 SUBSCRIPCIÓN EXITOSA A KICK CHATROOM!');
      console.log('Esperando mensajes del chat de Kick en vivo...');
    }
    if (msg.push && msg.push.pub) {
      console.log('🔥 ¡MENSAJE EN VIVO DE KICK!:');
      console.log(JSON.stringify(msg.push.pub.data));
    }
  });

  ws.on('error', err => {
    console.error('❌ Error WS:', err);
  });

  ws.on('close', (code, reason) => {
    console.log('Cerrado:', code, reason.toString());
  });

  setTimeout(() => {
    console.log('Fin de prueba (20s)');
    ws.close();
  }, 20000);
}

testCentrifugo().catch(console.error);
