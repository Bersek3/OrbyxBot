require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const port = Number(process.env.PORT || 3000);
const state = { channel: '', status: 'disconnected', message: 'Configura un canal de Kick para comenzar.', chatroomId: null, socket: null, ping: null };

app.use(express.json({ limit: '64kb' }));
app.use('/overlays', express.static(path.join(__dirname, 'kick-public', 'overlays')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'kick-public', 'index.html')));

const cleanChannel = (value) => String(value || '').trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_-]/g, '');
function publish(event, data) { const body = JSON.stringify({ event, data, timestamp: Date.now() }); for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(body); }
function setStatus(status, message) { state.status = status; state.message = message; publish('status', { status, message, channel: state.channel }); }
function disconnect() {
  if (state.ping) clearInterval(state.ping); state.ping = null;
  if (state.socket) { state.socket.removeAllListeners(); try { state.socket.close(); } catch (_) {} }
  state.socket = null; state.chatroomId = null;
  setStatus('disconnected', state.channel ? `Desconectado de @${state.channel}.` : 'Desconectado.');
}
async function connect(input) {
  const channel = cleanChannel(input);
  if (!channel) throw new Error('Indica el nombre de tu canal de Kick.');
  disconnect(); state.channel = channel; setStatus('connecting', `Buscando el chat de @${channel}…`);
  const headers = { Accept: 'application/json', 'User-Agent': 'OrbyxBot-Kick-Only/1.0', Referer: `https://kick.com/${channel}` };
  const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`, { headers });
  if (!response.ok) throw new Error(`Kick no encontró @${channel} (HTTP ${response.status}).`);
  const profile = await response.json(); const room = profile.chatroom?.id || profile.id;
  if (!room) throw new Error('Kick no devolvió una sala de chat para este canal.');
  state.chatroomId = room;
  const authResponse = await fetch('https://web.kick.com/api/v1/realtime/auth/connection', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Origin: 'https://kick.com', 'x-app-platform': 'web' }, body: JSON.stringify({ client_id: crypto.randomUUID() }) });
  if (!authResponse.ok) throw new Error(`Kick no autorizó la conexión en tiempo real (HTTP ${authResponse.status}).`);
  const token = (await authResponse.json()).data?.token;
  if (!token) throw new Error('Kick no proporcionó un token de conexión.');
  const socket = new WebSocket('wss://realtime.us-west-2.platform.kick.com/connection/websocket', { headers: { Origin: 'https://kick.com', 'User-Agent': headers['User-Agent'] } });
  state.socket = socket;
  socket.on('open', () => socket.send(JSON.stringify({ connect: { token, name: 'js' }, id: 1 })));
  socket.on('message', (raw) => {
    let packet; try { packet = JSON.parse(raw.toString()); } catch (_) { return; }
    if (packet.id === 1 && packet.connect) { socket.send(JSON.stringify({ subscribe: { channel: `chatrooms.${room}.v2`, flag: 1 }, id: 2 })); state.ping = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('{}'); }, 25000); setStatus('connected', `Conectado al chat de Kick @${channel}.`); }
    const publication = packet.push?.pub?.data; if (!publication) return;
    let chat; try { chat = typeof publication === 'string' ? JSON.parse(publication) : publication; } catch (_) { return; }
    const message = chat.content || chat.message?.content || chat.data?.content;
    const sender = chat.sender?.username || chat.user?.username || chat.message?.sender?.username || 'viewer';
    if (message) publish('chat', { sender, message, channel });
  });
  socket.on('error', (error) => setStatus('error', `Error de Kick: ${error.message}`));
  socket.on('close', () => { if (state.socket === socket) setStatus('disconnected', `La conexión de Kick @${channel} se cerró.`); });
  return { channel, chatroomId: room };
}
app.get('/api/status', (_req, res) => res.json({ platform: 'kick', channel: state.channel, status: state.status, message: state.message, chatroomId: state.chatroomId }));
app.post('/api/kick/connect', async (req, res) => { try { res.json({ success: true, ...(await connect(req.body?.channel)) }); } catch (error) { disconnect(); res.status(400).json({ success: false, message: error.message }); } });
app.post('/api/kick/disconnect', (_req, res) => { disconnect(); res.json({ success: true }); });
wss.on('connection', (socket) => socket.send(JSON.stringify({ event: 'status', data: { status: state.status, message: state.message, channel: state.channel } })));
server.listen(port, '127.0.0.1', () => console.log(`OrbyxBot Kick-only listo en http://127.0.0.1:${port}`));
