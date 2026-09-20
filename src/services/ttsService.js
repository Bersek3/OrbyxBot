const storage = require('./storage');
const voiceCatalog = require('./voiceCatalog');

class TTSService {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.eventListeners = [];
  }

  onTTS(callback) {
    this.eventListeners.push(callback);
  }

  emitTTS(payload) {
    for (const listener of this.eventListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error dispatching TTS listener:', err);
      }
    }
  }

  normalizeChannelKey(channelOrUser = 'default') {
    const raw = (channelOrUser || 'default').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim() || 'default';
    if (raw === 'default') {
      return storage.getStreamerId() || 'default';
    }
    try {
      const config = storage.getConfig();
      const twitchChan = (config.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
      const kickChan = (config.kick?.channel || config.kick?.username || '').toLowerCase().replace(/^@/, '').trim();
      const streamerId = (storage.getStreamerId() || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();

      if ((twitchChan && raw === twitchChan) || (kickChan && raw === kickChan) || (streamerId && raw === streamerId)) {
        return streamerId || twitchChan || kickChan || 'default';
      }
    } catch(e) {}
    return raw;
  }

  sanitizeText(text, config) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.trim();

    // Limit length
    const maxLength = config.maxLength || 300;
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }

    // Filter banned words
    const banned = config.bannedWords || [];
    for (const word of banned) {
      if (!word.trim()) continue;
      const regex = new RegExp(`\\b${word.trim()}\\b`, 'gi');
      cleaned = cleaned.replace(regex, '***');
    }

    // Clean dangerous characters / script tags
    cleaned = cleaned.replace(/[<>]/g, '');

    return cleaned;
  }

  normalizeVoice(voiceId) {
    const config = storage.getConfig().tts || {};
    const defaultVoice = config.voice || 'es_mx_mia';
    if (!voiceId) return defaultVoice;
    const v = voiceId.toString().toLowerCase().trim().replace(/^[-@/]/, '').replace(/^voice:/, '');

    // 1. Buscar coincidencia en el catálogo activo de la base de datos
    const dbVoice = voiceCatalog.getVoiceById(v);
    if (dbVoice) {
      return dbVoice.id;
    }

    // 2. Buscar en los comandos configurados por el streamer en la base de datos
    const commands = storage.getTtsCommands() || [];
    const matchedCmd = commands.find(c =>
      (c.command && (c.command.toLowerCase() === v || c.command.toLowerCase() === `!${v}`)) ||
      (c.voiceId && c.voiceId.toLowerCase() === v) ||
      (c.name && c.name.toLowerCase() === v)
    );
    if (matchedCmd && matchedCmd.voiceId) {
      return matchedCmd.voiceId;
    }

    // 3. Mapeo de alias comunes que apuntan a voces de la base de datos
    const aliases = {
      // Voces Famosas / IA (Fish Audio)
      messi: 'es_ar_messi',
      lionel_messi: 'es_ar_messi',
      'lionel messi': 'es_ar_messi',
      'leo messi': 'es_ar_messi',
      maduro: 'es_ve_maduro',
      nicolas_maduro: 'es_ve_maduro',
      'nicolas maduro': 'es_ve_maduro',
      tiktok: 'es_tiktok',
      voz_tiktok: 'es_tiktok',
      homero: 'es_mx_homero',
      homero_simpson: 'es_mx_homero',
      homer: 'es_mx_homero',
      dross: 'es_dross',
      drossrotzank: 'es_dross',
      badbunny: 'es_badbunny',
      bad_bunny: 'es_badbunny',
      benito: 'es_badbunny',
      rubius: 'es_rubius',
      elrubius: 'es_rubius',
      el_rubius: 'es_rubius',
      farid: 'es_farid',
      farid_dieck: 'es_farid',
      westcol: 'es_westcol',
      cr7: 'es_cr7',
      cristiano_ronaldo: 'es_cr7',
      ronaldo: 'es_cr7',
      bicho: 'es_cr7',
      goku: 'es_goku',
      goku_latino: 'es_goku',
      maradona: 'es_maradona',
      diego_maradona: 'es_maradona',
      xokas: 'es_xokas',
      elxokas: 'es_xokas',
      illojuan: 'es_illojuan',
      illo_juan: 'es_illojuan',
      auron: 'es_auronplay',
      auronplay: 'es_auronplay',
      peruano: 'es_peruano',
      closs: 'es_marianocloss',
      marianocloss: 'es_marianocloss',
      mariano_closs: 'es_marianocloss',
      lacobra: 'es_lacobra',
      cobra: 'es_lacobra',
      la_cobra: 'es_lacobra',
      davo: 'es_davo',
      davoxeneize: 'es_davo',
      davo_xeneize: 'es_davo',

      // Voces Estándar / Multilingües
      mia: 'es_mx_mia',
      miguel: 'es_us_miguel',
      lupe: 'es_us_lupe',
      penelope: 'es_us_penelope',
      'penélope': 'es_us_penelope',
      enrique: 'es_es_enrique',
      conchita: 'es_es_conchita',
      lucia: 'es_es_lucia',
      'lucía': 'es_es_lucia',
      brian: 'en_brian',
      emma: 'en_emma',
      joey: 'en_joey',
      matthew: 'en_matthew',
      kendra: 'en_kendra',
      justin: 'en_justin',
      russell: 'en_russell',
      cristiano: 'pt_cristiano',
      mathieu: 'fr_mathieu',
      giorgio: 'it_giorgio',
      hans: 'de_hans',
      takumi: 'ja_takumi',
      mizuki: 'ja_mizuki'
    };

    const aliasTarget = aliases[v];
    if (aliasTarget) {
      const aliasVoice = voiceCatalog.getVoiceById(aliasTarget);
      if (aliasVoice) return aliasVoice.id;
    }

    // 4. Si no existe en la base de datos de voces, retornar voz predeterminada
    return defaultVoice;
  }

  isFishAudioVoice(voiceId) {
    const normalized = this.normalizeVoice(voiceId);
    const dbVoice = voiceCatalog.getVoiceById(normalized);
    if (dbVoice && dbVoice.isAI) return true;
    return [
      'es_ar_messi', 'es_ve_maduro', 'es_tiktok', 'es_mx_homero', 'es_dross', 'es_badbunny', 'es_rubius',
      'es_farid', 'es_westcol', 'es_cr7', 'es_goku', 'es_maradona', 'es_xokas', 'es_illojuan', 'es_auronplay',
      'es_peruano', 'es_marianocloss', 'es_lacobra', 'es_davo'
    ].includes(normalized);
  }

  generateAudioUrl(text, voiceId = 'es_mx_mia') {
    const encoded = encodeURIComponent(text);
    const normalized = this.normalizeVoice(voiceId);
    if (this.isFishAudioVoice(normalized)) {
      return `/api/tts/audio?text=${encoded}&voice=${normalized}`;
    }
    const dbVoice = voiceCatalog.getVoiceById(normalized);
    const lang = dbVoice?.lang || (normalized.split('_')[0] || 'es').toLowerCase();
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encoded}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
  }

  /**
   * Valida si un espectador tiene permiso para usar un comando de voz TTS.
   */
  hasPermission(cmdObj, userBadges = {}) {
    if (!cmdObj || !cmdObj.enabled) return false;
    const permissions = Array.isArray(cmdObj.permissions) && cmdObj.permissions.length ? cmdObj.permissions : ['todos'];

    if (permissions.includes('todos') || permissions.includes('all')) return true;

    const isMod = Boolean(userBadges.mod || userBadges.broadcaster || userBadges.isMod);
    const isSub = Boolean(userBadges.subscriber || userBadges.sub || userBadges.isSub || isMod);
    const isVip = Boolean(userBadges.vip || userBadges.isVip || isMod);

    if (permissions.includes('mod') && isMod) return true;
    if (permissions.includes('vip') && (isVip || isMod)) return true;
    if (permissions.includes('sub') && (isSub || isMod)) return true;

    return false;
  }

  /**
   * Parser Multi-Voz en Chat: Detecta comandos de voz individuales o múltiples voces en un mensaje.
   * Ejemplo: "!messi Hola amigos !homero qué onda !dross perturbador"
   */
  parseMultiVoiceText(rawText, userBadges = {}) {
    if (!rawText || typeof rawText !== 'string') return [];
    const commands = storage.getTtsCommands();
    const config = storage.getConfig().tts || {};
    const defaultVoice = config.voice || 'es_mx_mia';

    // Mapeo rápido de prefijos a comandos
    const triggerMap = new Map();
    for (const cmd of commands) {
      if (cmd.enabled !== false && cmd.command) {
        const cleanTrigger = cmd.command.toLowerCase().trim();
        triggerMap.set(cleanTrigger, cmd);
        // Soporte sin signo de exclamación si viene con prefijo
        triggerMap.set(cleanTrigger.replace(/^!/, ''), cmd);
      }
    }

    // Buscar tokens como !comando o [nombre_voz]
    const words = rawText.trim().split(/\s+/);
    const segments = [];
    let currentVoiceCmd = null;
    let currentVoiceId = null;
    let currentVoiceName = null;
    let currentTextWords = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const cleanWord = word.toLowerCase().replace(/^[\[\(]/, '').replace(/[\]\)]$/, '');
      const matchedCmd = triggerMap.get(cleanWord) || triggerMap.get(cleanWord.startsWith('!') ? cleanWord : `!${cleanWord}`);

      if (matchedCmd) {
        // Si ya teníamos texto acumulado, guardar segmento anterior
        if (currentTextWords.length > 0) {
          segments.push({
            voice: currentVoiceId || defaultVoice,
            voiceName: currentVoiceName || (voiceCatalog.getVoiceById(currentVoiceId)?.name || 'Voz'),
            text: currentTextWords.join(' ')
          });
          currentTextWords = [];
        }

        // Validar permisos del nuevo comando
        if (this.hasPermission(matchedCmd, userBadges)) {
          currentVoiceCmd = matchedCmd;
          currentVoiceId = matchedCmd.voiceId || this.normalizeVoice(matchedCmd.command);
          currentVoiceName = matchedCmd.name;
        } else {
          // Si no tiene permiso, usar voz por defecto
          currentVoiceCmd = null;
          currentVoiceId = defaultVoice;
          currentVoiceName = 'Voz Estándar';
        }
      } else {
        currentTextWords.push(word);
      }
    }

    if (currentTextWords.length > 0) {
      segments.push({
        voice: currentVoiceId || defaultVoice,
        voiceName: currentVoiceName || (voiceCatalog.getVoiceById(currentVoiceId)?.name || 'Voz'),
        text: currentTextWords.join(' ')
      });
    }

    return segments;
  }

  processRequest({ user, text, source = 'chat', bits = 0, voiceOverride = null, channel = null, userBadges = {} }) {
    const config = storage.getConfig().tts;
    if (!config.enabled) {
      return { success: false, reason: 'TTS está deshabilitado en la configuración' };
    }

    // Verification for chat commands
    if (source === 'chat' && config.allowChatCommand === false && !voiceOverride) {
      return { success: false, reason: 'El comando de chat para TTS está desactivado' };
    }

    // Verification for bits
    if (source === 'bits' && bits < (config.minBits || 0)) {
      return { success: false, reason: `Bits insuficientes para TTS (mínimo: ${config.minBits})` };
    }

    let rawText = (text || '').trim();
    if (!rawText) {
      return { success: false, reason: 'Texto vacío o inválido' };
    }

    // Strip leading voice command token if present (e.g. "!messi Hola" -> "Hola")
    const commands = storage.getTtsCommands() || [];
    const firstWord = rawText.split(/\s+/)[0].toLowerCase();
    const matchedLeadingCmd = commands.find(c => c.command && (c.command.toLowerCase() === firstWord || c.command.toLowerCase() === `!${firstWord}`));
    if (matchedLeadingCmd) {
      if (!voiceOverride) {
        voiceOverride = matchedLeadingCmd.voiceId;
      }
      const spaceIdx = rawText.indexOf(' ');
      rawText = spaceIdx !== -1 ? rawText.slice(spaceIdx + 1).trim() : '';
    }

    if (!rawText) {
      return { success: false, reason: 'Texto vacío después de procesar comando' };
    }

    let selectedVoice = voiceOverride ? this.normalizeVoice(voiceOverride) : (this.normalizeVoice(config.voice) || 'es_mx_mia');

    // 1. Detección y procesamiento Multi-Voz en chat (solo si no se especificó un voiceOverride directo)
    let multiSegments = [];
    if (!voiceOverride) {
      multiSegments = this.parseMultiVoiceText(rawText, userBadges, selectedVoice);
      if (multiSegments.length > 0) {
        selectedVoice = multiSegments[0].voice || selectedVoice;
      }
    }

    const cleanText = (multiSegments.length > 0)
      ? multiSegments.map(s => this.sanitizeText(s.text, config)).filter(Boolean).join(' ')
      : this.sanitizeText(rawText, config);

    if (!cleanText || cleanText.length < 2) {
      return { success: false, reason: 'Texto vacío o inválido tras sanitización' };
    }

    // Preparar segmentos procesados
    const baseSegments = (multiSegments.length > 0) ? multiSegments : [{ voice: selectedVoice, text: cleanText }];
    const processedSegments = baseSegments
      .map(seg => {
        const cleanSegText = this.sanitizeText(seg.text, config);
        const normVoice = voiceOverride ? selectedVoice : this.normalizeVoice(seg.voice || selectedVoice);
        const isFishSeg = this.isFishAudioVoice(normVoice);
        return {
          voice: normVoice,
          voiceName: seg.voiceName || (voiceCatalog.getVoiceById(normVoice)?.name || 'Voz'),
          text: cleanSegText,
          engine: isFishSeg ? 'fish_audio' : 'audio_stream',
          audioUrl: this.generateAudioUrl(cleanSegText, normVoice)
        };
      })
      .filter(s => s.text && s.text.length > 0);

    if (processedSegments.length === 0) {
      return { success: false, reason: 'No hay texto válido para reproducir' };
    }

    const isFish = this.isFishAudioVoice(selectedVoice);
    const primaryAudioUrl = processedSegments[0]?.audioUrl || this.generateAudioUrl(cleanText, selectedVoice);
    const fallbackUrl = isFish
      ? `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=es-ES&client=tw-ob`
      : primaryAudioUrl;

    const cleanChannel = this.normalizeChannelKey(channel);
    const ttsItem = {
      id: 'tts-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      channel: cleanChannel,
      room: cleanChannel,
      user: user || 'Anónimo',
      text: cleanText,
      source,
      bits,
      engine: isFish ? 'fish_audio' : 'audio_stream',
      voice: selectedVoice,
      segments: processedSegments,
      volume: (config.volume || 90) / 100,
      rate: config.rate || 1.0,
      pitch: config.pitch || 1.0,
      audioUrl: primaryAudioUrl,
      fallbackUrl,
      timestamp: Date.now()
    };

    this.queue.push(ttsItem);
    this.emitTTS(ttsItem);
    this.emitQueueUpdate(cleanChannel);

    return {
      success: true,
      item: ttsItem
    };
  }

  onTTSControl(callback) {
    if (typeof callback === 'function') {
      if (!this.controlListeners) this.controlListeners = [];
      this.controlListeners.push(callback);
    }
  }

  emitTTSControl(payload) {
    if (!this.controlListeners) this.controlListeners = [];
    for (const listener of this.controlListeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error dispatching TTS control listener:', err);
      }
    }
  }

  emitQueueUpdate(channel = null) {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    this.emitTTSControl({
      action: 'queue_update',
      channel: key || channel,
      room: key || channel,
      queue: this.getQueueState(key || channel)
    });
  }

  getQueueState(channel = null) {
    if (channel && channel !== 'default') {
      const clean = this.normalizeChannelKey(channel);
      const raw = channel.toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
      return this.queue.filter(q => {
        if (!q.channel || q.channel === 'default') return true;
        const qNorm = this.normalizeChannelKey(q.channel);
        const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
        return qNorm === clean || qRaw === raw || qRaw === clean || qNorm === raw;
      });
    }
    return this.queue;
  }

  stopTTS(channel = null, user = 'Moderador') {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    const payload = { action: 'stop', channel: key || channel, room: key || channel, user, timestamp: Date.now() };
    this.emitTTSControl(payload);
    return { success: true, message: 'TTS detenido' };
  }

  skipTTS(channel = null, user = 'Moderador') {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    const raw = channel ? channel.toLowerCase().replace(/^#/, '').replace(/^@/, '').trim() : null;
    if (key && key !== 'default') {
      const idx = this.queue.findIndex(q => {
        if (!q.channel || q.channel === 'default') return true;
        const qNorm = this.normalizeChannelKey(q.channel);
        const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
        return qNorm === key || qRaw === raw || qRaw === key || qNorm === raw;
      });
      if (idx >= 0) {
        this.queue.splice(idx, 1);
      }
    } else if (this.queue.length > 0) {
      this.queue.shift();
    }
    const currentQueue = this.getQueueState(key || channel);
    const payload = { action: 'skip', channel: key || channel, room: key || channel, user, timestamp: Date.now(), queue: currentQueue };
    this.emitTTSControl(payload);
    return { success: true, message: 'TTS saltado' };
  }

  resetTTS(channel = null, user = 'Moderador') {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    const raw = channel ? channel.toLowerCase().replace(/^#/, '').replace(/^@/, '').trim() : null;
    if (key && key !== 'default') {
      this.queue = this.queue.filter(q => {
        if (!q.channel || q.channel === 'default') return false;
        const qNorm = this.normalizeChannelKey(q.channel);
        const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
        return !(qNorm === key || qRaw === raw || qRaw === key || qNorm === raw);
      });
    } else {
      this.queue = [];
    }
    const payload = { action: 'reset', channel: key || channel, room: key || channel, user, timestamp: Date.now(), queue: [] };
    this.emitTTSControl(payload);
    return { success: true, message: 'Cola de TTS reiniciada' };
  }

  clearQueue(channel = null, user = 'Moderador') {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    const raw = channel ? channel.toLowerCase().replace(/^#/, '').replace(/^@/, '').trim() : null;
    if (key && key !== 'default') {
      this.queue = this.queue.filter(q => {
        if (!q.channel || q.channel === 'default') return false;
        const qNorm = this.normalizeChannelKey(q.channel);
        const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
        return !(qNorm === key || qRaw === raw || qRaw === key || qNorm === raw);
      });
    } else {
      this.queue = [];
    }
    const payload = { action: 'clear', channel: key || channel, room: key || channel, user, timestamp: Date.now(), queue: [] };
    this.emitTTSControl(payload);
    return { success: true, message: 'Cola de TTS limpiada' };
  }

  removeItem(id, channel = null) {
    if (!id) return { success: false };
    const key = channel ? this.normalizeChannelKey(channel) : null;
    this.queue = this.queue.filter(item => item.id !== id);
    const currentQueue = this.getQueueState(key || channel);
    const payload = { action: 'item_removed', id, channel: key || channel, room: key || channel, queue: currentQueue };
    this.emitTTSControl(payload);
    return { success: true, queue: currentQueue };
  }

  finishItem(id, channel = null) {
    const key = channel ? this.normalizeChannelKey(channel) : null;
    const raw = channel ? channel.toLowerCase().replace(/^#/, '').replace(/^@/, '').trim() : null;

    if (id) {
      const idx = this.queue.findIndex(item => item.id === id);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
      } else if (key && key !== 'default') {
        const chanIdx = this.queue.findIndex(q => {
          if (!q.channel || q.channel === 'default') return true;
          const qNorm = this.normalizeChannelKey(q.channel);
          const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
          return qNorm === key || qRaw === raw || qRaw === key || qNorm === raw;
        });
        if (chanIdx !== -1) this.queue.splice(chanIdx, 1);
      } else if (this.queue.length > 0) {
        this.queue.shift();
      }
    } else {
      if (key && key !== 'default') {
        const chanIdx = this.queue.findIndex(q => {
          if (!q.channel || q.channel === 'default') return true;
          const qNorm = this.normalizeChannelKey(q.channel);
          const qRaw = (q.channel || '').toLowerCase().replace(/^#/, '').replace(/^@/, '').trim();
          return qNorm === key || qRaw === raw || qRaw === key || qNorm === raw;
        });
        if (chanIdx !== -1) this.queue.splice(chanIdx, 1);
      } else if (this.queue.length > 0) {
        this.queue.shift();
      }
    }

    const currentQueue = this.getQueueState(key || channel);
    const payload = { action: 'finish', id, channel: key || channel, room: key || channel, queue: currentQueue, timestamp: Date.now() };
    this.emitTTSControl(payload);
    return { success: true, queue: currentQueue };
  }

  getVoices() {
    return voiceCatalog.getAllVoices();
  }
}

module.exports = new TTSService();
