require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { MongoClient } = require('mongodb');
const voiceCatalog = require('./voiceCatalog');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function generateWidgetToken() {
  return 'sec_' + crypto.randomBytes(16).toString('hex');
}

const DEFAULT_CONFIG = {
  security: {
    widgetToken: generateWidgetToken()
  },
  twitch: {
    channel: '',
    botUsername: '',
    oauthToken: '',
    clientId: 'yw1vr664ichms8an2x5lhji58v7ozk',
    connected: false
  },
  kick: {
    channel: '',
    username: '',
    profile_picture: '',
    userId: '',
    accessToken: '',
    refreshToken: '',
    clientId: process.env.KICK_CLIENT_ID || '01M0VT0JC58YQEVGRHM8JFXQX3',
    connected: false
  },
  chatPlatforms: {
    twitch: true,
    kick: true
  },
  songRequest: {
    prefix: '!sr',
    enabled: true,
    maxDurationMinutes: 8,
    maxPerUser: 5,
    userLevel: 'all', // all, subs, mod
    volume: 75,
    autoplay: true
  },
  tts: {
    enabled: true,
    engine: 'streamelements', // 'streamelements', 'webspeech', 'google'
    voice: 'es_mx_mia',
    volume: 90,
    rate: 1.0,
    pitch: 1.0,
    minBits: 50,
    allowChatCommand: true,
    chatCommand: '!tts',
    bannedWords: ['nazi', 'hitler', 'racismo', 'tonto'],
    maxLength: 250,
    channelPointsRewardName: 'TTS',
    fishApiKey: 'sk-fish-rOpXPwPZLXZAk5SPYaeSKBue6QfPM3l4i6Q3VG8ZbGI'
  },
  goals: []
};

const DEFAULT_COMMANDS = [];

const DEFAULT_TTS_COMMANDS = [
  {
    id: 'tts_cmd_auron',
    voiceId: 'es_auronplay',
    name: 'Auronplay',
    command: '!auron',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_peruano',
    voiceId: 'es_peruano',
    name: 'Peruano',
    command: '!peruano',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_closs',
    voiceId: 'es_marianocloss',
    name: 'Mariano Closs',
    command: '!closs',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_lacobra',
    voiceId: 'es_lacobra',
    name: 'La Cobra',
    command: '!lacobra',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_davo',
    voiceId: 'es_davo',
    name: 'Davo Xeneize',
    command: '!davo',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_farid',
    voiceId: 'es_farid',
    name: 'Farid Dieck',
    command: '!farid',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_westcol',
    voiceId: 'es_westcol',
    name: 'WestCol',
    command: '!westcol',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_cr7',
    voiceId: 'es_cr7',
    name: 'Cristiano Ronaldo',
    command: '!cr7',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_goku',
    voiceId: 'es_goku',
    name: 'Goku (Latino)',
    command: '!goku',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_xokas',
    voiceId: 'es_xokas',
    name: 'El Xokas',
    command: '!xokas',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_illojuan',
    voiceId: 'es_illojuan',
    name: 'IlloJuan',
    command: '!illojuan',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_maradona',
    voiceId: 'es_maradona',
    name: 'Diego Maradona',
    command: '!maradona',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.0
  },
  {
    id: 'tts_cmd_messi',
    voiceId: 'es_ar_messi',
    name: 'Lionel Messi',
    command: '!messi',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.98,
    pitch: 0.78
  },
  {
    id: 'tts_cmd_homero',
    voiceId: 'es_mx_homero',
    name: 'Homero Simpson',
    command: '!homero',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.92,
    pitch: 0.85
  },
  {
    id: 'tts_cmd_dross',
    voiceId: 'es_dross',
    name: 'Dross Rotzank',
    command: '!dross',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.95,
    pitch: 0.7
  },
  {
    id: 'tts_cmd_badbunny',
    voiceId: 'es_badbunny',
    name: 'Bad Bunny',
    command: '!badbunny',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.95,
    pitch: 0.75
  },
  {
    id: 'tts_cmd_rubius',
    voiceId: 'es_rubius',
    name: 'ElRubius',
    command: '!rubius',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.05,
    pitch: 1.05
  },
  {
    id: 'tts_cmd_maduro',
    voiceId: 'es_ve_maduro',
    name: 'Nicolás Maduro',
    command: '!maduro',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.95,
    pitch: 0.72
  },
  {
    id: 'tts_cmd_tiktok',
    voiceId: 'es_tiktok',
    name: 'Voz TikTok',
    command: '!tiktok',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.05,
    pitch: 1.2
  },
  {
    id: 'tts_cmd_mia',
    voiceId: 'es_mx_mia',
    name: 'Mia (Español Latino)',
    command: '!mia',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 1.0,
    pitch: 1.15
  },
  {
    id: 'tts_cmd_brian',
    voiceId: 'en_brian',
    name: 'Brian (English Classic)',
    command: '!brian',
    permissions: ['todos'],
    enabled: true,
    volume: 90,
    rate: 0.95,
    pitch: 0.7
  }
];

const DEFAULT_ALERTS = {
  follower: {
    enabled: true,
    title: 'Nuevo Seguidor',
    message: '¡{user} ahora sigue el canal!',
    sound: '/assets/sounds/campana_alerta.wav',
    duration: 6,
    image: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWk1YW0yZXpxM3c2NHJreGQxbDduMWVvb3hpZGl2dHVqMm1pMG1jYyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/artj92V8o75VPL7AeQ/giphy.gif',
    textColor: '#ffffff',
    accentColor: '#00f2fe'
  },
  sub: {
    enabled: true,
    title: '¡Nueva Suscripción!',
    message: '¡{user} se ha suscrito al canal! (Nivel {tier})',
    sound: '/assets/sounds/campana_alerta.wav',
    duration: 7,
    image: 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif',
    textColor: '#ffffff',
    accentColor: '#9146ff'
  },
  bits: {
    enabled: true,
    title: 'Donación de Bits',
    message: '¡{user} ha donado {amount} bits! {message}',
    sound: '/assets/sounds/notificacion_puntos.wav',
    duration: 7,
    image: 'https://media.giphy.com/media/26FPJGjhefSJuaRhu/giphy.gif',
    textColor: '#ffffff',
    accentColor: '#f5a623'
  },
  raid: {
    enabled: true,
    title: '¡Raid Entrante!',
    message: '¡{user} lidera una raid con {viewers} espectadores!',
    sound: '/assets/sounds/airhorn.mp3',
    duration: 8,
    image: 'https://media.giphy.com/media/l41lI4bYmcsPJX9Go/giphy.gif',
    textColor: '#ffffff',
    accentColor: '#ff007f'
  },
  channel_points: {
    enabled: true,
    title: 'Puntos de Canal',
    message: '¡{user} ha canjeado {reward}!',
    sound: '/assets/sounds/notificacion_puntos.wav',
    duration: 6,
    image: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
    textColor: '#ffffff',
    accentColor: '#10b981'
  }
};

const DEFAULT_REWARDS = [];

function readJSON(filename, defaultValue) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultValue;
  }
}

function writeJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
    return false;
  }
}

class StorageService {
  constructor() {
    this.supabase = null;
    this.isSupabaseReady = false;

    this.mongoClient = null;
    this.mongoDb = null;
    this.isMongoReady = false;

    this._streamerId = null; // Cache del streamer_id activo
    this.restoreAllMediaFiles();
    
    // Inicializar ambas bases de datos para Doble Respaldo
    this.initSupabase();
    this.initMongoDB();

    // Inicializar y sincronizar catálogo de voces desde código y base de datos
    this.initVoiceCatalog();

    // Iniciar sistema Heartbeat Keep-Alive Anti-Pausa 24/7
    this.startDatabaseKeepAliveHeartbeat();
  }

  /**
   * Inicializa y sincroniza el catálogo general de voces.
   * Auto-registra cualquier voz añadida en el código fuente (voiceCatalog.js)
   * hacia la base de datos y la caché local.
   */
  initVoiceCatalog() {
    try {
      const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
      const validCodeIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
      const localCatalog = readJSON('voice_catalog.json', []);
      const catalogMap = new Map();

      // 1. Inicializar con todas las voces definidas en el código
      for (const v of codeVoices) {
        if (v && v.id) {
          catalogMap.set(v.id.toLowerCase(), { ...v });
        }
      }

      // 2. Fusionar personalizaciones solo si la voz existe en el código
      if (Array.isArray(localCatalog)) {
        for (const v of localCatalog) {
          if (v && v.id && validCodeIds.has(v.id.toLowerCase())) {
            const current = catalogMap.get(v.id.toLowerCase());
            catalogMap.set(v.id.toLowerCase(), { ...current, ...v });
          }
        }
      }

      const merged = Array.from(catalogMap.values());
      writeJSON('voice_catalog.json', merged);
      if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
        voiceCatalog.setVoices(merged);
      }

      // Sincronizar catálogo depurado con Supabase y MongoDB
      setTimeout(() => {
        this.syncToCloud('voice_catalog', merged).catch(() => {});
      }, 1000);

      return merged;
    } catch (err) {
      console.warn('⚠️ [Storage] Error al inicializar catálogo de voces:', err.message);
      return (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
    }
  }

  /**
   * Restaura todos los archivos multimedia (audios e imágenes) en disco.
   */
  restoreAllMediaFiles() {
    try {
      this.restoreAudioFiles(this.getCustomSounds());
      this.restoreImageFiles(this.getCustomImages());
      this.restoreMediaFromAlertsAndRewards();
    } catch (e) {
      console.warn('⚠️ [Storage] Error al restaurar archivos multimedia:', e.message);
    }
  }

  /**
   * Restaura archivos físicos de audio en public/assets/sounds/custom/
   * si están guardados en base64 dentro de custom_sounds.json o en la nube.
   */
  restoreAudioFiles(sounds) {
    if (!Array.isArray(sounds) || sounds.length === 0) return;
    const publicCustomDir = path.join(__dirname, '..', '..', 'public', 'assets', 'sounds', 'custom');
    const docsCustomDir = path.join(__dirname, '..', '..', 'docs', 'assets', 'sounds', 'custom');

    try {
      if (!fs.existsSync(publicCustomDir)) fs.mkdirSync(publicCustomDir, { recursive: true });
      if (fs.existsSync(path.join(__dirname, '..', '..', 'docs')) && !fs.existsSync(docsCustomDir)) {
        fs.mkdirSync(docsCustomDir, { recursive: true });
      }

      sounds.forEach(s => {
        if (!s || !s.name) return;
        const cleanName = path.basename(s.name).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const rawData = s.data || s.dataUrl;
        if (rawData && typeof rawData === 'string' && (rawData.includes(';base64,') || rawData.startsWith('data:'))) {
          const base64Data = rawData.replace(/^data:[^;]+;base64,/, '');
          try {
            const buffer = Buffer.from(base64Data, 'base64');
            const targetPublic = path.join(publicCustomDir, cleanName);
            if (!fs.existsSync(targetPublic) || fs.statSync(targetPublic).size === 0) {
              fs.writeFileSync(targetPublic, buffer);
              console.log(`🔊 [Storage] Audio restaurado en disco: ${cleanName}`);
            }
            if (fs.existsSync(path.join(__dirname, '..', '..', 'docs'))) {
              const targetDocs = path.join(docsCustomDir, cleanName);
              if (!fs.existsSync(targetDocs) || fs.statSync(targetDocs).size === 0) {
                fs.writeFileSync(targetDocs, buffer);
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Storage] Error al restaurar audio ${cleanName}:`, e.message);
          }
        }
      });
    } catch (err) {
      console.warn('⚠️ [Storage] Error en restoreAudioFiles:', err.message);
    }
  }

  /**
   * Restaura archivos físicos de imagen en public/assets/images/custom/
   */
  restoreImageFiles(images) {
    if (!Array.isArray(images) || images.length === 0) return;
    const publicCustomDir = path.join(__dirname, '..', '..', 'public', 'assets', 'images', 'custom');
    const docsCustomDir = path.join(__dirname, '..', '..', 'docs', 'assets', 'images', 'custom');

    try {
      if (!fs.existsSync(publicCustomDir)) fs.mkdirSync(publicCustomDir, { recursive: true });
      if (fs.existsSync(path.join(__dirname, '..', '..', 'docs')) && !fs.existsSync(docsCustomDir)) {
        fs.mkdirSync(docsCustomDir, { recursive: true });
      }

      images.forEach(img => {
        if (!img || !img.name) return;
        const cleanName = path.basename(img.name).replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
        const rawData = img.data || img.dataUrl;
        if (rawData && typeof rawData === 'string' && (rawData.includes(';base64,') || rawData.startsWith('data:'))) {
          const base64Data = rawData.replace(/^data:[^;]+;base64,/, '');
          try {
            const buffer = Buffer.from(base64Data, 'base64');
            const targetPublic = path.join(publicCustomDir, cleanName);
            if (!fs.existsSync(targetPublic) || fs.statSync(targetPublic).size === 0) {
              fs.writeFileSync(targetPublic, buffer);
              console.log(`🖼️ [Storage] Imagen restaurada en disco: ${cleanName}`);
            }
            if (fs.existsSync(path.join(__dirname, '..', '..', 'docs'))) {
              const targetDocs = path.join(docsCustomDir, cleanName);
              if (!fs.existsSync(targetDocs) || fs.statSync(targetDocs).size === 0) {
                fs.writeFileSync(targetDocs, buffer);
              }
            }
          } catch (e) {
            console.warn(`⚠️ [Storage] Error al restaurar imagen ${cleanName}:`, e.message);
          }
        }
      });
    } catch (err) {
      console.warn('⚠️ [Storage] Error en restoreImageFiles:', err.message);
    }
  }

  /**
   * Extrae y restaura cualquier archivo con data base64 presente en alerts, rewards o widgetStyles
   */
  restoreMediaFromAlertsAndRewards() {
    try {
      // 1. Desde rewards (puntos de canal)
      const rewards = this.getRewards();
      if (Array.isArray(rewards)) {
        rewards.forEach(r => {
          if (r && r.soundUrl && typeof r.soundUrl === 'string' && r.soundUrl.startsWith('data:audio/')) {
            const safeName = `reward_${r.id || 'snd'}.mp3`;
            this.restoreAudioFiles([{ name: safeName, dataUrl: r.soundUrl }]);
          }
        });
      }

      // 2. Desde alerts
      const alerts = this.getAlerts();
      if (alerts && typeof alerts === 'object') {
        Object.keys(alerts).forEach(k => {
          const item = alerts[k];
          if (item && item.sound && typeof item.sound === 'string' && item.sound.startsWith('data:audio/')) {
            const safeName = `alert_${k}.mp3`;
            this.restoreAudioFiles([{ name: safeName, dataUrl: item.sound }]);
          }
          if (item && item.image && typeof item.image === 'string' && item.image.startsWith('data:image/')) {
            const safeName = `alert_${k}.gif`;
            this.restoreImageFiles([{ name: safeName, dataUrl: item.image }]);
          }
        });
      }
    } catch (e) { }
  }

  /**
   * Obtiene el streamer_id actual basándose en el canal de Twitch configurado.
   */
  getStreamerId() {
    if (this._streamerId) return this._streamerId;
    try {
      const cfg = readJSON('config.json', DEFAULT_CONFIG);
      const twitchChan = (cfg.twitch && cfg.twitch.channel) ? cfg.twitch.channel.toLowerCase().replace(/^#/, '').trim() : '';
      if (twitchChan) return twitchChan;
      const kickChan = (cfg.kick && (cfg.kick.channel || cfg.kick.username)) ? (cfg.kick.channel || cfg.kick.username).toLowerCase().replace(/^@/, '').trim() : '';
      return kickChan || 'default';
    } catch (e) {
      return 'default';
    }
  }

  /**
   * Establece el streamer_id manualmente (al autenticar con Twitch).
   */
  setStreamerId(id) {
    const cleanId = (id || 'default').toLowerCase().replace(/^#/, '').trim();
    this._streamerId = cleanId || 'default';
    console.log(`🔑 [Storage] Streamer ID activo: "${this._streamerId}"`);
  }

  // ================= 🟢 BASE DE DATOS 1: SUPABASE =================
  initSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey, {
          auth: { persistSession: false }
        });
        console.log('🟢 [Supabase Cloud] Cliente inicializado correctamente.');
        this.syncFromSupabase();
      } catch (err) {
        console.warn('⚠️ [Supabase Cloud] Error al inicializar cliente:', err.message);
      }
    } else {
      console.log('ℹ️ [Storage] Supabase no configurado en .env.');
    }
  }

  async syncFromSupabase() {
    if (!this.supabase) return;
    const streamerId = this.getStreamerId();
    try {
      const { data, error } = await this.supabase
        .from('orbibot_settings')
        .select('*')
        .eq('streamer_id', streamerId);

      if (error) {
        if (error.message && error.message.includes('streamer_id')) {
          return this.syncFromSupabaseLegacy();
        }
        console.warn('⚠️ [Supabase] Error al sincronizar:', error.message);
        return;
      }

      if (data && data.length > 0) {
        this.isSupabaseReady = true;
        console.log(`✅ [Supabase Cloud] ${data.length} configuraciones sincronizadas para streamer "${streamerId}".`);
        data.forEach(item => {
          if (item.key === 'config') writeJSON('config.json', item.value);
          if (item.key === 'commands') writeJSON('commands.json', item.value);
          if (item.key === 'tts_commands') writeJSON('tts_commands.json', item.value);
          if (item.key === 'alerts') writeJSON('alerts.json', item.value);
          if (item.key === 'channel_points') writeJSON('channel_points.json', item.value);
          if (item.key === 'goals') writeJSON('goals.json', item.value);
          if (item.key === 'custom_sounds') {
            writeJSON('custom_sounds.json', item.value);
          }
          if (item.key === 'custom_images') {
            writeJSON('custom_images.json', item.value);
          }
          if (item.key === 'tts_commands' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validVoiceIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanCmds = item.value.filter(c => c && c.voiceId && validVoiceIds.has(c.voiceId.toLowerCase())).map(c => ({
              id: c.id, voiceId: c.voiceId, name: c.name, command: c.command,
              permissions: c.permissions || ['todos'], enabled: c.enabled !== false,
              volume: c.volume || 90, rate: c.rate || 1.0, pitch: c.pitch || 1.0
            }));
            const finalCmds = cleanCmds.length > 0 ? cleanCmds : DEFAULT_TTS_COMMANDS;
            writeJSON('tts_commands.json', finalCmds);
          }
          if (item.key === 'voice_catalog' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validCodeIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanVoices = item.value.filter(v => v && v.id && validCodeIds.has(v.id.toLowerCase())).map(v => {
              const { avatar, ...rest } = v;
              return rest;
            });
            const finalVoices = cleanVoices.length > 0 ? cleanVoices : codeVoices;
            writeJSON('voice_catalog.json', finalVoices);
            if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
              voiceCatalog.setVoices(finalVoices);
            }
          }
        });
        this.restoreAllMediaFiles();
      } else {
        this.isSupabaseReady = true;
        console.log(`ℹ️ [Supabase Cloud] Streamer "${streamerId}" sin configuraciones previas en la nube.`);
      }
    } catch (err) {
      console.warn('⚠️ [Supabase] Error durante la sincronización inicial:', err.message);
    }
  }

  async syncFromSupabaseLegacy() {
    if (!this.supabase) return;
    try {
      const { data, error } = await this.supabase.from('orbibot_settings').select('*');
      if (!error && data && data.length > 0) {
        this.isSupabaseReady = true;
        data.forEach(item => {
          if (item.key === 'config') writeJSON('config.json', item.value);
          if (item.key === 'commands') writeJSON('commands.json', item.value);
          if (item.key === 'tts_commands' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validVoiceIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanCmds = item.value.filter(c => c && c.voiceId && validVoiceIds.has(c.voiceId.toLowerCase())).map(c => ({
              id: c.id, voiceId: c.voiceId, name: c.name, command: c.command,
              permissions: c.permissions || ['todos'], enabled: c.enabled !== false,
              volume: c.volume || 90, rate: c.rate || 1.0, pitch: c.pitch || 1.0
            }));
            const finalCmds = cleanCmds.length > 0 ? cleanCmds : DEFAULT_TTS_COMMANDS;
            writeJSON('tts_commands.json', finalCmds);
          }
          if (item.key === 'alerts') writeJSON('alerts.json', item.value);
          if (item.key === 'channel_points') writeJSON('channel_points.json', item.value);
          if (item.key === 'goals') writeJSON('goals.json', item.value);
          if (item.key === 'custom_sounds') {
            writeJSON('custom_sounds.json', item.value);
          }
          if (item.key === 'custom_images') {
            writeJSON('custom_images.json', item.value);
          }
          if (item.key === 'voice_catalog' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validCodeIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanVoices = item.value.filter(v => v && v.id && validCodeIds.has(v.id.toLowerCase())).map(v => {
              const { avatar, ...rest } = v;
              return rest;
            });
            const finalVoices = cleanVoices.length > 0 ? cleanVoices : codeVoices;
            writeJSON('voice_catalog.json', finalVoices);
            if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
              voiceCatalog.setVoices(finalVoices);
            }
          }
        });
        this.restoreAllMediaFiles();
      }
    } catch (err) { }
  }

  async migrateFromDefaultSupabase(newStreamerId) {
    // DESACTIVADO POR SEGURIDAD: Nunca heredar datos de 'default' entre streamers
    return false;
  }

  async syncToSupabase(key, value) {
    if (!this.supabase) return;
    const streamerId = this.getStreamerId();
    const scopes = new Set(
      key === 'voice_catalog'
        ? ['system', 'default', streamerId].filter(Boolean)
        : [streamerId].filter(s => s && s !== 'default')
    );
    for (const scopeId of scopes) {
      try {
        const { error } = await this.supabase
          .from('orbibot_settings')
          .upsert({
            streamer_id: scopeId,
            key,
            value,
            updated_at: new Date().toISOString()
          }, { onConflict: 'streamer_id,key' });

        if (error) {
          if (error.message && error.message.includes('streamer_id')) {
            await this.supabase.from('orbibot_settings').upsert({
              key,
              value,
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
          }
        } else {
          this.isSupabaseReady = true;
        }
      } catch (err) { }
    }
  }

  // ================= 🍃 BASE DE DATOS 2: MONGODB ATLAS =================
  initMongoDB() {
    let mongoUri = process.env.MONGODB_URI || 'mongodb+srv://Berserk:Bersek%401106%403200@servidor.krd1u.mongodb.net/orbibot?retryWrites=true&w=majority';

    // Formatear correctamente contraseñas con caracteres especiales como @
    if (mongoUri.includes('@') && !mongoUri.includes('%40')) {
      const match = mongoUri.match(/^(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@(.*)$/);
      if (match) {
        mongoUri = `${match[1]}${match[2]}:${encodeURIComponent(match[3])}@${match[4]}`;
      }
    }

    try {
      this.mongoClient = new MongoClient(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 8000
      });

      this.mongoClient.connect().then(async () => {
        this.mongoDb = this.mongoClient.db('orbibot');
        this.isMongoReady = true;
        console.log('🍃 [MongoDB Cloud] Base de datos conectada correctamente (Doble Respaldo Activo).');

        try {
          await this.mongoDb.collection('settings').createIndex({ streamer_id: 1, key: 1 }, { unique: true });
          await this.mongoDb.collection('users').createIndex({ email: 1 }, { unique: true });
        } catch (e) { }

        // Sincronizar desde MongoDB
        this.syncFromMongoDB();
      }).catch(err => {
        console.warn('⚠️ [MongoDB Cloud] No se pudo conectar a MongoDB:', err.message);
        this.isMongoReady = false;
      });
    } catch (err) {
      console.warn('⚠️ [MongoDB Cloud] Error de inicialización:', err.message);
      this.isMongoReady = false;
    }
  }

  async syncFromMongoDB() {
    if (!this.isMongoReady || !this.mongoDb) return;
    const streamerId = this.getStreamerId();
    try {
      const records = await this.mongoDb.collection('settings')
        .find({ streamer_id: { $in: [streamerId, 'system', 'default'] } })
        .toArray();

      if (records && records.length > 0) {
        console.log(`✅ [MongoDB Cloud] ${records.length} configuraciones sincronizadas para streamer "${streamerId}".`);
        records.forEach(item => {
          if (item.key === 'config') writeJSON('config.json', item.value);
          if (item.key === 'commands') writeJSON('commands.json', item.value);
          if (item.key === 'alerts') writeJSON('alerts.json', item.value);
          if (item.key === 'channel_points') writeJSON('channel_points.json', item.value);
          if (item.key === 'goals') writeJSON('goals.json', item.value);
          if (item.key === 'tts_commands' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validVoiceIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanCmds = item.value.filter(c => c && c.voiceId && validVoiceIds.has(c.voiceId.toLowerCase())).map(c => ({
              id: c.id, voiceId: c.voiceId, name: c.name, command: c.command,
              permissions: c.permissions || ['todos'], enabled: c.enabled !== false,
              volume: c.volume || 90, rate: c.rate || 1.0, pitch: c.pitch || 1.0
            }));
            const finalCmds = cleanCmds.length > 0 ? cleanCmds : DEFAULT_TTS_COMMANDS;
            writeJSON('tts_commands.json', finalCmds);
          }
          if (item.key === 'custom_sounds') {
            writeJSON('custom_sounds.json', item.value);
          }
          if (item.key === 'custom_images') {
            writeJSON('custom_images.json', item.value);
          }
          if (item.key === 'voice_catalog' && Array.isArray(item.value)) {
            const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
            const validCodeIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
            const cleanVoices = item.value.filter(v => v && v.id && validCodeIds.has(v.id.toLowerCase())).map(v => {
              const { avatar, ...rest } = v;
              return rest;
            });
            const finalVoices = cleanVoices.length > 0 ? cleanVoices : codeVoices;
            writeJSON('voice_catalog.json', finalVoices);
            if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
              voiceCatalog.setVoices(finalVoices);
            }
          }
        });
        this.restoreAllMediaFiles();
      } else {
        // Si MongoDB está vacío, respaldar lo actual local en MongoDB
        const currentCustomSounds = this.getCustomSounds();
        if (currentCustomSounds && currentCustomSounds.length > 0) {
          await this.syncToMongoDB('custom_sounds', currentCustomSounds);
        }
        const currentCustomImages = this.getCustomImages();
        if (currentCustomImages && currentCustomImages.length > 0) {
          await this.syncToMongoDB('custom_images', currentCustomImages);
        }
        const currentRewards = this.getRewards();
        if (currentRewards && currentRewards.length > 0) {
          await this.syncToMongoDB('channel_points', currentRewards);
        }
        const currentGoals = this.getGoals();
        if (currentGoals && currentGoals.length > 0) {
          await this.syncToMongoDB('goals', currentGoals);
        }
        const currentCommands = this.getCommands();
        if (currentCommands && currentCommands.length > 0) {
          await this.syncToMongoDB('commands', currentCommands);
        }
        const currentConfig = this.getConfig();
        if (currentConfig) {
          await this.syncToMongoDB('config', currentConfig);
        }
        const currentAlerts = this.getAlerts();
        if (currentAlerts) {
          await this.syncToMongoDB('alerts', currentAlerts);
        }
        const currentVoiceCatalog = this.getVoiceCatalog();
        if (currentVoiceCatalog && currentVoiceCatalog.length > 0) {
          await this.syncToMongoDB('voice_catalog', currentVoiceCatalog);
        }
      }
    } catch (err) {
      console.warn('⚠️ [MongoDB Cloud] Error en sincronización inicial:', err.message);
    }
  }

  async syncToMongoDB(key, value) {
    if (!this.isMongoReady || !this.mongoDb) return;
    const scopes = new Set([this.getStreamerId(), 'system', 'default'].filter(Boolean));
    for (const streamerId of scopes) {
      try {
        await this.mongoDb.collection('settings').updateOne(
          { streamer_id: streamerId, key },
          {
            $set: {
              streamer_id: streamerId,
              key,
              value,
              updated_at: new Date().toISOString()
            }
          },
          { upsert: true }
        );
      } catch (err) {
        console.warn(`⚠️ [MongoDB Cloud] Error al guardar "${key}" para "${streamerId}":`, err.message);
      }
    }
  }

  // ================= ⚡ DOBLE RESPALDO SIMULTÁNEO =================
  /**
   * Envía la información a Supabase AND MongoDB al mismo tiempo en paralelo.
   */
  async syncToCloud(key, value) {
    const promises = [];
    if (this.supabase) {
      promises.push(this.syncToSupabase(key, value));
    }
    if (this.isMongoReady && this.mongoDb) {
      promises.push(this.syncToMongoDB(key, value));
    }
    await Promise.allSettled(promises);
  }

  /**
   * Re-sincroniza toda la data desde ambas nubes para el streamer actual.
   */
  async resyncForStreamer(streamerId) {
    this.setStreamerId(streamerId);
    await Promise.allSettled([
      this.syncFromSupabase(),
      this.syncFromMongoDB()
    ]);
  }

  /**
   * Inicia el ciclo automático de Heartbeat para evitar que Supabase y MongoDB Atlas
   * se pausen por inactividad (Anti-Pause 24/7).
   */
  startDatabaseKeepAliveHeartbeat() {
    if (this._dbHeartbeatTimer) clearInterval(this._dbHeartbeatTimer);

    // Heartbeat cada 5 minutos (300,000 ms)
    const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

    this._dbHeartbeatTimer = setInterval(async () => {
      try {
        await this.pingDatabases();
      } catch (err) {
        console.warn('⚠️ [Keep-Alive DB] Error en ciclo de heartbeat:', err.message);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Ejecutar el primer ping tras 10 segundos del arranque
    setTimeout(() => {
      this.pingDatabases().catch(() => {});
    }, 10000);
  }

  /**
   * Envía una consulta de actividad y timestamp a Supabase y MongoDB Atlas
   * para mantener activos los pools de conexión y evitar suspensiones de proyecto.
   */
  async pingDatabases() {
    const results = {
      timestamp: new Date().toISOString(),
      supabase: { status: 'idle', latencyMs: 0 },
      mongodb: { status: 'idle', latencyMs: 0 }
    };

    const heartbeatPayload = {
      service: 'OrbiBot Dual Database KeepAlive',
      status: 'active',
      last_activity: new Date().toISOString(),
      streamer_id: this.getStreamerId()
    };

    // 1. Ping y actualización en Supabase PostgreSQL
    if (this.supabase) {
      const t0 = Date.now();
      try {
        const { error } = await this.supabase
          .from('orbibot_settings')
          .upsert({
            streamer_id: 'system',
            key: '_heartbeat',
            value: heartbeatPayload,
            updated_at: new Date().toISOString()
          }, { onConflict: 'streamer_id,key' });

        if (!error) {
          this.isSupabaseReady = true;
          results.supabase = { status: 'active', latencyMs: Date.now() - t0 };
        } else {
          await this.supabase.from('orbibot_settings').select('key').limit(1);
          this.isSupabaseReady = true;
          results.supabase = { status: 'active_read', latencyMs: Date.now() - t0 };
        }
      } catch (sbErr) {
        results.supabase = { status: 'error', error: sbErr.message };
      }
    }

    // 2. Ping y comando nativo en MongoDB Atlas
    if (this.mongoDb) {
      const t0 = Date.now();
      try {
        await this.mongoDb.command({ ping: 1 });
        await this.mongoDb.collection('settings').updateOne(
          { streamer_id: 'system', key: '_heartbeat' },
          {
            $set: {
              streamer_id: 'system',
              key: '_heartbeat',
              value: heartbeatPayload,
              updated_at: new Date().toISOString()
            }
          },
          { upsert: true }
        );
        this.isMongoReady = true;
        results.mongodb = { status: 'active', latencyMs: Date.now() - t0 };
      } catch (mgErr) {
        results.mongodb = { status: 'error', error: mgErr.message };
        if (this.mongoClient) {
          try { this.initMongoDB(); } catch (e) { }
        }
      }
    }

    console.log(`💓 [Keep-Alive DB] Heartbeat activo: Supabase (${results.supabase.status}) | MongoDB (${results.mongodb.status}) - ${results.timestamp}`);
    return results;
  }

  /**
   * Devuelve el estado de conexión del doble respaldo y su actividad.
   */
  getBackupStatus() {
    return {
      dualBackupEnabled: true,
      keepAliveActive: true,
      heartbeatInterval: '5m',
      supabase: {
        configured: Boolean(process.env.SUPABASE_URL),
        connected: this.isSupabaseReady,
        name: 'Supabase PostgreSQL'
      },
      mongodb: {
        configured: Boolean(process.env.MONGODB_URI || true),
        connected: this.isMongoReady,
        name: 'MongoDB Atlas'
      },
      local: {
        ready: true,
        name: 'Cache Local JSON'
      },
      streamerId: this.getStreamerId(),
      timestamp: new Date().toISOString()
    };
  }

  // ================= GETTERS Y SETTERS =================
  getConfig() {
    const cfg = readJSON('config.json', DEFAULT_CONFIG);
    let changed = false;
    let security = cfg.security || {};
    if (!security.widgetToken) {
      security.widgetToken = generateWidgetToken();
      changed = true;
    }
    const goals = this.getGoals();
    const merged = {
      ...DEFAULT_CONFIG,
      ...cfg,
      twitch: { ...DEFAULT_CONFIG.twitch, ...(cfg.twitch || {}) },
      kick: { ...DEFAULT_CONFIG.kick, ...(cfg.kick || {}) },
      chatPlatforms: { ...DEFAULT_CONFIG.chatPlatforms, ...(cfg.chatPlatforms || {}) },
      songRequest: { ...DEFAULT_CONFIG.songRequest, ...(cfg.songRequest || {}) },
      tts: { ...DEFAULT_CONFIG.tts, ...(cfg.tts || {}) },
      goals,
      security
    };
    if (changed) {
      writeJSON('config.json', merged);
      this.syncToCloud('config', merged);
    }
    return merged;
  }

  regenerateWidgetToken() {
    const cfg = this.getConfig();
    const newToken = generateWidgetToken();
    cfg.security = {
      ...(cfg.security || {}),
      widgetToken: newToken
    };
    writeJSON('config.json', cfg);
    this.syncToCloud('config', cfg);
    return newToken;
  }

  saveConfig(newConfig) {
    const current = this.getConfig();

    // Preservar credenciales válidas de Twitch ante actualizaciones parciales o campos vacíos del autoguardado
    let mergedTwitch = { ...current.twitch };
    if (newConfig.twitch) {
      const inc = newConfig.twitch;
      const isExplicitReset = inc.explicitReset === true;

      const channel = inc.channel !== undefined
        ? (inc.channel ? inc.channel.toLowerCase().replace(/^#/, '').trim() : (isExplicitReset ? '' : current.twitch.channel))
        : current.twitch.channel;

      const botUsername = inc.botUsername !== undefined
        ? (inc.botUsername ? inc.botUsername.toLowerCase().replace(/^#/, '').trim() : (isExplicitReset ? '' : (current.twitch.botUsername || channel)))
        : current.twitch.botUsername;

      const oauthToken = inc.oauthToken !== undefined
        ? (inc.oauthToken ? inc.oauthToken : (isExplicitReset ? '' : current.twitch.oauthToken))
        : current.twitch.oauthToken;

      const clientId = inc.clientId || current.twitch.clientId || 'yw1vr664ichms8an2x5lhji58v7ozk';
      const displayName = inc.displayName || current.twitch.displayName || channel;
      const profileImage = inc.profileImage || current.twitch.profileImage || '';
      const userId = inc.userId || current.twitch.userId || '';
      const connected = inc.connected !== undefined
        ? inc.connected
        : (isExplicitReset ? false : Boolean(channel && (oauthToken || current.twitch.connected)));

      mergedTwitch = {
        ...current.twitch,
        ...inc,
        channel,
        botUsername,
        oauthToken,
        clientId,
        displayName,
        profileImage,
        userId,
        connected
      };

      if (channel && channel !== this._streamerId) {
        this.setStreamerId(channel);
      } else if (isExplicitReset && channel === '') {
        this.setStreamerId('default');
      }
    }

    const merged = {
      ...current,
      ...newConfig,
      twitch: mergedTwitch,
      kick: { ...current.kick, ...(newConfig.kick || {}) },
      chatPlatforms: { ...current.chatPlatforms, ...(newConfig.chatPlatforms || {}) },
      songRequest: { ...current.songRequest, ...(newConfig.songRequest || {}) },
      tts: { ...current.tts, ...(newConfig.tts || {}) },
      goals: Array.isArray(newConfig.goals) ? newConfig.goals : (newConfig.goals ? { ...current.goals, ...newConfig.goals } : current.goals),
      widgetStyles: { ...(current.widgetStyles || {}), ...(newConfig.widgetStyles || {}) },
      security: { ...current.security, ...(newConfig.security || {}) }
    };

    writeJSON('config.json', merged);
    this.syncToCloud('config', merged);
    return merged;
  }

  getCommands() {
    return readJSON('commands.json', DEFAULT_COMMANDS);
  }

  saveCommands(commands) {
    writeJSON('commands.json', commands);
    this.syncToCloud('commands', commands);
    return commands;
  }

  getAlerts() {
    const alerts = readJSON('alerts.json', DEFAULT_ALERTS);
    const merged = {};
    Object.keys(DEFAULT_ALERTS).forEach(k => {
      merged[k] = { ...DEFAULT_ALERTS[k], ...(alerts[k] || {}) };
    });
    Object.keys(alerts || {}).forEach(k => {
      if (!merged[k]) {
        merged[k] = alerts[k];
      }
    });
    return merged;
  }

  saveAlerts(alerts) {
    const current = this.getAlerts();
    const merged = { ...current };
    if (alerts && typeof alerts === 'object') {
      Object.keys(alerts).forEach(k => {
        if (alerts[k] && typeof alerts[k] === 'object') {
          merged[k] = { ...(current[k] || {}), ...alerts[k] };
        } else {
          merged[k] = alerts[k];
        }
      });
    }
    writeJSON('alerts.json', merged);
    this.restoreMediaFromAlertsAndRewards();
    this.syncToCloud('alerts', merged);
    return merged;
  }

  getRewards() {
    return readJSON('channel_points.json', []);
  }

  saveRewards(rewards) {
    writeJSON('channel_points.json', rewards || []);
    this.restoreMediaFromAlertsAndRewards();
    this.syncToCloud('channel_points', rewards || []);
    return rewards || [];
  }

  getGoals() {
    const goals = readJSON('goals.json', null);
    if (Array.isArray(goals)) {
      return goals;
    }
    const cfg = readJSON('config.json', DEFAULT_CONFIG);
    if (Array.isArray(cfg.goals)) {
      writeJSON('goals.json', cfg.goals);
      return cfg.goals;
    }
    return [];
  }

  saveGoals(goals) {
    const list = Array.isArray(goals) ? goals : [];
    writeJSON('goals.json', list);
    this.syncToCloud('goals', list);
    return list;
  }

  getCustomSounds() {
    return readJSON('custom_sounds.json', []);
  }

  saveCustomSounds(sounds) {
    writeJSON('custom_sounds.json', sounds || []);
    this.restoreAudioFiles(sounds);
    this.syncToCloud('custom_sounds', sounds || []);
    return sounds || [];
  }

  getCustomImages() {
    return readJSON('custom_images.json', []);
  }

  saveCustomImages(images) {
    writeJSON('custom_images.json', images || []);
    this.restoreImageFiles(images);
    this.syncToCloud('custom_images', images || []);
    return images || [];
  }

  getTtsCommands() {
    const list = readJSON('tts_commands.json', DEFAULT_TTS_COMMANDS);
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_TTS_COMMANDS;
    const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
    const validVoiceIds = new Set(codeVoices.map(v => v.id.toLowerCase()));
    const filtered = list.filter(c => c && c.voiceId && validVoiceIds.has(c.voiceId.toLowerCase()));
    return filtered.length > 0 ? filtered : DEFAULT_TTS_COMMANDS;
  }

  saveTtsCommands(commands) {
    const list = Array.isArray(commands) ? commands : DEFAULT_TTS_COMMANDS;
    writeJSON('tts_commands.json', list);
    this.syncToCloud('tts_commands', list);
    return list;
  }

  addTtsCommand(command) {
    if (!command || !command.command) return null;
    const commands = this.getTtsCommands();
    const cleanCmd = (command.command.startsWith('!') ? command.command : `!${command.command}`).toLowerCase().trim();
    const newCmd = {
      id: command.id || ('tts_cmd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6)),
      voiceId: command.voiceId || 'es_mx_mia',
      name: command.name || 'Voz Personalizada',
      command: cleanCmd,
      permissions: Array.isArray(command.permissions) && command.permissions.length ? command.permissions : ['todos'],
      enabled: command.enabled !== undefined ? Boolean(command.enabled) : true,
      volume: command.volume !== undefined ? Number(command.volume) : 90,
      rate: command.rate !== undefined ? Number(command.rate) : 1.0,
      pitch: command.pitch !== undefined ? Number(command.pitch) : 1.0
    };

    const existingIdx = commands.findIndex(c => c.id === newCmd.id || c.command.toLowerCase() === newCmd.command.toLowerCase());
    if (existingIdx >= 0) {
      commands[existingIdx] = { ...commands[existingIdx], ...newCmd };
    } else {
      commands.unshift(newCmd);
    }

    this.saveTtsCommands(commands);
    return newCmd;
  }

  updateTtsCommand(id, updates) {
    const commands = this.getTtsCommands();
    const idx = commands.findIndex(c => c.id === id);
    if (idx !== -1) {
      commands[idx] = { ...commands[idx], ...updates };
      this.saveTtsCommands(commands);
      return commands[idx];
    }
    return null;
  }

  deleteTtsCommand(id) {
    let commands = this.getTtsCommands();
    commands = commands.filter(c => c.id !== id && c.command !== id);
    this.saveTtsCommands(commands);
    return commands;
  }

  // ================= 🎙️ CATÁLOGO GENERAL DE VOCES =================
  getVoiceCatalog() {
    const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
    let list = readJSON('voice_catalog.json', []);
    if (!Array.isArray(list)) list = [];

    // Combinar siempre las voces del código (para que nuevas voces como Auronplay, Farid, etc. se muestren de inmediato)
    const voiceMap = new Map();
    for (const v of codeVoices) {
      if (v && v.id) voiceMap.set(v.id.toLowerCase(), { ...v });
    }
    for (const v of list) {
      if (v && v.id) {
        const existing = voiceMap.get(v.id.toLowerCase());
        if (existing) {
          voiceMap.set(v.id.toLowerCase(), { ...existing, ...v });
        } else {
          voiceMap.set(v.id.toLowerCase(), { ...v });
        }
      }
    }

    const merged = Array.from(voiceMap.values());
    if (merged.length !== list.length) {
      writeJSON('voice_catalog.json', merged);
    }
    if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
      voiceCatalog.setVoices(merged);
    }
    return merged;
  }

  initVoiceCatalog() {
    const codeVoices = (voiceCatalog && typeof voiceCatalog.getCodeVoices === 'function') ? voiceCatalog.getCodeVoices() : [];
    return this.saveVoiceCatalog(codeVoices);
  }

  saveVoiceCatalog(catalog) {
    const list = Array.isArray(catalog) ? catalog : [];
    writeJSON('voice_catalog.json', list);
    this.syncToCloud('voice_catalog', list);
    if (voiceCatalog && typeof voiceCatalog.setVoices === 'function') {
      voiceCatalog.setVoices(list);
    }
    return list;
  }

  addVoiceToCatalog(voiceData) {
    if (!voiceData || !voiceData.id) return null;
    const catalog = this.getVoiceCatalog();
    const idKey = voiceData.id.toLowerCase().trim();
    const newVoice = {
      id: idKey,
      name: voiceData.name || idKey,
      category: voiceData.category || 'general',
      tags: Array.isArray(voiceData.tags) ? voiceData.tags : ['custom'],
      lang: voiceData.lang || 'es-ES',
      defaultCommand: voiceData.defaultCommand || `!${idKey.replace(/^es_|^en_/, '')}`,
      stats: voiceData.stats || { uses: '1k', downloads: '10' },
      previewText: voiceData.previewText || `Hola, soy ${voiceData.name || idKey}.`,
      pitch: voiceData.pitch !== undefined ? Number(voiceData.pitch) : 1.0,
      rate: voiceData.rate !== undefined ? Number(voiceData.rate) : 1.0,
      isAI: Boolean(voiceData.isAI)
    };

    const existingIdx = catalog.findIndex(v => v.id.toLowerCase() === idKey);
    if (existingIdx >= 0) {
      catalog[existingIdx] = { ...catalog[existingIdx], ...newVoice };
    } else {
      catalog.push(newVoice);
    }

    this.saveVoiceCatalog(catalog);
    return newVoice;
  }

  deleteVoiceFromCatalog(id) {
    if (!id) return [];
    const cleanId = id.toString().toLowerCase().trim();
    let catalog = this.getVoiceCatalog();
    catalog = catalog.filter(v => v.id.toLowerCase() !== cleanId && v.name.toLowerCase() !== cleanId);
    this.saveVoiceCatalog(catalog);
    return catalog;
  }

  getUsers() {
    return readJSON('users.json', []);
  }

  async registerUser(email, password) {
    if (!email || !password) {
      throw new Error('Correo y contraseña son obligatorios.');
    }
    const cleanEmail = email.trim().toLowerCase();
    const users = this.getUsers();

    // 1. Verificar existencia local
    let existing = users.find(u => u.email.toLowerCase() === cleanEmail);

    // 2. Verificar existencia en MongoDB
    if (!existing && this.isMongoReady && this.mongoDb) {
      try {
        const mongoUser = await this.mongoDb.collection('users').findOne({ email: cleanEmail });
        if (mongoUser) existing = mongoUser;
      } catch (e) { }
    }

    if (existing) {
      throw new Error('Ya existe una cuenta registrada con este correo electrónico.');
    }

    const hash = crypto.createHash('sha256').update(password).digest('hex');
    const newUser = {
      id: 'usr_' + crypto.randomBytes(8).toString('hex'),
      email: cleanEmail,
      username: cleanEmail.split('@')[0],
      passwordHash: hash,
      createdAt: new Date().toISOString()
    };

    // Respaldo Local
    users.push(newUser);
    writeJSON('users.json', users);

    // Respaldo MongoDB Atlas
    if (this.isMongoReady && this.mongoDb) {
      try {
        await this.mongoDb.collection('users').updateOne(
          { email: cleanEmail },
          { $set: newUser },
          { upsert: true }
        );
        console.log(`🍃 [MongoDB Cloud] Usuario "${cleanEmail}" registrado y respaldado.`);
      } catch (e) {
        console.warn('⚠️ [MongoDB Cloud] Error al guardar usuario:', e.message);
      }
    }

    // Respaldo Supabase
    if (this.supabase) {
      try {
        await this.supabase.from('orbibot_users').upsert({
          id: newUser.id,
          email: cleanEmail,
          username: newUser.username,
          password_hash: hash,
          created_at: newUser.createdAt
        }, { onConflict: 'email' });
      } catch (e) { }
    }

    return { id: newUser.id, email: newUser.email, username: newUser.username };
  }

  async loginUser(email, password) {
    if (!email || !password) {
      throw new Error('Correo y contraseña son obligatorios.');
    }
    const cleanEmail = email.trim().toLowerCase();
    const hash = crypto.createHash('sha256').update(password).digest('hex');

    const users = this.getUsers();
    let user = users.find(u => u.email.toLowerCase() === cleanEmail && u.passwordHash === hash);

    // Si no está en el JSON local, consultar MongoDB Atlas
    if (!user && this.isMongoReady && this.mongoDb) {
      try {
        const mongoUser = await this.mongoDb.collection('users').findOne({ email: cleanEmail, passwordHash: hash });
        if (mongoUser) {
          user = mongoUser;
          // Guardar en copia local
          if (!users.some(u => u.email.toLowerCase() === cleanEmail)) {
            users.push(mongoUser);
            writeJSON('users.json', users);
          }
        }
      } catch (e) { }
    }

    if (!user) {
      throw new Error('Credenciales inválidas. Por favor verifica tu correo y contraseña.');
    }
    return { id: user.id, email: user.email, username: user.username };
  }

  // ================= 👑 ADMINISTRACIÓN GENERAL & SOPORTE MULTI-STREAMER =================

  /**
   * Verifica si un usuario (por email o userId) es Administrador General
   */
  async isUserAdmin(email, userId) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanUserId = (userId || '').trim();
    if (!cleanEmail && !cleanUserId) return { isAdmin: false };

    // 1. Validar por variable de entorno ADMIN_EMAILS (separados por coma)
    const envAdmins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    if (cleanEmail && envAdmins.includes(cleanEmail)) {
      return { isAdmin: true, role: 'superadmin', source: 'env' };
    }

    // 2. Validar en Supabase (tabla orbibot_admins)
    if (this.supabase) {
      try {
        let query = this.supabase.from('orbibot_admins').select('*');
        if (cleanEmail && cleanUserId) {
          query = query.or(`email.eq.${cleanEmail},user_id.eq.${cleanUserId}`);
        } else if (cleanEmail) {
          query = query.eq('email', cleanEmail);
        } else if (cleanUserId) {
          query = query.eq('user_id', cleanUserId);
        }
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return { isAdmin: true, role: data[0].role || 'superadmin', source: 'supabase', admin: data[0] };
        }
      } catch (err) {
        console.warn('⚠️ [Storage Admin] Error al verificar admin en Supabase:', err.message);
      }
    }

    // 3. Validar en MongoDB (colección admins)
    if (this.isMongoReady && this.mongoDb) {
      try {
        const filter = {
          $or: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanUserId ? [{ user_id: cleanUserId }] : [])
          ]
        };
        const adminRecord = await this.mongoDb.collection('admins').findOne(filter);
        if (adminRecord) {
          return { isAdmin: true, role: adminRecord.role || 'superadmin', source: 'mongodb', admin: adminRecord };
        }
      } catch (err) {
        console.warn('⚠️ [Storage Admin] Error al verificar admin en MongoDB:', err.message);
      }
    }

    // 4. Validar en admins.json local
    try {
      const globalAdmins = readJSON('admins.json', []);
      const found = globalAdmins.find(a => (cleanEmail && a.email?.toLowerCase() === cleanEmail) || (cleanUserId && a.user_id === cleanUserId));
      if (found) {
        return { isAdmin: true, role: found.role || 'superadmin', source: 'local', admin: found };
      }
    } catch (e) {}

    return { isAdmin: false };
  }

  /**
   * Obtiene la lista de todos los administradores registrados
   */
  async getAdmins() {
    const adminMap = new Map();

    // 1. Supabase
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.from('orbibot_admins').select('*');
        if (!error && data) {
          data.forEach(a => {
            if (a.email) adminMap.set(a.email.toLowerCase(), a);
          });
        }
      } catch (e) {}
    }

    // 2. MongoDB
    if (this.isMongoReady && this.mongoDb) {
      try {
        const mongoAdmins = await this.mongoDb.collection('admins').find().toArray();
        if (mongoAdmins) {
          mongoAdmins.forEach(a => {
            if (a.email && !adminMap.has(a.email.toLowerCase())) {
              adminMap.set(a.email.toLowerCase(), a);
            }
          });
        }
      } catch (e) {}
    }

    // 3. Variables de entorno
    const envAdmins = (process.env.ADMIN_EMAILS || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean);
    envAdmins.forEach(email => {
      if (!adminMap.has(email)) {
        adminMap.set(email, { email, role: 'superadmin', notes: 'Configurado en .env', created_at: new Date().toISOString() });
      }
    });

    return Array.from(adminMap.values());
  }

  /**
   * Añade un nuevo Administrador General
   */
  async addAdmin(email, role = 'superadmin', notes = '') {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('El correo del administrador es obligatorio.');

    const adminObj = {
      email: cleanEmail,
      role: role || 'superadmin',
      notes: notes || 'Admin creado desde Panel de Control',
      created_at: new Date().toISOString()
    };

    if (this.supabase) {
      try {
        await this.supabase.from('orbibot_admins').upsert(adminObj, { onConflict: 'email' });
      } catch (e) {
        console.warn('⚠️ [Storage Admin] Error al guardar admin en Supabase:', e.message);
      }
    }

    if (this.isMongoReady && this.mongoDb) {
      try {
        await this.mongoDb.collection('admins').updateOne(
          { email: cleanEmail },
          { $set: adminObj },
          { upsert: true }
        );
      } catch (e) {}
    }

    const local = readJSON('admins.json', []);
    if (!local.some(a => a.email?.toLowerCase() === cleanEmail)) {
      local.push(adminObj);
      writeJSON('admins.json', local);
    }

    return adminObj;
  }

  /**
   * Elimina un Administrador General
   */
  async removeAdmin(email) {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) throw new Error('El correo del administrador es obligatorio.');

    if (this.supabase) {
      try {
        await this.supabase.from('orbibot_admins').delete().eq('email', cleanEmail);
      } catch (e) {}
    }

    if (this.isMongoReady && this.mongoDb) {
      try {
        await this.mongoDb.collection('admins').deleteOne({ email: cleanEmail });
      } catch (e) {}
    }

    const local = readJSON('admins.json', []);
    const filtered = local.filter(a => a.email?.toLowerCase() !== cleanEmail);
    writeJSON('admins.json', filtered);

    return { success: true, email: cleanEmail };
  }

  /**
   * Obtiene la lista de todos los streamers registrados y sus resúmenes de configuración
   */
  async getAllStreamers() {
    const streamersMap = new Map();

    // 1. Consultar Supabase orbibot_settings
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.from('orbibot_settings').select('*');
        if (!error && data && data.length > 0) {
          data.forEach(item => {
            const sId = item.streamer_id;
            if (!sId || sId === 'system' || sId === 'global') return;
            if (!streamersMap.has(sId)) {
              streamersMap.set(sId, {
                streamerId: sId,
                twitchChannel: '',
                kickChannel: '',
                updatedAt: item.updated_at || new Date().toISOString(),
                hasConfig: false,
                commandsCount: 0,
                rewardsCount: 0,
                goalsCount: 0,
                soundsCount: 0
              });
            }
            const current = streamersMap.get(sId);
            if (item.updated_at && (!current.updatedAt || new Date(item.updated_at) > new Date(current.updatedAt))) {
              current.updatedAt = item.updated_at;
            }
            if (item.key === 'config' && item.value) {
              current.hasConfig = true;
              if (item.value.twitch?.channel) current.twitchChannel = item.value.twitch.channel;
              if (item.value.kick?.channel || item.value.kick?.username) current.kickChannel = item.value.kick.channel || item.value.kick.username;
            }
            if (item.key === 'twitch_auth' && item.value) {
              const val = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
              if (val.channel || val.login || val.displayName) current.twitchChannel = val.channel || val.login || val.displayName;
            }
            if (item.key === 'kick_auth' && item.value) {
              const val = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
              if (val.channel || val.username) current.kickChannel = val.channel || val.username;
            }
            if (item.key === 'commands' && Array.isArray(item.value)) current.commandsCount = item.value.length;
            if (item.key === 'channel_points' && Array.isArray(item.value)) current.rewardsCount = item.value.length;
            if (item.key === 'goals' && Array.isArray(item.value)) current.goalsCount = item.value.length;
            if (item.key === 'custom_sounds' && Array.isArray(item.value)) current.soundsCount = item.value.length;
          });
        }
      } catch (e) {
        console.warn('⚠️ [Storage Admin] Error al consultar streamers en Supabase:', e.message);
      }
    }

    // 2. Consultar MongoDB settings
    if (this.isMongoReady && this.mongoDb) {
      try {
        const records = await this.mongoDb.collection('settings').find({ streamer_id: { $nin: ['system', 'global'] } }).toArray();
        if (records && records.length > 0) {
          records.forEach(item => {
            const sId = item.streamer_id;
            if (!sId) return;
            if (!streamersMap.has(sId)) {
              streamersMap.set(sId, {
                streamerId: sId,
                twitchChannel: '',
                kickChannel: '',
                updatedAt: item.updated_at || new Date().toISOString(),
                hasConfig: false,
                commandsCount: 0,
                rewardsCount: 0,
                goalsCount: 0,
                soundsCount: 0
              });
            }
            const current = streamersMap.get(sId);
            if (item.key === 'config' && item.value) {
              current.hasConfig = true;
              if (item.value.twitch?.channel) current.twitchChannel = item.value.twitch.channel;
              if (item.value.kick?.channel || item.value.kick?.username) current.kickChannel = item.value.kick.channel || item.value.kick.username;
            }
          });
        }
      } catch (e) {}
    }

    // 3. Incluir streamer local si no está ya
    const localId = this.getStreamerId();
    if (localId && localId !== 'default' && !streamersMap.has(localId)) {
      const cfg = this.getConfig();
      streamersMap.set(localId, {
        streamerId: localId,
        twitchChannel: cfg.twitch?.channel || '',
        kickChannel: cfg.kick?.channel || cfg.kick?.username || '',
        updatedAt: new Date().toISOString(),
        hasConfig: true,
        commandsCount: this.getCommands().length,
        rewardsCount: this.getRewards().length,
        goalsCount: this.getGoals().length,
        soundsCount: this.getCustomSounds().length
      });
    }

    return Array.from(streamersMap.values()).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }

  /**
   * Obtiene la configuración completa de un streamer para asistencia/soporte
   */
  async getStreamerFullConfig(streamerId) {
    const cleanId = (streamerId || '').toLowerCase().replace(/^#/, '').trim();
    if (!cleanId) throw new Error('streamerId es obligatorio.');

    const result = {
      streamerId: cleanId,
      config: null,
      alerts: null,
      commands: null,
      tts_commands: null,
      channel_points: null,
      goals: null,
      custom_sounds: null,
      custom_images: null,
      widget_token: null
    };

    // 1. Supabase
    if (this.supabase) {
      try {
        const { data, error } = await this.supabase
          .from('orbibot_settings')
          .select('*')
          .eq('streamer_id', cleanId);
        if (!error && data && data.length > 0) {
          data.forEach(item => {
            if (result.hasOwnProperty(item.key) || item.key === 'widget_token') {
              result[item.key] = item.value;
            }
          });
        }
      } catch (e) {}
    }

    // 2. MongoDB Fallback
    if (this.isMongoReady && this.mongoDb && !result.config) {
      try {
        const mongoRecords = await this.mongoDb.collection('settings').find({ streamer_id: cleanId }).toArray();
        if (mongoRecords && mongoRecords.length > 0) {
          mongoRecords.forEach(item => {
            if (result.hasOwnProperty(item.key)) {
              result[item.key] = item.value;
            }
          });
        }
      } catch (e) {}
    }

    // Si es el streamer local actual, rellenar lo que falte
    if (cleanId === this.getStreamerId()) {
      if (!result.config) result.config = this.getConfig();
      if (!result.alerts) result.alerts = this.getAlerts();
      if (!result.commands) result.commands = this.getCommands();
      if (!result.tts_commands) result.tts_commands = this.getTtsCommands();
      if (!result.channel_points) result.channel_points = this.getRewards();
      if (!result.goals) result.goals = this.getGoals();
      if (!result.custom_sounds) result.custom_sounds = this.getCustomSounds();
      if (!result.custom_images) result.custom_images = this.getCustomImages();
    }

    return result;
  }

  /**
   * Guarda o repara la configuración de un streamer desde el panel de soporte
   */
  async saveStreamerFullConfig(streamerId, bundle) {
    const cleanId = (streamerId || '').toLowerCase().replace(/^#/, '').trim();
    if (!cleanId) throw new Error('streamerId es obligatorio.');
    if (!bundle || typeof bundle !== 'object') throw new Error('Datos inválidos para guardar.');

    const keysToSave = ['config', 'alerts', 'commands', 'tts_commands', 'channel_points', 'goals', 'custom_sounds', 'custom_images', 'widget_token'];
    const now = new Date().toISOString();

    for (const key of keysToSave) {
      if (bundle[key] !== undefined) {
        const val = bundle[key];

        // Guardar en Supabase
        if (this.supabase) {
          try {
            await this.supabase.from('orbibot_settings').upsert({
              streamer_id: cleanId,
              key,
              value: val,
              updated_at: now
            }, { onConflict: 'streamer_id,key' });
          } catch (e) {}
        }

        // Guardar en MongoDB
        if (this.isMongoReady && this.mongoDb) {
          try {
            await this.mongoDb.collection('settings').updateOne(
              { streamer_id: cleanId, key },
              { $set: { streamer_id: cleanId, key, value: val, updated_at: now } },
              { upsert: true }
            );
          } catch (e) {}
        }
      }
    }

    // Si coincide con el streamer local, actualizar también archivos locales
    if (cleanId === this.getStreamerId()) {
      if (bundle.config) this.saveConfig(bundle.config);
      if (bundle.alerts) this.saveAlerts(bundle.alerts);
      if (bundle.commands) this.saveCommands(bundle.commands);
      if (bundle.tts_commands) this.saveTtsCommands(bundle.tts_commands);
      if (bundle.channel_points) this.saveRewards(bundle.channel_points);
      if (bundle.goals) this.saveGoals(bundle.goals);
      if (bundle.custom_sounds) this.saveCustomSounds(bundle.custom_sounds);
      if (bundle.custom_images) this.saveCustomImages(bundle.custom_images);
    }

    return { success: true, streamerId: cleanId, savedAt: now };
  }
}

module.exports = new StorageService();
