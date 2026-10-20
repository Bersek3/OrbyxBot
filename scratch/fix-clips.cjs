const fs = require('fs');
function edit(file, transform) { const old=fs.readFileSync(file,'utf8'); const next=transform(old); if(old===next) throw Error('No change: '+file); fs.writeFileSync(file,next); }
edit('public/index.html', s=>s.replace(/\s*<button type="button" id="sidebarCollapseBtn"[\s\S]*?<\/button>/,'').replace(/\s*<button id="topTwitchLoginBtn"[\s\S]*?<\/button>/,'').replace(/\s*<div class="topbar-brand"[\s\S]*?<\/div>/,''));
edit('public/js/dashboard.js', s=>{
 // Only linked account records identify personal channels; never inherit global config.
 const start=s.indexOf('  if (!tw && appConfig?.twitch?.channel',s.indexOf('function getSessionClipChannels'));
 const end=s.indexOf('  // 3.',start);
 s=s.slice(0,start)+s.slice(end);
 const kstart=s.indexOf('  if (!kick) {',s.indexOf('function getSessionClipChannels'));
 const kend=s.indexOf('  // 4.',kstart);
 s=s.slice(0,kstart)+s.slice(kend);
 s=s.replace("    streamerId = getActiveStreamerRoom();\r\n  }\r\n\r\n  // Comprobar", "    streamerId = tw || kick || '';\r\n  }\r\n\r\n  // Comprobar");
 s=s.replace("sessionChannels.twitch, 'plantasi'",'sessionChannels.twitch');
 s=s.replace("let broadcasterId = appConfig?.twitch?.userId || '';", "let broadcasterId = ''; // Resolve the requested login, never reuse another account's ID.");
 s=s.replace("if (!broadcasterId && clientId && token) {", "if (clientId && token) {\n            broadcasterId = '';",1);
 // Both parameters must be explicit, including unlinked platforms.
 s=s.replace("if (sessionChannels.twitch) params.set('twitch', sessionChannels.twitch);", "params.set('twitch', sessionChannels.twitch);");
 s=s.replace("if (sessionChannels.kick) params.set('kick', sessionChannels.kick);", "params.set('kick', sessionChannels.kick);");
 s=s.replace('orbibot_clips_cache_${', 'orbibot_clips_v2_cache_${');
 s=s.replace("  const sessionChannels = getSessionClipChannels();\r\n\r\n  // Actualizar", "  const sessionChannels = getSessionClipChannels();\n  const requestId = ++clipLoadRequestId;\n  allClipsStore = { all: [], twitch: [], kick: [], chat: [], channel: {} };\n  renderClips([]);\n\n  // Actualizar");
 s=s.replace('let clipsData = [];', 'let clipLoadRequestId = 0;\nlet clipsData = [];');
 s=s.replace('    if (data) {\r\n      const sortDesc', "    if (requestId !== clipLoadRequestId || JSON.stringify(sessionChannels) !== JSON.stringify(getSessionClipChannels())) return;\n    if (data) {\n      const sortDesc");
 s=s.replace("    console.warn('[Clips] Error al cargar clips:', e);", "    if (requestId !== clipLoadRequestId || JSON.stringify(sessionChannels) !== JSON.stringify(getSessionClipChannels())) return;\n    console.warn('[Clips] Error al cargar clips:', e);");
 // Reject events without an exact linked channel, even with just one platform connected.
 const a=s.indexOf('  if (data && data.channel) {',s.indexOf('function handleClipWsEvent'));
 const b=s.indexOf("  if (event === 'clip_added'",a);
 s=s.slice(0,a)+`  if (!sessionChannels.isConfigured || !data) return;
  const channel = String(data.channel || '').toLowerCase().replace(/^[#@]/, '').trim();
  const linked = data.platform === 'twitch' ? [sessionChannels.twitch] : data.platform === 'kick' ? [sessionChannels.kick] : [sessionChannels.twitch, sessionChannels.kick];
  if (!channel || !linked.filter(Boolean).includes(channel)) return;

`+s.slice(b);
 return s;
});
edit('src/services/clipService.js',s=>s.replace("options.twitchChannel !== undefined ? options.twitchChannel : (config.twitch?.channel || '')", "options.twitchChannel || ''").replace("options.kickChannel !== undefined ? options.kickChannel : (config.kick?.channel || config.kick?.username || '')", "options.kickChannel || ''").replace('if (!twitchChannel && !kickChannel && !streamerId)', 'if (!twitchChannel && !kickChannel)').replace('if (!broadcasterId && clientId && token) {', "if (clientId && token) {\n        broadcasterId = null;"));
for(const file of ['index.html','js/dashboard.js']) fs.copyFileSync('public/'+file,'docs/'+file);
