const storage = require('./storage');

class ClipService {
  constructor() {
    this.streamerCaches = new Map();
    this.cacheTtlMs = 3 * 60 * 1000; // 3 minutos de caché en memoria por canal
  }

  /**
   * Obtiene los clips de Twitch directamente de la API Helix para el canal especificado (últimos 30 días)
   */
  async fetchTwitchClips(targetChannel = null, limit = 50, streamerId = null) {
    try {
      const config = storage.getConfig();
      const twitchCfg = config.twitch || {};
      const channelName = (targetChannel !== null ? targetChannel : (twitchCfg.channel || '')).toLowerCase().replace(/^#/, '').trim();
      let clientId = twitchCfg.clientId || process.env.TWITCH_CLIENT_ID || 'yw1vr664ichms8an2x5lhji58v7ozk';
      let token = (twitchCfg.oauthToken || process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/i, '').trim();

      if (!channelName) return [];

      let broadcasterId = (channelName === (twitchCfg.channel || '').toLowerCase().replace(/^#/, '').trim()) ? twitchCfg.userId : null;

      // Consultar credenciales específicas del streamer en Supabase si están disponibles
      if ((!broadcasterId || !token) && storage.supabase) {
        try {
          const searchScopes = [channelName, streamerId].filter(Boolean);
          const { data: supaAuth } = await storage.supabase
            .from('orbibot_settings')
            .select('value')
            .in('streamer_id', searchScopes)
            .eq('key', 'twitch_auth')
            .limit(1);
          if (supaAuth && supaAuth.length > 0 && supaAuth[0].value) {
            const v = typeof supaAuth[0].value === 'string' ? JSON.parse(supaAuth[0].value) : supaAuth[0].value;
            if (v.userId) broadcasterId = v.userId;
            if (v.oauthToken) token = v.oauthToken.replace(/^oauth:/i, '').trim();
            if (v.clientId) clientId = v.clientId;
          }
        } catch (e) {}
      }

      // Si no tenemos broadcasterId para este canal específico, lo resolvemos con el login del canal
      if (!broadcasterId && clientId && token) {
        try {
          const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(channelName)}`, {
            headers: {
              'Client-Id': clientId,
              'Authorization': `Bearer ${token}`
            }
          });
          if (userRes.ok) {
            const uData = await userRes.json();
            if (uData.data && uData.data.length > 0) {
              broadcasterId = uData.data[0].id;
              if (channelName === (twitchCfg.channel || '').toLowerCase().replace(/^#/, '').trim()) {
                twitchCfg.userId = broadcasterId;
                const fullCfg = storage.getConfig();
                fullCfg.twitch = { ...fullCfg.twitch, userId: broadcasterId };
                storage.saveConfig(fullCfg);
              }
            }
          }
        } catch (e) {
          console.warn('[ClipService] Error al resolver broadcasterId de Twitch:', e.message);
        }
      }

      if (!broadcasterId || !clientId || !token) {
        return [];
      }

      // Filtrar clips de los últimos 30 días
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgoISO = new Date(thirtyDaysAgo).toISOString();

      const clipsRes = await fetch(
        `https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&started_at=${encodeURIComponent(thirtyDaysAgoISO)}&first=${limit}`,
        {
          headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!clipsRes.ok) {
        console.warn(`[ClipService] Error de Twitch Helix clips (${clipsRes.status}):`, await clipsRes.text());
        return [];
      }

      const clipsJson = await clipsRes.json();
      const rawClips = clipsJson.data || [];

      return rawClips
        .map(c => ({
          id: c.id,
          url: c.url,
          embedUrl: c.embed_url,
          title: c.title || 'Clip de Twitch',
          creator: c.creator_name || 'Desconocido',
          broadcaster: c.broadcaster_name || channelName,
          thumbnail: c.thumbnail_url,
          views: c.view_count || 0,
          duration: Math.round(c.duration || 0),
          createdAt: c.created_at ? new Date(c.created_at).getTime() : Date.now(),
          platform: 'twitch',
          source: 'channel'
        }))
        .filter(c => (c.createdAt || 0) >= thirtyDaysAgo)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
      console.error('[ClipService] Error al obtener clips de Twitch:', err.message);
      return [];
    }
  }

  /**
   * Obtiene los clips de Kick directamente de la API pública de Kick para el canal configurado (últimos 30 días)
   */
  async fetchKickClips(targetChannel = null, limit = 50) {
    try {
      const config = storage.getConfig();
      const kickCfg = config.kick || {};
      const channelName = (targetChannel !== null ? targetChannel : (kickCfg.channel || kickCfg.username || '')).toLowerCase().replace(/^@/, '').trim();

      if (!channelName) return [];

      const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(channelName)}/clips`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!res.ok) {
        return [];
      }

      const data = await res.json();
      const rawClips = (data && Array.isArray(data.clips)) ? data.clips : [];
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      return rawClips
        .slice(0, limit)
        .map(c => ({
          id: c.id,
          url: `https://kick.com/${channelName}/clips/${c.id}`,
          embedUrl: c.clip_url || c.video_url || '',
          videoUrl: c.clip_url || c.video_url || '',
          title: c.title || 'Clip de Kick',
          creator: c.creator?.username || 'Anónimo',
          broadcaster: channelName,
          thumbnail: c.thumbnail_url || (c.channel?.profile_picture || ''),
          views: c.views || c.view_count || 0,
          duration: Math.round(c.duration || 0),
          createdAt: c.created_at ? new Date(c.created_at).getTime() : Date.now(),
          platform: 'kick',
          source: 'channel'
        }))
        .filter(c => (c.createdAt || 0) >= thirtyDaysAgo)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
      console.warn('[ClipService] Error al obtener clips de Kick:', err.message);
      return [];
    }
  }

  /**
   * Obtiene todos los clips del canal (Twitch + Kick) combinados con los guardados manualmente por chat
   * Aislados por creador/sesión y filtrados a los últimos 30 días
   */
  async getClipsSummary(forceRefresh = false, options = {}) {
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    const config = storage.getConfig();

    // Determinar canales exactos de la sesión solicitada
    const twitchChannel = (options.twitchChannel !== undefined ? options.twitchChannel : (config.twitch?.channel || '')).toLowerCase().replace(/^#/, '').trim();
    const kickChannel = (options.kickChannel !== undefined ? options.kickChannel : (config.kick?.channel || config.kick?.username || '')).toLowerCase().replace(/^@/, '').trim();
    const streamerId = (options.streamerId || twitchChannel || kickChannel || '').toLowerCase().trim();

    // Si la sesión no tiene ningún canal vinculado, no retornar clips de otro streamer
    if (!twitchChannel && !kickChannel && !streamerId) {
      return {
        success: true,
        channel: { twitch: '', kick: '' },
        twitchClips: [],
        kickClips: [],
        chatClips: [],
        allClips: [],
        lastUpdated: now,
        fromCache: false
      };
    }

    const cacheKey = `${twitchChannel}__${kickChannel}__${streamerId}`;
    const cachedEntry = this.streamerCaches.get(cacheKey);

    const sortByDateDesc = (arr) => {
      return [...(arr || [])]
        .filter(c => {
          const t = Number(c.createdAt) || (c.created_at ? new Date(c.created_at).getTime() : 0);
          return t >= thirtyDaysAgo;
        })
        .sort((a, b) => {
          const tA = Number(a.createdAt) || (a.created_at ? new Date(a.created_at).getTime() : 0);
          const tB = Number(b.createdAt) || (b.created_at ? new Date(b.created_at).getTime() : 0);
          return tB - tA;
        });
    };

    // Usar caché si aún está fresca para esta sesión
    if (!forceRefresh && cachedEntry && (now - cachedEntry.lastUpdated < this.cacheTtlMs)) {
      const allChatClips = storage.getClips() || [];
      const chatClips = sortByDateDesc(
        allChatClips
          .filter(c => {
            const cChan = (c.channel || '').toLowerCase().replace(/^[#@]/, '');
            const cStreamer = (c.streamerId || '').toLowerCase();
            return (
              (twitchChannel && cChan === twitchChannel) ||
              (kickChannel && cChan === kickChannel) ||
              (streamerId && cStreamer === streamerId)
            );
          })
          .map(c => ({ ...c, source: c.source || 'chat' }))
      );

      const twitchClips = sortByDateDesc(cachedEntry.twitch);
      const kickClips = sortByDateDesc(cachedEntry.kick);
      const allClips = sortByDateDesc([...twitchClips, ...kickClips, ...chatClips]);

      return {
        success: true,
        channel: { twitch: twitchChannel, kick: kickChannel },
        twitchClips,
        kickClips,
        chatClips,
        allClips,
        lastUpdated: cachedEntry.lastUpdated,
        fromCache: true
      };
    }

    // Actualizar en paralelo para los canales de esta sesión
    const [rawTwitch, rawKick] = await Promise.all([
      twitchChannel ? this.fetchTwitchClips(twitchChannel, 50, streamerId) : Promise.resolve([]),
      kickChannel ? this.fetchKickClips(kickChannel, 50) : Promise.resolve([])
    ]);

    const twitchClips = sortByDateDesc(rawTwitch);
    const kickClips = sortByDateDesc(rawKick);

    this.streamerCaches.set(cacheKey, {
      twitch: twitchClips,
      kick: kickClips,
      lastUpdated: now
    });

    const allChatClips = storage.getClips() || [];
    const chatClips = sortByDateDesc(
      allChatClips
        .filter(c => {
          const cChan = (c.channel || '').toLowerCase().replace(/^[#@]/, '');
          const cStreamer = (c.streamerId || '').toLowerCase();
          return (
            (twitchChannel && cChan === twitchChannel) ||
            (kickChannel && cChan === kickChannel) ||
            (streamerId && cStreamer === streamerId)
          );
        })
        .map(c => ({ ...c, source: c.source || 'chat' }))
    );

    const allClips = sortByDateDesc([...twitchClips, ...kickClips, ...chatClips]);

    return {
      success: true,
      channel: { twitch: twitchChannel, kick: kickChannel },
      twitchClips,
      kickClips,
      chatClips,
      allClips,
      lastUpdated: now,
      fromCache: false
    };
  }

  /**
   * Crea un clip en vivo de los últimos 30 segundos del stream (Twitch Helix)
   */
  async createLiveClip(platform = 'twitch', channelName = '', requester = 'Viewer', streamerId = null) {
    if (platform === 'twitch') {
      try {
        const config = storage.getConfig();
        const twitchCfg = config.twitch || {};
        const cleanChan = (channelName || twitchCfg.channel || '').toLowerCase().replace(/^#/, '').trim();
        let clientId = twitchCfg.clientId || process.env.TWITCH_CLIENT_ID || 'yw1vr664ichms8an2x5lhji58v7ozk';
        let token = (twitchCfg.oauthToken || process.env.TWITCH_OAUTH_TOKEN || '').replace(/^oauth:/i, '').trim();
        let broadcasterId = (cleanChan === (twitchCfg.channel || '').toLowerCase().replace(/^#/, '').trim()) ? twitchCfg.userId : null;

        // Buscar credenciales en Supabase para el streamer específico si faltan
        if ((!broadcasterId || !token) && storage.supabase) {
          try {
            const searchScopes = [cleanChan, streamerId].filter(Boolean);
            const { data: supaAuth } = await storage.supabase
              .from('orbibot_settings')
              .select('value')
              .in('streamer_id', searchScopes)
              .eq('key', 'twitch_auth')
              .limit(1);
            if (supaAuth && supaAuth.length > 0 && supaAuth[0].value) {
              const v = typeof supaAuth[0].value === 'string' ? JSON.parse(supaAuth[0].value) : supaAuth[0].value;
              if (v.userId) broadcasterId = v.userId;
              if (v.oauthToken) token = v.oauthToken.replace(/^oauth:/i, '').trim();
              if (v.clientId) clientId = v.clientId;
            }
          } catch (e) {}
        }

        // Si falta broadcasterId, resolverlo vía Helix
        if (!broadcasterId && clientId && token) {
          try {
            const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanChan)}`, {
              headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` }
            });
            if (userRes.ok) {
              const uData = await userRes.json();
              if (uData.data && uData.data.length > 0) broadcasterId = uData.data[0].id;
            }
          } catch(e) {}
        }

        if (!broadcasterId || !token) {
          return {
            success: false,
            error: 'no_credentials',
            message: 'No hay credenciales de Twitch vinculadas para crear clips.'
          };
        }

        // Llamar a Twitch Helix POST /helix/clips (captura aproximadamente los últimos 30 segundos del stream)
        const url = `https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&has_delay=false`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Client-Id': clientId,
            'Authorization': `Bearer ${token}`
          }
        });

        const status = res.status;
        const resJson = await res.json().catch(() => ({}));

        if (res.ok && resJson.data && resJson.data.length > 0) {
          const clipItem = resJson.data[0];
          const clipId = clipItem.id;
          const clipUrl = `https://clips.twitch.tv/${clipId}`;
          const editUrl = clipItem.edit_url || clipUrl;

          const newClip = {
            id: 'clip_' + Date.now() + '_' + clipId,
            url: clipUrl,
            editUrl,
            title: `Clip en vivo creado por @${requester}`,
            creator: requester,
            broadcaster: cleanChan,
            platform: 'twitch',
            channel: cleanChan,
            streamerId: streamerId || cleanChan,
            clipId,
            createdAt: Date.now(),
            source: 'live_command'
          };

          // Guardar en la lista de clips
          const clips = storage.getClips();
          clips.unshift(newClip);
          if (clips.length > 100) clips.splice(100);
          storage.saveClips(clips);

          // Si Supabase está conectado, guardar en la nube
          if (storage.supabase) {
            try {
              await storage.supabase.from('orbibot_settings').upsert({
                streamer_id: streamerId || cleanChan,
                key: 'clips',
                value: clips,
                updated_at: new Date().toISOString()
              }, { onConflict: 'streamer_id,key' });
            } catch(e) {}
          }

          return {
            success: true,
            clip: newClip,
            clipUrl,
            editUrl
          };
        }

        // Manejo de errores específicos de Twitch
        if (status === 401 || (resJson.message && resJson.message.includes('clips:edit'))) {
          return {
            success: false,
            error: 'missing_scope',
            message: 'Falta el permiso clips:edit en el token de Twitch. El streamer debe reconectar Twitch en Conexiones.'
          };
        }

        if (status === 404 || status === 400 || (resJson.message && resJson.message.includes('offline'))) {
          return {
            success: false,
            error: 'stream_offline',
            message: 'El stream no está en vivo en este momento para crear un clip.'
          };
        }

        return {
          success: false,
          error: 'twitch_error',
          message: resJson.message || `Error de Twitch (${status}) al crear el clip.`
        };
      } catch (err) {
        console.error('[ClipService] Error en createLiveClip:', err);
        return {
          success: false,
          error: 'internal_error',
          message: err.message
        };
      }
    }

    return {
      success: false,
      error: 'unsupported_platform',
      message: 'Creación instantánea disponible en streams en vivo de Twitch. En Kick usa el botón de tijeras ✂️ del reproductor y escribe !clip <URL>.'
    };
  }

  /**
   * Obtiene un clip aleatorio o el más reciente para responder al comando !clip en el chat
   */
  async getRandomOrLatestClip(platform = 'twitch', channelName = '') {
    const opts = platform === 'kick' ? { kickChannel: channelName } : { twitchChannel: channelName };
    const summary = await this.getClipsSummary(false, opts);
    let list = platform === 'kick' ? summary.kickClips : summary.twitchClips;

    if (!list || list.length === 0) {
      list = summary.allClips;
    }

    if (!list || list.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }
}

module.exports = new ClipService();
