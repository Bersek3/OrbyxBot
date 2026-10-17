const WebSocket = require('ws');
const key = '32cbd69e4b950bf97679';

const testUrls = [
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=7&client=js&version=8.4.0',
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=7&client=js&version=7.6.0',
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=7&client=js&version=8.3.0',
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=7&client=js&version=8.4.0-rc2&flash=false',
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=5&client=js&version=5.0.0',
  'wss://ws-us2.pusher.com/app/' + key + '?protocol=7&client=js&version=7.4.0&flash=false',
];

testUrls.forEach((u, i) => {
  const ws = new WebSocket(u);
  ws.on('open', () => console.log('OPEN', i));
  ws.on('message', m => console.log('MSG', i, m.toString()));
  ws.on('close', (c, r) => console.log('CLOSE', i, c, r.toString()));
});
