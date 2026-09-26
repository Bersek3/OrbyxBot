const storage = require('./storage');

class ClipService {
  constructor() {
    this.cache = {
      twitch: [],
      kick: [],
      lastUpdated: 0
    };
    this.cacheTtlMs = 3 * 60 * 1000; // 3 minutos de caché en memoria
    this.isFetching = false;
  }

  /**
   * Obtiene los clips de Twitch directamente de la API Helix para el canal configurado
   */
  async fetchTwitchClips(limit = 50) {
    try {
      const config = storage.getConfig();
      const twitchCfg = config.twitch || {};
      const channelName = (twitchCfg.channel || '').toLowerCase().replace(/^#/, '').trim();
      const clientId = twitchCfg.clientId;
      const token = (twitchCfg.oauthToken || '').replace(/^oauth:/i, '').trim();

      if (!channelName) return [];

      let broadcasterId = twitchCfg.userId;

      // Si no tenemos userId, lo resolvemos con el login del canal
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
              // Guardar para futuros usos
              twitchCfg.userId = broadcasterId;
              const fullCfg = storage.getConfig();
              fullCfg.twitch = { ...fullCfg.twitch, userId: broadcasterId };
              storage.saveConfig(fullCfg);
            }
          }
        } catch (e) {
          console.warn('[ClipService] Error al resolver broadcasterId de Twitch:', e.message);
        }
      }

      if (!broadcasterId || !clientId || !token) {
        return [];
      }

      const clipsRes = await fetch(
        `https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}&first=${limit}`,
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

      return rawClips.map(c => ({
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
      })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
      console.error('[ClipService] Error al obtener clips de Twitch:', err.message);
      return [];
    }
  }

  /**
   * Obtiene los clips de Kick directamente de la API pública de Kick para el canal configurado
   */
  async fetchKickClips(limit = 50) {
    try {
      const config = storage.getConfig();
      const kickCfg = config.kick || {};
      const channelName = (kickCfg.channel || kickCfg.username || '').toLowerCase().replace(/^@/, '').trim();

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

      return rawClips.slice(0, limit).map(c => ({
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
      })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch (err) {
      console.warn('[ClipService] Error al obtener clips de Kick:', err.message);
      return [];
    }
  }

  /**
   * Obtiene todos los clips del canal (Twitch + Kick) combinados con los guardados manualmente por chat
   */
  async getClipsSummary(forceRefresh = false) {
    const now = Date.now();
    const config = storage.getConfig();
    const twitchChannel = (config.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
    const kickChannel = (config.kick?.channel || config.kick?.username || '').toLowerCase().replace(/^@/, '').trim();

    const sortByDateDesc = (arr) => {
      return [...(arr || [])].sort((a, b) => {
        const tA = Number(a.createdAt) || (a.created_at ? new Date(a.created_at).getTime() : 0);
        const tB = Number(b.createdAt) || (b.created_at ? new Date(b.created_at).getTime() : 0);
        return tB - tA;
      });
    };

    // Usar caché si aún está fresca
    if (!forceRefresh && (now - this.cache.lastUpdated < this.cacheTtlMs) && (this.cache.twitch.length > 0 || this.cache.kick.length > 0)) {
      const chatClips = sortByDateDesc((storage.getClips() || []).map(c => ({ ...c, source: c.source || 'chat' })));
      const twitchClips = sortByDateDesc(this.cache.twitch);
      const kickClips = sortByDateDesc(this.cache.kick);
      const allClips = sortByDateDesc([...twitchClips, ...kickClips, ...chatClips]);

      return {
        success: true,
        channel: { twitch: twitchChannel, kick: kickChannel },
        twitchClips,
        kickClips,
        chatClips,
        allClips,
        lastUpdated: this.cache.lastUpdated,
        fromCache: true
      };
    }

    // Actualizar en paralelo
    const [rawTwitch, rawKick] = await Promise.all([
      this.fetchTwitchClips(50),
      this.fetchKickClips(50)
    ]);

    const twitchClips = sortByDateDesc(rawTwitch);
    const kickClips = sortByDateDesc(rawKick);
    this.cache.twitch = twitchClips;
    this.cache.kick = kickClips;
    this.cache.lastUpdated = now;

    const chatClips = sortByDateDesc((storage.getClips() || []).map(c => ({ ...c, source: c.source || 'chat' })));
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
   * Obtiene un clip aleatorio o el más reciente para responder al comando !clip en el chat
   */
  async getRandomOrLatestClip(platform = 'twitch') {
    const summary = await this.getClipsSummary(false);
    let list = platform === 'kick' ? summary.kickClips : summary.twitchClips;

    // Si la plataforma pedida no tiene clips del canal, probar con la otra o con chatClips
    if (!list || list.length === 0) {
      list = summary.allClips;
    }

    if (!list || list.length === 0) return null;

    // Seleccionar aleatoriamente entre los mejores o más recientes
    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }
}

module.exports = new ClipService();
