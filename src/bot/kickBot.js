const WebSocket = require('ws');
const storage = require('../services/storage');
const ttsService = require('../services/ttsService');
const songRequest = require('../services/songRequest');

class KickBot {
  constructor() {
    this.ws = null;
    this.status = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
    this.statusMessage = 'Desconectado';
    this.eventCallbacks = [];
    this.pingInterval = null;
    this.reconnectTimeout = null;
    this.currentChannel = '';
    this.chatroomId = null;
    this.commandCooldowns = new Map();
    this.isExplicitDisconnect = false;
    this.isConnecting = false;
    this.recentAlerts = new Set();
    this.startWatchdog();
  }

  startWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = setInterval(() => {
      try {
        const config = storage.getConfig();
        const kickCfg = config.kick || {};
        const channelName = (kickCfg.channel || kickCfg.username || '').toLowerCase().replace(/^@/, '').trim();
        const shouldBeConnected = Boolean(channelName && (kickCfg.connected !== false) && !this.isExplicitDisconnect);

        if (shouldBeConnected && !this.isConnecting) {
          const wsState = this.ws ? this.ws.readyState : null;
          // Solo reconectar si el WebSocket no existe o se encuentra cerrado
          if (!this.ws || wsState === WebSocket.CLOSED || wsState === WebSocket.CLOSING) {
            console.log(`[KickBot Watchdog] 🛡️ Verificando socket Kick inactivo... reconectando @${channelName}`);
            this.connect().catch(e => console.warn('[KickBot Watchdog] Error al reconectar:', e.message));
          }
        }
      } catch (e) {}
    }, 30000);
  }

  onEvent(callback) {
    this.eventCallbacks.push(callback);
  }

  broadcast(event, payload) {
    if (payload && typeof payload === 'object') {
      const activeChan = (this.currentChannel || storage.getConfig()?.kick?.channel || storage.getConfig()?.kick?.username || '').toLowerCase().replace(/^@/, '').trim();
      if (!payload.channel && activeChan) payload.channel = activeChan;
      if (!payload.room && activeChan) payload.room = activeChan;
      if (!payload.platform) payload.platform = 'kick';
    }
    for (const cb of this.eventCallbacks) {
      try {
        cb(event, payload);
      } catch (err) {
        console.error('Error in KickBot broadcast callback:', err);
      }
    }
  }

  async getChatroomId(channelName) {
    const clean = (channelName || '').toLowerCase().replace(/^@/, '').trim();
    if (!clean) return null;

    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${clean}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.chatroom && data.chatroom.id) {
          return data.chatroom.id;
        }
        if (data.id) {
          return data.id;
        }
      }
    } catch (e) {
      console.warn(`[KickBot] Fallback fetching chatroom for ${clean}:`, e.message);
    }

    try {
      const res2 = await fetch(`https://kick.com/api/v1/channels/${clean}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (res2.ok) {
        const data2 = await res2.json();
        if (data2.chatroom && data2.chatroom.id) {
          return data2.chatroom.id;
        }
      }
    } catch (e2) {}

    return null;
  }

  async connect() {
    if (this.isConnecting) return { success: false, message: 'Conexión de Kick ya en proceso...' };
    this.isConnecting = true;
    this.isExplicitDisconnect = false;

    const config = storage.getConfig();
    const kickCfg = config.kick || {};
    const channelName = (kickCfg.channel || kickCfg.username || '').toLowerCase().replace(/^@/, '').trim();

    if (!channelName || kickCfg.connected === false) {
      this.isConnecting = false;
      this.status = 'disconnected';
      this.statusMessage = 'Canal de Kick no configurado';
      this.broadcast('bot_status', { status: this.status, message: this.statusMessage, platform: 'kick' });
      return { success: false, message: 'Canal de Kick no configurado.' };
    }

    if (this.ws) {
      this.cleanup();
      try { this.ws.terminate(); } catch (e) {}
      this.ws = null;
    }

    this.currentChannel = channelName;
    this.status = 'connecting';
    this.statusMessage = `Conectando a Kick @${channelName}...`;
    this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: channelName, platform: 'kick' });

    // 1. Resolver chatroom ID
    this.chatroomId = kickCfg.chatroomId || await this.getChatroomId(channelName);
    const targetRoom = this.chatroomId || kickCfg.userId || channelName;

    const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

    try {
      this.ws = new WebSocket(pusherUrl);

      this.ws.on('open', () => {
        this.status = 'connected';
        this.statusMessage = `Conectado al chat de Kick @${channelName}`;
        this.isConnecting = false;
        console.log(`🟢 [KickBot] Conectado exitosamente al chat de Kick @${channelName} (Room: ${targetRoom})`);
        this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: channelName, platform: 'kick' });

        // Suscribirse al canal del chatroom v2
        const subPayload = JSON.stringify({
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `chatrooms.${targetRoom}.v2`
          }
        });
        this.ws.send(subPayload);

        // Suscribirse al canal de eventos del streamer (subs, gifts, follows, raids)
        const channelSubPayload = JSON.stringify({
          event: 'pusher:subscribe',
          data: {
            auth: '',
            channel: `channel.${targetRoom}`
          }
        });
        this.ws.send(channelSubPayload);

        // Suscripción de compatibilidad para chatroom legacy
        if (this.chatroomId && this.chatroomId !== targetRoom) {
          try {
            this.ws.send(JSON.stringify({
              event: 'pusher:subscribe',
              data: { auth: '', channel: `chatrooms.${this.chatroomId}.v2` }
            }));
          } catch(e) {}
        }

        // Keep-alive ping cada 20s
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
          }
        }, 20000);
      });

      this.ws.on('message', (rawData) => {
        try {
          const packet = JSON.parse(rawData.toString());
          this.handlePusherPacket(packet);
        } catch (err) {
          console.error('[KickBot] Error parsing packet:', err);
        }
      });

      this.ws.on('error', (err) => {
        console.warn('[KickBot] WebSocket error:', err.message);
        this.status = 'error';
        this.statusMessage = err.message;
        this.isConnecting = false;
        this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: channelName, platform: 'kick' });
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🟡 [KickBot] Desconectado (${code}): ${reason || 'Cierre de conexión'}`);
        this.isConnecting = false;
        if (!this.isExplicitDisconnect) {
          this.status = 'connecting';
          this.statusMessage = 'Reconectando con el chat de Kick...';
        } else {
          this.status = 'disconnected';
          this.statusMessage = 'Desconectado';
        }
        this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: channelName, platform: 'kick' });
        this.cleanup();
        this.scheduleReconnect();
      });

      return { success: true, message: `Conectado al chat de Kick @${channelName}` };
    } catch (err) {
      console.error('[KickBot] Error al conectar:', err);
      this.isConnecting = false;
      this.status = 'error';
      this.statusMessage = err.message;
      this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: channelName, platform: 'kick' });
      this.scheduleReconnect();
      return { success: false, message: err.message };
    }
  }

  async sendMessage(channelOrText, textIfTwoArgs) {
    let targetChannel = this.currentChannel;
    let message = '';

    if (textIfTwoArgs !== undefined) {
      targetChannel = channelOrText || this.currentChannel;
      message = textIfTwoArgs;
    } else {
      message = channelOrText;
    }

    if (!message || typeof message !== 'string') return;
    const cleanMsg = message.trim();
    if (!cleanMsg) return;

    const config = storage.getConfig();
    const kickCfg = config.kick || {};
    const botName = kickCfg.username || kickCfg.channel || 'OrbiBot';

    // 1. Emitir localmente para que el multi-chat de OBS y el Dashboard muestren la respuesta del bot
    this.broadcast('chat_message', {
      id: `kick-bot-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      platform: 'kick',
      user: botName,
      color: '#53fc18',
      message: cleanMsg,
      isMod: true,
      isSub: true,
      badges: [{ type: 'broadcaster', text: 'BOT' }, { type: 'moderator', text: 'MOD' }],
      badgesRaw: null,
      emotes: null,
      channel: targetChannel
    });

    // 2. Si hay token OAuth de Kick con permiso de escritura de chat, enviar a la API de Kick
    if (kickCfg.accessToken) {
      try {
        const res = await fetch('https://api.kick.com/public/v1/chat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${kickCfg.accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            content: cleanMsg,
            type: 'bot'
          })
        });

        if (!res.ok) {
          // Intentar ruta alternativa de chatrooms si la general devuelve error
          if (this.chatroomId) {
            await fetch(`https://api.kick.com/public/v1/chatrooms/${this.chatroomId}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${kickCfg.accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              body: JSON.stringify({
                content: cleanMsg,
                type: 'message'
              })
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[KickBot] Aviso al enviar chat a Kick (modo lectura o token sin permisos):', err.message);
      }
    }
  }

  handlePusherPacket(packet) {
    if (!packet || !packet.event) return;

    // 1. EVENTO DE MENSAJE DE CHAT
    if (packet.event === 'App\\Events\\ChatMessageEvent' || packet.event === 'ChatMessageEvent') {
      try {
        const msgData = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const sender = msgData.sender || {};
        const username = sender.username || sender.slug || 'KickUser';
        const color = sender.identity?.color || '#53fc18';
        const message = msgData.content || '';
        const badges = sender.identity?.badges || [];

        const isBroadcaster = badges.some(b => b.type === 'broadcaster') || (username.toLowerCase() === this.currentChannel.toLowerCase());
        const isMod = badges.some(b => b.type === 'moderator') || isBroadcaster;
        const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'sub_gifter');
        const isModOrBroadcaster = isMod || isBroadcaster;

        const chatPayload = {
          id: msgData.id || `kick-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          platform: 'kick',
          user: username,
          color,
          message,
          isMod,
          isSub,
          badges,
          badgesRaw: null,
          emotes: null,
          channel: this.currentChannel
        };

        this.broadcast('chat_message', chatPayload);

        const trimmed = message.trim();
        const firstWord = trimmed.split(' ')[0].toLowerCase();
        const config = storage.getConfig();
        const isSrEnabled = config.songRequest && config.songRequest.enabled !== false;
        const srPrefix = (config.songRequest?.prefix || '!sr').toLowerCase();

        // Comandos de moderación para pausar Song Request (!srpausa, !srpause, !pausa, !pause)
        if (firstWord === '!srpausa' || firstWord === '!srpause' || firstWord === '!pausa' || firstWord === '!pause') {
          if (!isSrEnabled) return;
          if (isModOrBroadcaster) {
            const res = songRequest.pauseSong(this.currentChannel, username);
            this.sendMessage(this.currentChannel, res.message);
          } else {
            this.sendMessage(this.currentChannel, `@${username}, solo moderadores y el streamer pueden pausar la música.`);
          }
          return;
        }

        // Comandos de moderación para reanudar / reproducir Song Request (!srplay, !srresume, !srreanudar, !reanudar, !resume)
        if (firstWord === '!srplay' || firstWord === '!srresume' || firstWord === '!srreanudar' || firstWord === '!reanudar' || firstWord === '!resume') {
          if (!isSrEnabled) return;
          if (isModOrBroadcaster) {
            const res = songRequest.resumeSong(this.currentChannel, username);
            this.sendMessage(this.currentChannel, res.message);
          } else {
            this.sendMessage(this.currentChannel, `@${username}, solo moderadores y el streamer pueden reanudar la música.`);
          }
          return;
        }

        // Check !song (canción sonando ahora)
        if (firstWord === '!song' || firstWord === '!cancion') {
          if (!isSrEnabled) return;
          const state = songRequest.getState(this.currentChannel);
          if (state.currentSong) {
            const playStatus = state.isPlaying ? '🎶 Sonando ahora' : '⏸️ En pausa';
            this.sendMessage(this.currentChannel, `${playStatus}: ${state.currentSong.title} (pedida por @${state.currentSong.requester})`);
          } else {
            this.sendMessage(this.currentChannel, 'No hay ninguna canción reproduciéndose en este momento.');
          }
          return;
        }

        // Check !skip (saltar canción)
        if (firstWord === '!skip' || firstWord === '!saltar') {
          if (!isSrEnabled) return;
          if (isModOrBroadcaster) {
            const res = songRequest.skip(this.currentChannel, username, true);
            this.sendMessage(this.currentChannel, res.message);
          } else {
            const res = songRequest.voteSkip(this.currentChannel, username);
            this.sendMessage(this.currentChannel, res.message);
          }
          return;
        }

        // Check !queue (cola de canciones)
        if (firstWord === '!queue' || firstWord === '!cola') {
          if (!isSrEnabled) return;
          const state = songRequest.getState(this.currentChannel);
          if (state.queue.length === 0) {
            this.sendMessage(this.currentChannel, 'La cola de reproducción está vacía.');
          } else {
            const nextSongs = state.queue.slice(0, 3).map((s, i) => `#${i + 1} ${s.title}`).join(' | ');
            this.sendMessage(this.currentChannel, `Próximas: ${nextSongs} (Total en cola: ${state.queue.length})`);
          }
          return;
        }

        // Check Song Request Command (!sr o prefijo configurado)
        if (trimmed.toLowerCase().startsWith(srPrefix)) {
          if (!isSrEnabled) {
            this.sendMessage(this.currentChannel, `@${username}, el sistema de Song Request está desactivado en este momento.`);
            return;
          }
          const query = trimmed.slice(srPrefix.length).trim();
          if (!query) {
            this.sendMessage(this.currentChannel, `@${username}, uso: ${srPrefix} <enlace o nombre de canción>`);
            return;
          }

          songRequest.addSong({
            channel: this.currentChannel,
            query,
            requester: username,
            isMod: isModOrBroadcaster,
            isSub
          }).then(result => {
            this.sendMessage(this.currentChannel, result.message);
          });
          return;
        }

        // Comandos de moderación para TTS en Kick (!ttsdetener, !ttsreiniciar, !ttsskip)
        if (firstWord === '!ttsdetener' || firstWord === '!ttsstop' || firstWord === '!ttspause') {
          if (isModOrBroadcaster) {
            ttsService.stopTTS(this.currentChannel, username);
            this.sendMessage(this.currentChannel, `[TTS] ⏹️ Audio de TTS detenido por @${username}.`);
            return;
          }
        }

        if (firstWord === '!ttsreiniciar' || firstWord === '!ttsreset' || firstWord === '!ttsclear') {
          if (isModOrBroadcaster) {
            ttsService.resetTTS(this.currentChannel, username);
            this.sendMessage(this.currentChannel, `[TTS] 🔄 Cola de TTS reiniciada y reproductor restablecido por @${username}.`);
            return;
          }
        }

        if (firstWord === '!ttsskip' || firstWord === '!ttssaltar') {
          if (isModOrBroadcaster) {
            ttsService.skipTTS(this.currentChannel, username);
            this.sendMessage(this.currentChannel, `[TTS] ⏭️ Mensaje TTS saltado por @${username}.`);
            return;
          }
        }

        // Procesar Comandos TTS en Kick (Genérico !tts o de Voces IA ej: !messi, !homero, !dross, !rubius, !cr7, etc.)
        const ttsConfig = config.tts || {};
        if (ttsConfig.enabled !== false) {
          const ttsCmd = (ttsConfig.chatCommand || '!tts').toLowerCase();
          const ttsVoiceCommands = storage.getTtsCommands() || [];
          let matchedVoiceCmd = ttsVoiceCommands.find(c => c.enabled && c.command && c.command.toLowerCase() === firstWord);
          if (!matchedVoiceCmd && firstWord.startsWith('!')) {
            const token = firstWord.slice(1);
            const resolvedVoice = ttsService.normalizeVoice(token, null);
            if (resolvedVoice && resolvedVoice !== 'es_mx_mia') {
              matchedVoiceCmd = {
                id: 'tts_cmd_' + token,
                voiceId: resolvedVoice,
                name: token,
                command: firstWord,
                permissions: ['todos'],
                enabled: true,
                volume: 90,
                rate: 1.0,
                pitch: 1.0
              };
            }
          }

          const userBadges = {
            isMod,
            isSub,
            vip: badges.some(b => b.type === 'vip'),
            broadcaster: isBroadcaster
          };

          if (matchedVoiceCmd && ttsService.hasPermission(matchedVoiceCmd, userBadges)) {
            const voiceText = trimmed.slice(matchedVoiceCmd.command.length).trim();
            if (voiceText) {
              ttsService.processRequest({
                user: username,
                text: voiceText,
                source: 'chat',
                voiceOverride: matchedVoiceCmd.voiceId,
                channel: this.currentChannel,
                userBadges
              });
              return;
            }
          } else if (ttsConfig.allowChatCommand !== false && trimmed.toLowerCase().startsWith(ttsCmd)) {
            const ttsText = trimmed.slice(ttsCmd.length).trim();
            if (ttsText) {
              ttsService.processRequest({
                user: username,
                text: ttsText,
                source: 'chat',
                channel: this.currentChannel,
                userBadges
              });
              return;
            }
          }
        }

        // Procesar Comandos Personalizados de Chat en Kick (storage.getCommands)
        const commands = storage.getCommands();
        const matchedCmd = commands.find(c => c.enabled && c.name && c.name.toLowerCase() === firstWord);

        if (matchedCmd) {
          const now = Date.now();
          const lastUsed = this.commandCooldowns.get(matchedCmd.id) || 0;
          const cooldown = matchedCmd.cooldown !== undefined ? Number(matchedCmd.cooldown) : 5;
          const cooldownMs = cooldown * 1000;

          if (cooldown <= 0 || isMod || (now - lastUsed >= cooldownMs)) {
            this.commandCooldowns.set(matchedCmd.id, now);
            const rawResponse = matchedCmd.response || '';
            const args = trimmed.split(' ').slice(1);
            const targetUser = args[0] ? args[0].replace(/^@/, '') : username;
            const queryRest = args.join(' ');

            let finalResponse = rawResponse
              .replace(/\{user\}|\{usuario\}/gi, `@${username}`)
              .replace(/\{target\}|\{objetivo\}/gi, `@${targetUser}`)
              .replace(/\{streamer\}|\{canal\}/gi, this.currentChannel)
              .replace(/\{channel\}/gi, this.currentChannel)
              .replace(/\{query\}|\{busqueda\}/gi, queryRest || '');

            this.sendMessage(this.currentChannel, finalResponse);
          }
        }
      } catch (e) {
        console.error('[KickBot] Error processing chat message:', e);
      }
    }

    // 2. EVENTO DE SUSCRIPCIONES (Nuevas y Resubs)
    else if (packet.event === 'App\\Events\\SubscriptionEvent' || packet.event === 'SubscriptionEvent') {
      try {
        const subData = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const user = subData.username || subData.user?.username || subData.sender?.username || 'KickUser';
        const months = subData.months || subData.duration || 1;

        this.incrementGoalsByType('subs', 1);
        this.broadcast('alert', {
          type: 'sub',
          platform: 'kick',
          user,
          months,
          tier: '1',
          message: `¡Nueva suscripción en Kick (${months} meses)!`
        });
      } catch (e) {
        console.warn('[KickBot] Error parsing SubscriptionEvent:', e.message);
      }
    }

    // 3. EVENTO DE SUSCRIPCIONES REGALADAS (Gifted Subs)
    else if (packet.event === 'App\\Events\\GiftedSubscriptionsEvent' || packet.event === 'GiftedSubscriptionsEvent') {
      try {
        const giftData = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const gifter = giftData.gifter_username || giftData.username || giftData.sender?.username || 'KickUser';
        const count = Array.isArray(giftData.gifted_usernames) ? giftData.gifted_usernames.length : (giftData.count || 1);

        this.incrementGoalsByType('subs', count);
        this.broadcast('alert', {
          type: 'sub',
          platform: 'kick',
          user: gifter,
          amount: count,
          isGift: true,
          tier: '1',
          message: `¡${gifter} regaló ${count} suscripción(es) en Kick! 🎁`
        });
      } catch (e) {
        console.warn('[KickBot] Error parsing GiftedSubscriptionsEvent:', e.message);
      }
    }

    // 4. EVENTO DE SEGUIDORES (Followers)
    else if (packet.event === 'App\\Events\\FollowersUpdated' || packet.event === 'FollowersUpdated' || packet.event === 'FollowEvent' || packet.event === 'App\\Events\\FollowEvent') {
      try {
        const folData = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const user = folData.username || folData.user?.username || folData.follower?.username || 'Nuevo Seguidor';

        this.incrementGoalsByType('followers', 1);
        this.broadcast('alert', {
          type: 'follower',
          platform: 'kick',
          user,
          message: '¡Nuevo seguidor en Kick!'
        });
      } catch (e) {
        console.warn('[KickBot] Error parsing FollowersUpdated:', e.message);
      }
    }

    // 5. EVENTO DE RAIDS / HOSTS
    else if (packet.event === 'App\\Events\\StreamHostEvent' || packet.event === 'StreamHostEvent') {
      try {
        const hostData = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const hostUser = hostData.host_username || hostData.username || 'Streamer';
        const viewers = hostData.number_viewers || hostData.viewers || 1;

        this.broadcast('alert', {
          type: 'raid',
          platform: 'kick',
          user: hostUser,
          viewers,
          message: `¡Raid de ${hostUser} con ${viewers} espectadores desde Kick!`
        });
      } catch (e) {
        console.warn('[KickBot] Error parsing StreamHostEvent:', e.message);
      }
    }

    // 6. EVENTO DE KICKS / DONACIONES / TIPS
    else if (packet.event === 'App\\Events\\KicksEvent' || packet.event === 'KicksEvent' || packet.event === 'App\\Events\\GiftEvent' || packet.event === 'GiftEvent') {
      try {
        const kickGift = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet.data;
        const user = kickGift.username || kickGift.sender?.username || 'KickUser';
        const amount = kickGift.amount || kickGift.kicks || 1;

        this.incrementGoalsByType('tips', amount);
        this.broadcast('alert', {
          type: 'kicks',
          platform: 'kick',
          user,
          amount,
          message: `${user} envió ${amount} KICKs!`
        });
      } catch (e) {
        console.warn('[KickBot] Error parsing KicksEvent:', e.message);
      }
    }
  }

  incrementGoalsByType(type, amount = 1) {
    try {
      const goals = storage.getGoals();
      if (!Array.isArray(goals) || goals.length === 0) return;
      let updated = false;
      goals.forEach(g => {
        if (g.enabled !== false && (g.type === type || g.type === type.replace(/s$/, '') || (type === 'subs' && g.type === 'sub') || (type === 'followers' && g.type === 'follower'))) {
          g.current = (Number(g.current) || 0) + Number(amount);
          updated = true;
          this.broadcast('goal_update', { goalId: g.id, type: g.type, goal: g, platform: 'kick' });
        }
      });
      if (updated) {
        storage.saveGoals(goals);
      }
    } catch(e) {
      console.warn('[KickBot] Error al auto-incrementar meta de Kick:', e.message);
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    const config = storage.getConfig();
    if (config.kick && (config.kick.channel || config.kick.username) && config.kick.connected !== false && !this.isExplicitDisconnect) {
      this.reconnectTimeout = setTimeout(() => {
        console.log('🔄 [KickBot] Intentando reconectar chat de Kick...');
        this.connect();
      }, 6000);
    }
  }

  cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect() {
    this.isExplicitDisconnect = true;
    this.cleanup();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) {}
      this.ws = null;
    }
    this.status = 'disconnected';
    this.statusMessage = 'Desconectado';
    this.broadcast('bot_status', { status: this.status, message: this.statusMessage, channel: this.currentChannel, platform: 'kick' });
    return { success: true, message: 'Bot de Kick desconectado.' };
  }
}

const kickBot = new KickBot();
module.exports = kickBot;
