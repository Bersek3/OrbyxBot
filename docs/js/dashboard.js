/**
 * Twitch StreamBot & Overlay Toolkit - Dashboard Logic
 */

let appConfig = null;
let ytPlayer = null;
let ytApiReady = false;
let socket = null;

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  initSupabaseAuth();
  initLandingPage();
  setupNavigation();
  setupRangeInputs();
  setupEventListeners();
  setupAutoSaveListeners();
  populateWidgetUrls();
  await loadInitialData();
  populateWidgetUrls();
  connectWebSocket();
  initDashboardMqtt();
  updatePlatformLinkingUI();
  initTTSMultiVoiceSystem();
  checkAdminStatus();
});

// ================= SUPABASE AUTH & CONFIGURATION =================
const SUPABASE_URL = 'https://pzrlfuzjkwkrnmqkoaue.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_L6kzW0ZtGyfl6mvKevDX0Q_6G0DCGDP';
let supabaseClient = null;

function getFreshDefaultConfig() {
  let freshToken = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    freshToken = 'sec_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    freshToken = 'sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  return {
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
      clientId: '01M0VT0JC58YQEVGRHM8JFXQX3',
      connected: false
    },
    chatPlatforms: {
      twitch: true,
      kick: true
    },
    security: {
      widgetToken: freshToken
    },
    songRequest: {
      prefix: '!sr',
      enabled: true,
      maxDurationMinutes: 8,
      maxPerUser: 5,
      userLevel: 'all',
      volume: 75,
      autoplay: true
    },
    tts: {
      enabled: true,
      engine: 'streamelements',
      voice: 'es_mx_mia',
      volume: 90,
      rate: 1.0,
      pitch: 1.0,
      maxLength: 250,
      bannedWords: [],
      allowChatCommand: true,
      chatCommand: '!tts',
      minBits: 50
    },
    goals: []
  };
}

function clearAllUserLocalData() {
  // 1. Desconectar bots e instancias activas
  if (browserTmiClient) {
    try { browserTmiClient.disconnect(); } catch (e) { }
    browserTmiClient = null;
  }
  if (typeof kickSocket !== 'undefined' && kickSocket) {
    try { kickSocket.close(); } catch (e) { }
    kickSocket = null;
  }
  if (dashboardMqttClient) {
    try { dashboardMqttClient.disconnect(); } catch (e) { }
    dashboardMqttClient = null;
    isMqttConnected = false;
  }

  // 2. Limpiar todo el almacenamiento local del usuario anterior
  const keysToRemove = [
    'orbibot_user_session',
    'orbibot_active_user_id',
    'orbibot_twitch_auth',
    'orbibot_kick_auth',
    'orbibot_kick_channel',
    'orbibot_config',
    'orbibot_commands',
    'orbibot_rewards',
    'orbibot_goals',
    'orbibot_alerts',
    'orbibot_widget_token',
    'orbibot_custom_sounds',
    'orbibot_custom_images',
    'orbibot_chat_platforms',
    'orbibot_current_tab',
    'orbibot_sr_state',
    'orbibot_current_song',
    'orbibot_song_history',
    'orbibot_last_event',
    'orbibot_tts_commands',
    'orbibot_active_tts_voice'
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // 3. Limpiar tokens de sesión de Supabase
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('sb-') || k.includes('supabase.auth.token')) {
        localStorage.removeItem(k);
      }
    });
    sessionStorage.clear();
  } catch (e) { }

  // 4. Reiniciar appConfig en memoria con estado limpio
  appConfig = getFreshDefaultConfig();

  // 5. Restablecer UI al estado limpio por defecto
  resetDashboardUIToDefault();
}

function resetDashboardUIToDefault() {
  const twitchChan = document.getElementById('cfgTwitchChannel');
  if (twitchChan) twitchChan.value = '';
  const twitchBot = document.getElementById('cfgTwitchBotUsername');
  if (twitchBot) twitchBot.value = '';
  const twitchToken = document.getElementById('cfgTwitchBotToken');
  if (twitchToken) twitchToken.value = '';
  const kickChan = document.getElementById('cfgKickChannel');
  if (kickChan) kickChan.value = '';

  updateBotStatusUI({ status: 'disconnected', channel: '' });
  updatePlatformLinkingUI();
  updateAuthUI();

  const chatContainer = document.getElementById('liveChatMessages');
  if (chatContainer) {
    chatContainer.innerHTML = '<div class="chat-placeholder-box"><p>💬 Conecta tu canal de Twitch o Kick para ver el chat en vivo.</p></div>';
  }
  const chatNotice = document.getElementById('chatStatusNotice');
  if (chatNotice) chatNotice.innerText = '⚪ Desconectado';

  renderCommands([]);
  renderRewards([]);
  if (typeof renderGoals === 'function') renderGoals([]);

  currentSrState = { currentSong: null, queue: [], isPlaying: false, history: [] };
  updateSongRequestUI(currentSrState, false);
  if (typeof ytPlayer !== 'undefined' && ytPlayer && ytPlayer.stopVideo) {
    try { ytPlayer.stopVideo(); } catch(e) {}
  }

  populateWidgetUrls();
}

async function saveToAllSupabaseScopes(key, value) {
  if (!supabaseClient) return;

  const scopes = new Set();

  if (adminTargetStreamerId) {
    scopes.add(adminTargetStreamerId.toLowerCase().trim());
    const targetTwitch = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
    const targetKick = (appConfig?.kick?.channel || appConfig?.kick?.username || '').toLowerCase().replace(/^@/, '').trim();
    if (targetTwitch) scopes.add(targetTwitch);
    if (targetKick) scopes.add(targetKick);
  } else {
    const session = getUserSession();
    if (!session || (!session.email && !session.id)) {
      return;
    }
    if (session.email) scopes.add(session.email.toLowerCase().trim());
    if (session.id) scopes.add(session.id);

    // Solo asociar al canal de Twitch si fue explícitamente vinculado por este usuario
    const localTwitch = localStorage.getItem('orbibot_twitch_auth');
    if (localTwitch) {
      try {
        const parsed = JSON.parse(localTwitch);
        const chan = (parsed.channel || parsed.login || parsed.displayName || '').toLowerCase().replace(/^#/, '').trim();
        if (chan) scopes.add(chan);
      } catch (e) { }
    } else if (appConfig?.twitch?.channel && appConfig?.twitch?.connected) {
      const chan = appConfig.twitch.channel.toLowerCase().replace(/^#/, '').trim();
      if (chan) scopes.add(chan);
    }
  }

  if (key === 'voice_catalog') {
    scopes.add('system');
    scopes.add('default');
  }

  const promises = Array.from(scopes).filter(Boolean).map(streamerId => {
    return supabaseClient.from('orbibot_settings').upsert({
      streamer_id: streamerId,
      key: key,
      value: value,
      updated_at: new Date().toISOString()
    }, { onConflict: 'streamer_id,key' });
  });

  try {
    await Promise.all(promises);
  } catch (err) {
    console.warn(`[Supabase Multi-Scope Sync Error for ${key}]:`, err);
  }
}

async function loadUserDataFromSupabase(userIdentifier) {
  if (!supabaseClient || !userIdentifier) return;
  try {
    const cleanId = (userIdentifier || '').toLowerCase().replace(/^#/, '').trim();
    const session = getUserSession();
    const userId = session?.id || '';

    // Consultar estrictamente por los identificadores de este usuario
    const userScopes = [cleanId];
    if (userId && userId !== cleanId) userScopes.push(userId);

    const { data, error } = await supabaseClient
      .from('orbibot_settings')
      .select('*')
      .in('streamer_id', userScopes);

    // Si es una cuenta nueva sin datos en Supabase, inicializar panel limpio y privado
    if (!data || data.length === 0) {
      console.log(`✨ [Supabase Cloud] Nuevo usuario detectado ("${cleanId}"). Inicializando panel limpio y privado.`);
      const freshCfg = getFreshDefaultConfig();
      appConfig = freshCfg;
      localStorage.setItem('orbibot_config', JSON.stringify(freshCfg));
      localStorage.setItem('orbibot_commands', JSON.stringify([]));
      localStorage.setItem('orbibot_rewards', JSON.stringify([]));
      localStorage.setItem('orbibot_goals', JSON.stringify([]));
      localStorage.setItem('orbibot_alerts', JSON.stringify({}));
      localStorage.removeItem('orbibot_twitch_auth');
      localStorage.removeItem('orbibot_kick_auth');
      localStorage.removeItem('orbibot_kick_channel');
      localStorage.removeItem('orbibot_custom_sounds');
      localStorage.removeItem('orbibot_custom_images');
      localStorage.removeItem('orbibot_sr_state');
      localStorage.removeItem('orbibot_current_song');
      localStorage.removeItem('orbibot_song_history');
      localStorage.setItem('orbibot_tts_commands', JSON.stringify(DEFAULT_TTS_COMMANDS));
      localStorage.removeItem('orbibot_active_tts_voice');

      currentSrState = { currentSong: null, queue: [], isPlaying: false, history: [] };
      updateSongRequestUI(currentSrState, false);
      if (typeof ytPlayer !== 'undefined' && ytPlayer && ytPlayer.stopVideo) {
        try { ytPlayer.stopVideo(); } catch(e) {}
      }

      bindConfigToUI(freshCfg);
      renderCommands([]);
      renderRewards([]);
      renderTTSCommands(DEFAULT_TTS_COMMANDS);
      if (typeof renderGoals === 'function') renderGoals([]);
      updatePlatformLinkingUI();
      populateWidgetUrls();

      saveToAllSupabaseScopes('config', freshCfg).catch(() => {});
      saveToAllSupabaseScopes('commands', []).catch(() => {});
      saveToAllSupabaseScopes('channel_points', []).catch(() => {});
      saveToAllSupabaseScopes('goals', []).catch(() => {});
      saveToAllSupabaseScopes('custom_sounds', []).catch(() => {});
      saveToAllSupabaseScopes('custom_images', []).catch(() => {});
      saveToAllSupabaseScopes('sr_state', currentSrState).catch(() => {});
      saveToAllSupabaseScopes('tts_commands', DEFAULT_TTS_COMMANDS).catch(() => {});
      saveToAllSupabaseScopes('voice_catalog', DEFAULT_VOICE_CATALOG).catch(() => {});
      const myToken = freshCfg?.security?.widgetToken || getEffectiveWidgetToken();
      saveToAllSupabaseScopes('widget_token', myToken).catch(() => {});
      return;
    }

    if (!error && data && data.length > 0) {
      console.log(`☁️ [Supabase Cloud] ${data.length} ajustes sincronizados para "${cleanId}".`);
      
      // Limpiar caches previos de plataformas, archivos y song request antes de aplicar datos de este usuario
      localStorage.removeItem('orbibot_twitch_auth');
      localStorage.removeItem('orbibot_kick_auth');
      localStorage.removeItem('orbibot_kick_channel');
      localStorage.removeItem('orbibot_custom_sounds');
      localStorage.removeItem('orbibot_custom_images');
      localStorage.removeItem('orbibot_sr_state');
      localStorage.removeItem('orbibot_current_song');
      localStorage.removeItem('orbibot_song_history');
      currentSrState = { currentSong: null, queue: [], isPlaying: false, history: [] };
      updateSongRequestUI(currentSrState, false);
      if (typeof ytPlayer !== 'undefined' && ytPlayer && ytPlayer.stopVideo) {
        try { ytPlayer.stopVideo(); } catch(e) {}
      }

      const baseConfig = getFreshDefaultConfig();
      appConfig = { ...baseConfig };

      data.forEach(item => {
        if (item.key === 'twitch_auth' && item.value) {
          try {
            const twData = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
            if (twData && (twData.channel || twData.login || twData.displayName)) {
              localStorage.setItem('orbibot_twitch_auth', JSON.stringify(twData));
              appConfig.twitch = { ...(appConfig.twitch || {}), ...twData };
              bindConfigToUI(appConfig);
              updatePlatformLinkingUI();
              if (twData.channel && window.tmi && (!browserTmiClient || browserTmiClient.readyState() !== 'OPEN')) {
                connectInBrowserTwitchBot(twData);
              }
            }
          } catch (e) { }
        }
        if (item.key === 'kick_auth' && item.value) {
          try {
            const kData = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
            if (kData && (kData.channel || kData.username)) {
              localStorage.setItem('orbibot_kick_auth', JSON.stringify(kData));
              if (kData.channel) localStorage.setItem('orbibot_kick_channel', kData.channel);
              appConfig.kick = { ...(appConfig.kick || {}), ...kData };
              updatePlatformLinkingUI();
              if (kData.channel && typeof connectInBrowserKickBot === 'function') {
                connectInBrowserKickBot(kData);
              }
            }
          } catch (e) { }
        }
        if (item.key === 'config' && item.value) {
          appConfig = { ...(appConfig || {}), ...item.value };
          const localSavedVoice = localStorage.getItem('orbibot_active_tts_voice');
          if (localSavedVoice) {
            if (!appConfig.tts) appConfig.tts = {};
            appConfig.tts.voice = localSavedVoice;
          }
          if (item.value.twitch && (item.value.twitch.channel || item.value.twitch.displayName)) {
            localStorage.setItem('orbibot_twitch_auth', JSON.stringify(item.value.twitch));
          }
          if (item.value.kick && (item.value.kick.channel || item.value.kick.username)) {
            localStorage.setItem('orbibot_kick_auth', JSON.stringify(item.value.kick));
            if (item.value.kick.channel) localStorage.setItem('orbibot_kick_channel', item.value.kick.channel);
          }
          localStorage.setItem('orbibot_config', JSON.stringify(appConfig));
          bindConfigToUI(appConfig);
          updatePlatformLinkingUI();
        }
        if (item.key === 'active_tts_voice' && item.value) {
          localStorage.setItem('orbibot_active_tts_voice', item.value);
          if (!appConfig.tts) appConfig.tts = {};
          appConfig.tts.voice = item.value;
          const vSel = document.getElementById('cfgTtsVoice');
          if (vSel) vSel.value = item.value;
        }
        if (item.key === 'widgetStyles' && item.value) {
          if (typeof wcWidgetStyles !== 'undefined') {
            wcWidgetStyles = { ...wcWidgetStyles, ...item.value };
            if (wcWidgetStyles.alerts) {
              if (wcWidgetStyles.alerts.images) {
                wcAlertImages = { ...wcAlertImages, ...wcWidgetStyles.alerts.images };
              }
              if (wcWidgetStyles.alerts.sounds) {
                wcAlertSounds = { ...wcAlertSounds, ...wcWidgetStyles.alerts.sounds };
              }
            }
          }
        }
        if (item.key === 'alerts' && item.value) {
          localStorage.setItem('orbibot_alerts', JSON.stringify(item.value));
          if (typeof wcAlertImages !== 'undefined' && typeof wcAlertSounds !== 'undefined') {
            Object.keys(item.value).forEach(k => {
              if (item.value[k]?.image) wcAlertImages[k] = item.value[k].image;
              if (item.value[k]?.sound) wcAlertSounds[k] = item.value[k].sound;
            });
          }
        }
        if (item.key === 'commands' && Array.isArray(item.value)) {
          const isOldDemo = item.value.length === 4 && item.value.some(c => c.name === '!discord') && item.value.some(c => c.name === '!redes');
          const cleanCmds = isOldDemo ? [] : item.value;
          localStorage.setItem('orbibot_commands', JSON.stringify(cleanCmds));
          renderCommands(cleanCmds);
        }
        if (item.key === 'channel_points' && Array.isArray(item.value)) {
          const seen = new Set();
          const cleanRwds = [];
          for (const r of item.value) {
            const k = (r.rewardName || r.name || r.id || '').trim().toLowerCase();
            if (k && !seen.has(k)) {
              seen.add(k);
              cleanRwds.push(r);
            }
          }
          localStorage.setItem('orbibot_rewards', JSON.stringify(cleanRwds));
          renderRewards(cleanRwds);
        }
        if (item.key === 'goals' && Array.isArray(item.value)) {
          localStorage.setItem('orbibot_goals', JSON.stringify(item.value));
          if (typeof renderGoals === 'function') {
            renderGoals(item.value);
          }
        }
        if (item.key === 'custom_sounds' && Array.isArray(item.value)) {
          localStorage.setItem('orbibot_custom_sounds', JSON.stringify(item.value));
        }
        if (item.key === 'custom_images' && Array.isArray(item.value)) {
          localStorage.setItem('orbibot_custom_images', JSON.stringify(item.value));
        }
        if (item.key === 'sr_state' && item.value) {
          try {
            const parsedSr = typeof item.value === 'string' ? JSON.parse(item.value) : item.value;
            if (parsedSr && typeof parsedSr === 'object') {
              currentSrState = {
                currentSong: parsedSr.currentSong || null,
                queue: Array.isArray(parsedSr.queue) ? parsedSr.queue : [],
                isPlaying: !!parsedSr.isPlaying,
                history: Array.isArray(parsedSr.history) ? parsedSr.history : []
              };
              localStorage.setItem('orbibot_sr_state', JSON.stringify(currentSrState));
              updateSongRequestUI(currentSrState, false);
            }
          } catch (e) { }
        }
        if (item.key === 'widget_token' && item.value) {
          localStorage.setItem('orbibot_widget_token', item.value);
          if (appConfig) {
            if (!appConfig.security) appConfig.security = {};
            appConfig.security.widgetToken = item.value;
          }
        }
        if (item.key === 'tts_commands' && Array.isArray(item.value)) {
          const cleanCmds = item.value.length > 0 ? item.value : DEFAULT_TTS_COMMANDS;
          localStorage.setItem('orbibot_tts_commands', JSON.stringify(cleanCmds));
          cachedTTSCommands = cleanCmds;
          renderTTSCommands(cachedTTSCommands);
        }
        if (item.key === 'voice_catalog' && Array.isArray(item.value)) {
          cachedVoiceLibrary = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, item.value);
          localStorage.setItem('orbibot_voice_catalog', JSON.stringify(cachedVoiceLibrary));
          const searchEl = document.getElementById('voiceLibrarySearch');
          renderVoiceLibrary(getFilteredVoicesLocal(searchEl ? searchEl.value : '', activeVoiceCategory));
        }
      });
      if (!cachedTTSCommands || cachedTTSCommands.length === 0) {
        cachedTTSCommands = [...DEFAULT_TTS_COMMANDS];
        renderTTSCommands(cachedTTSCommands);
      }
      bindConfigToUI(appConfig);
      updatePlatformLinkingUI();
      populateWidgetUrls();
      if (typeof initWidgetCustomization === 'function') {
        initWidgetCustomization();
      }
      await loadSounds();
    }
  } catch (err) {
    console.warn('⚠️ [Supabase Cloud] Error al cargar datos del usuario:', err.message);
  }
}

// ================= ACTIVE TAB PERSISTENCE =================
function getActiveDashboardTab() {
  try {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#tab-')) {
      const pane = document.getElementById(hash.substring(1));
      if (pane) return hash.substring(1);
    }
    const savedTab = sessionStorage.getItem('orbibot_current_tab') || localStorage.getItem('orbibot_current_tab');
    if (savedTab && document.getElementById(savedTab)) {
      return savedTab;
    }
    const activePane = document.querySelector('.tab-pane.active');
    if (activePane && activePane.id) {
      return activePane.id;
    }
  } catch (e) { }
  return 'tab-dashboard';
}

function saveActiveDashboardTab(tabId) {
  if (!tabId) return;
  try {
    sessionStorage.setItem('orbibot_current_tab', tabId);
    localStorage.setItem('orbibot_current_tab', tabId);
    if (!window.location.hash || window.location.hash.startsWith('#tab-')) {
      history.replaceState(null, document.title, window.location.pathname + window.location.search + '#' + tabId);
    }
  } catch (e) { }
}

function initSupabaseAuth() {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('🟢 [Supabase Client] Inicializado en el frontend.');

      // 1. Escuchar cambios de autenticación (Google OAuth, login o logout)
      supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log('🔐 [Supabase Auth Event]:', event, session?.user?.email);
        if (session && session.user) {
          const currentUserId = session.user.id;
          const previousActiveId = localStorage.getItem('orbibot_active_user_id');
          if (previousActiveId && previousActiveId !== currentUserId) {
            console.log('🔄 [Auth] Cambio de cuenta detectado. Limpiando sesión previa...');
            clearAllUserLocalData();
          }
          localStorage.setItem('orbibot_active_user_id', currentUserId);

          const userObj = {
            id: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0],
            avatar: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || '',
            provider: session.user.app_metadata?.provider || 'supabase',
            loggedInAt: Date.now()
          };
          setUserSession(userObj);
          closeAuthModal();

          // Si solo es un refresco de token en segundo plano y el dashboard ya está visible, no interrumpir la pantalla del usuario
          const isDashboardVisible = document.getElementById('dashboardAppView')?.style?.display === 'flex';
          if (event === 'TOKEN_REFRESHED' && isDashboardVisible) {
            return;
          }

          // Sincronizar ajustes guardados en la nube para este usuario
          await loadUserDataFromSupabase(userObj.email);
          await checkAdminStatus();

          // Mantener o abrir la pestaña en la que el usuario estaba trabajando
          const currentTab = getActiveDashboardTab();
          showDashboardView(currentTab);
          updatePlatformLinkingUI();

          // Limpiar hash de tokens de la URL si venimos de Google OAuth
          if (window.location.hash && window.location.hash.includes('access_token')) {
            try {
              history.replaceState(null, document.title, window.location.pathname + window.location.search + '#' + currentTab);
            } catch (e) { }
          }
        } else if (event === 'SIGNED_OUT') {
          clearAllUserLocalData();
          checkAdminStatus();
          showLandingView();
        }
      });

      // 2. Verificar sesión actual al cargar
      supabaseClient.auth.getSession().then(async ({ data: { session } }) => {
        if (session && session.user) {
          const currentUserId = session.user.id;
          const previousActiveId = localStorage.getItem('orbibot_active_user_id');
          if (previousActiveId && previousActiveId !== currentUserId) {
            console.log('🔄 [Auth] Cambio de cuenta detectado al iniciar sesión...');
            clearAllUserLocalData();
          }
          localStorage.setItem('orbibot_active_user_id', currentUserId);

          const userObj = {
            id: session.user.id,
            email: session.user.email,
            username: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email.split('@')[0],
            avatar: session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture || '',
            provider: session.user.app_metadata?.provider || 'supabase',
            loggedInAt: Date.now()
          };
          setUserSession(userObj);
          await loadUserDataFromSupabase(userObj.email);
          await checkAdminStatus();
          const currentTab = getActiveDashboardTab();
          showDashboardView(currentTab);
          updatePlatformLinkingUI();
        } else {
          checkAdminStatus();
        }
      });
    } catch (e) {
      console.warn('⚠️ [Supabase Client] Error al inicializar:', e);
    }
  }
}

// ================= USER AUTHENTICATION & SESSION MANAGEMENT =================
function getUserSession() {
  try {
    const raw = localStorage.getItem('orbibot_user_session');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function setUserSession(user) {
  try {
    localStorage.setItem('orbibot_user_session', JSON.stringify(user));
    updateAuthUI();
  } catch (e) {
    console.error('Error saving user session:', e);
  }
}

function clearUserSession() {
  clearAllUserLocalData();
}

function updateAuthUI() {
  const session = getUserSession();
  const authAccountPill = document.getElementById('authAccountPill');
  const authAccountEmail = document.getElementById('authAccountEmail');

  if (session && session.email) {
    if (authAccountPill) authAccountPill.style.display = 'inline-flex';
    if (authAccountEmail) authAccountEmail.textContent = session.username || 'Mi Cuenta';
  } else {
    if (authAccountPill) authAccountPill.style.display = 'none';
  }
}

// Open Auth Modal
function openAuthModal(initialTab = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;

  // Clear any existing alert
  const alertBox = document.getElementById('authAlertBox');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.innerHTML = '';
  }

  modal.style.display = 'flex';
  switchAuthTab(initialTab);

  // Close when clicking overlay backdrop
  modal.onclick = function (e) {
    if (e.target === modal) {
      closeAuthModal();
    }
  };
}

// Close Auth Modal
function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.style.display = 'none';
}

// Switch between Login and Register Tabs
function switchAuthTab(tab) {
  const loginBtn = document.getElementById('authTabLoginBtn');
  const registerBtn = document.getElementById('authTabRegisterBtn');
  const loginForm = document.getElementById('authLoginForm');
  const registerForm = document.getElementById('authRegisterForm');
  const mainTitle = document.getElementById('authModalMainTitle');
  const subtitle = document.getElementById('authModalSubtitle');
  const alertBox = document.getElementById('authAlertBox');

  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.innerHTML = '';
  }

  if (tab === 'register') {
    if (loginBtn) loginBtn.classList.remove('active');
    if (registerBtn) registerBtn.classList.add('active');
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'flex';
    if (mainTitle) mainTitle.textContent = 'Crear Cuenta';
    if (subtitle) subtitle.textContent = 'Crea tu cuenta gratis para acceder al panel de control.';
    const emailInput = document.getElementById('authRegEmail');
    if (emailInput) setTimeout(() => emailInput.focus(), 50);
  } else {
    if (registerBtn) registerBtn.classList.remove('active');
    if (loginBtn) loginBtn.classList.add('active');
    if (registerForm) registerForm.style.display = 'none';
    if (loginForm) loginForm.style.display = 'flex';
    if (mainTitle) mainTitle.textContent = 'Iniciar Sesión';
    if (subtitle) subtitle.textContent = 'Accede a tu panel de control, widgets y overlays.';
    const emailInput = document.getElementById('authLoginEmail');
    if (emailInput) setTimeout(() => emailInput.focus(), 50);
  }
}

// Show alert message in Auth Modal
function showAuthAlert(type, message) {
  const alertBox = document.getElementById('authAlertBox');
  if (!alertBox) return;
  alertBox.className = `auth-alert-box ${type}`;
  alertBox.innerHTML = (type === 'error' ? '⚠️ ' : (type === 'info' ? 'ℹ️ ' : '✅ ')) + message;
  alertBox.style.display = 'block';
}

// Google Sign-In with Supabase
async function signInWithGoogle() {
  showAuthAlert('info', 'Redirigiendo a Google OAuth...');
  if (!supabaseClient) {
    initSupabaseAuth();
  }
  if (!supabaseClient) {
    showAuthAlert('error', 'El servicio de autenticación no está listo. Verifica tu conexión a internet.');
    return;
  }

  try {
    const cleanOrigin = window.location.origin;
    const cleanPath = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '');
    const redirectUrl = `${cleanOrigin}${cleanPath}/`;

    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          prompt: 'select_account',
          access_type: 'offline'
        }
      }
    });

    if (error) {
      throw error;
    }
    if (data && data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error('Error al conectar con Google:', err);
    showAuthAlert('error', 'Error con Google OAuth: ' + (err.message || 'Inténtalo de nuevo.'));
  }
}

// Handler for when user clicks "Panel de Control"
function handleDashboardNavClick(targetTab = null) {
  const session = getUserSession();
  if (session && session.email) {
    // User already authenticated -> direct access to dashboard
    showDashboardView(targetTab || getActiveDashboardTab());
  } else {
    // User not authenticated -> open login modal
    openAuthModal('login');
  }
}

// Handle Register Form Submission with Supabase
async function handleAuthRegisterSubmit(event) {
  event.preventDefault();
  const emailInput = document.getElementById('authRegEmail');
  const emailConfirmInput = document.getElementById('authRegEmailConfirm');
  const passwordInput = document.getElementById('authRegPassword');
  const passwordConfirmInput = document.getElementById('authRegPasswordConfirm');
  const submitBtn = document.getElementById('authRegSubmitBtn');

  const email = emailInput ? emailInput.value.trim() : '';
  const emailConfirm = emailConfirmInput ? emailConfirmInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  const passwordConfirm = passwordConfirmInput ? passwordConfirmInput.value : '';

  // 1. Validate fields presence
  if (!email || !emailConfirm || !password || !passwordConfirm) {
    showAuthAlert('error', 'Por favor completa todos los campos del formulario.');
    return;
  }

  // 2. Validate Email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showAuthAlert('error', 'Por favor ingresa un correo electrónico válido.');
    return;
  }

  // 3. Validate Email Double Matching (2 veces)
  if (email.toLowerCase() !== emailConfirm.toLowerCase()) {
    showAuthAlert('error', 'Los correos electrónicos ingresados no coinciden. Por favor verifícalos.');
    if (emailConfirmInput) emailConfirmInput.focus();
    return;
  }

  // 4. Validate Password length
  if (password.length < 6) {
    showAuthAlert('error', 'La contraseña debe tener un mínimo de 6 caracteres.');
    if (passwordInput) passwordInput.focus();
    return;
  }

  // 5. Validate Password Double Matching (2 veces)
  if (password !== passwordConfirm) {
    showAuthAlert('error', 'Las contraseñas ingresadas no coinciden. Por favor verifícalas.');
    if (passwordConfirmInput) passwordConfirmInput.focus();
    return;
  }

  // Disable button and show spinner
  if (submitBtn) {
    submitBtn.disabled = true;
    const spinner = submitBtn.querySelector('.auth-btn-spinner');
    if (spinner) spinner.style.display = 'inline-block';
  }

  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.signUp({
        email: email.toLowerCase(),
        password: password
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('already') || msg.includes('exists') || msg.includes('registered') || msg.includes('identity')) {
          throw new Error('Este correo ya está registrado (posiblemente iniciado con Google). Por favor inicia sesión con Google o usa tu contraseña.');
        }
        throw error;
      }

      // Check if identities are empty (Supabase returns empty identities array when user already exists)
      if (data?.user?.identities && data.user.identities.length === 0) {
        throw new Error('Este correo ya se encuentra registrado (iniciado previamente con Google o contraseña). Por favor inicia sesión.');
      }

      // Reset register form
      if (emailInput) emailInput.value = '';
      if (emailConfirmInput) emailConfirmInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (passwordConfirmInput) passwordConfirmInput.value = '';

      showAuthAlert('success', '¡Cuenta creada exitosamente! Ya puedes iniciar sesión.');

      setTimeout(() => {
        switchAuthTab('login');
        const loginEmailInput = document.getElementById('authLoginEmail');
        if (loginEmailInput) {
          loginEmailInput.value = email;
          const loginPassInput = document.getElementById('authLoginPassword');
          if (loginPassInput) setTimeout(() => loginPassInput.focus(), 100);
        }
      }, 1200);
    } else {
      // Backend fallback
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Error al registrar.');

      showAuthAlert('success', '¡Cuenta creada exitosamente! Ya puedes iniciar sesión.');
      setTimeout(() => switchAuthTab('login'), 1200);
    }
  } catch (err) {
    showAuthAlert('error', err.message || 'Ocurrió un error al registrar.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      const spinner = submitBtn.querySelector('.auth-btn-spinner');
      if (spinner) spinner.style.display = 'none';
    }
  }
}

// Handle Login Form Submission with Supabase
async function handleAuthLoginSubmit(event) {
  event.preventDefault();
  const emailInput = document.getElementById('authLoginEmail');
  const passwordInput = document.getElementById('authLoginPassword');
  const submitBtn = document.getElementById('authLoginSubmitBtn');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!email || !password) {
    showAuthAlert('error', 'Por favor ingresa tu correo y contraseña.');
    return;
  }

  // Disable button and show spinner
  if (submitBtn) {
    submitBtn.disabled = true;
    const spinner = submitBtn.querySelector('.auth-btn-spinner');
    if (spinner) spinner.style.display = 'inline-block';
  }

  try {
    if (supabaseClient) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email.toLowerCase(),
        password: password
      });

      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('invalid') || msg.includes('credentials')) {
          throw new Error('Credenciales inválidas. Si te registraste con Google, pulsa el botón "Continuar con Google".');
        }
        throw error;
      }

      const sessionData = {
        id: data.user.id,
        email: data.user.email,
        username: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email.split('@')[0],
        avatar: data.user.user_metadata?.avatar_url || '',
        provider: 'supabase',
        loggedInAt: Date.now()
      };
      setUserSession(sessionData);

      showAuthAlert('success', `¡Bienvenido ${sessionData.username}!`);
      setTimeout(() => {
        closeAuthModal();
        showDashboardView(getActiveDashboardTab());
      }, 500);
    } else {
      // Backend fallback
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Credenciales inválidas.');

      setUserSession(data.user);
      showAuthAlert('success', `¡Bienvenido!`);
      setTimeout(() => {
        closeAuthModal();
        showDashboardView(getActiveDashboardTab());
      }, 500);
    }
  } catch (err) {
    showAuthAlert('error', err.message || 'Error al iniciar sesión.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      const spinner = submitBtn.querySelector('.auth-btn-spinner');
      if (spinner) spinner.style.display = 'none';
    }
  }
}

// Handle Logout
async function handleAuthLogout() {
  if (supabaseClient) {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn('Error signing out of Supabase:', e);
    }
  }
  clearAllUserLocalData();
  checkAdminStatus();
  showToast('Has cerrado tu sesión de OrbyxBot Cloud.', 'info');
  showLandingView();
  updateAuthUI();
}

// ================= PLATFORM LINKING (TWITCH & KICK IN DASHBOARD) =================
function updatePlatformLinkingUI() {
  const session = getUserSession();
  const userLoggedInEmail = document.getElementById('userLoggedInEmail');
  if (userLoggedInEmail && session) {
    if (adminTargetStreamerId) {
      userLoggedInEmail.textContent = `Asistiendo a: @${adminTargetStreamerId}`;
    } else {
      userLoggedInEmail.textContent = session.username || session.email || 'Sesión activa';
    }
  }

  // 1. Twitch Status
  let isTwitchConn = false;
  let twitchChannel = '';
  let twitchDisplayName = '';
  let twitchAvatar = '';

  if (adminTargetStreamerId) {
    twitchChannel = (appConfig?.twitch?.channel || appConfig?.twitch?.login || '').toLowerCase().replace(/^#/, '');
    isTwitchConn = Boolean(twitchChannel && appConfig?.twitch?.connected !== false);
    twitchDisplayName = appConfig?.twitch?.displayName || twitchChannel;
    twitchAvatar = appConfig?.twitch?.profileImage || '';
  } else {
    isTwitchConn = isStreamerLoggedIn();
    twitchChannel = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '');
    if (!twitchChannel) {
      try {
        const local = localStorage.getItem('orbibot_twitch_auth');
        if (local) {
          const p = JSON.parse(local);
          twitchChannel = (p.channel || p.login || '').replace(/^#/, '');
          twitchDisplayName = p.displayName || twitchChannel;
          twitchAvatar = p.profileImage || p.profile_image_url || '';
        }
      } catch (e) { }
    } else {
      twitchDisplayName = appConfig?.twitch?.displayName || twitchChannel;
      twitchAvatar = appConfig?.twitch?.profileImage || '';
    }
  }

  const twitchStatusText = document.getElementById('dashTwitchStatusText');
  const twitchStatusBadge = document.getElementById('dashTwitchStatusBadge');
  const twitchDiscView = document.getElementById('dashTwitchDisconnectedView');
  const twitchConnView = document.getElementById('dashTwitchConnectedView');
  const dashUserName = document.getElementById('dashUserName');
  const dashUserAvatar = document.getElementById('dashUserAvatar');

  if (isTwitchConn && twitchChannel) {
    if (twitchStatusText) twitchStatusText.textContent = `@${twitchChannel} sincronizado`;
    if (twitchStatusBadge) {
      twitchStatusBadge.textContent = '● Conectado';
      twitchStatusBadge.style.background = 'rgba(145, 70, 255, 0.2)';
      twitchStatusBadge.style.color = '#c4b5fd';
      twitchStatusBadge.style.border = '1px solid rgba(145, 70, 255, 0.4)';
    }
    if (twitchDiscView) twitchDiscView.style.display = 'none';
    if (twitchConnView) twitchConnView.style.display = 'flex';
    if (dashUserName) dashUserName.textContent = `@${twitchDisplayName || twitchChannel}`;

    if (dashUserAvatar) {
      if (twitchAvatar) {
        dashUserAvatar.src = twitchAvatar;
      } else if (!adminTargetStreamerId) {
        const authData = localStorage.getItem('orbibot_twitch_auth');
        if (authData) {
          try {
            const parsed = JSON.parse(authData);
            if (parsed.profile_image_url) dashUserAvatar.src = parsed.profile_image_url;
          } catch (e) { }
        }
      }
    }
  } else {
    if (twitchStatusText) twitchStatusText.textContent = 'No conectado';
    if (twitchStatusBadge) {
      twitchStatusBadge.textContent = '● Desconectado';
      twitchStatusBadge.style.background = 'rgba(255,255,255,0.08)';
      twitchStatusBadge.style.color = '#94a3b8';
      twitchStatusBadge.style.border = 'none';
    }
    if (twitchDiscView) twitchDiscView.style.display = 'flex';
    if (twitchConnView) twitchConnView.style.display = 'none';
  }

  // 2. Kick Status
  let kickConfig = appConfig?.kick || {};
  if (!adminTargetStreamerId && (!kickConfig.channel && !kickConfig.username)) {
    try { kickConfig = JSON.parse(localStorage.getItem('orbibot_kick_auth') || '{}'); } catch (e) { kickConfig = {}; }
  }
  const kickChannel = (kickConfig.channel || kickConfig.username || (!adminTargetStreamerId ? localStorage.getItem('orbibot_kick_channel') : '') || '').toLowerCase().replace(/^@/, '').trim();
  const isKickConn = Boolean(kickChannel && (kickConfig.connected !== false));
  const kickDisplayName = kickConfig.username || kickChannel;
  const kickAvatar = kickConfig.profile_picture || kickConfig.avatar || '';

  const kickStatusText = document.getElementById('dashKickStatusText');
  const kickStatusBadge = document.getElementById('dashKickStatusBadge');
  const kickDiscView = document.getElementById('dashKickDisconnectedView');
  const kickConnView = document.getElementById('dashKickConnectedView');
  const dashKickChannelName = document.getElementById('dashKickChannelName');
  const dashKickAvatar = document.getElementById('dashKickAvatar');

  if (isKickConn && kickChannel) {
    if (kickStatusText) kickStatusText.textContent = `@${kickDisplayName || kickChannel} vinculado`;
    if (kickStatusBadge) {
      kickStatusBadge.textContent = '● Conectado';
      kickStatusBadge.style.background = 'rgba(83, 252, 24, 0.2)';
      kickStatusBadge.style.color = '#53fc18';
      kickStatusBadge.style.border = '1px solid rgba(83, 252, 24, 0.4)';
    }
    if (kickDiscView) kickDiscView.style.display = 'none';
    if (kickConnView) kickConnView.style.display = 'flex';
    if (dashKickChannelName) dashKickChannelName.textContent = `@${kickDisplayName || kickChannel}`;
    if (dashKickAvatar) {
      if (kickAvatar) {
        dashKickAvatar.src = kickAvatar;
        dashKickAvatar.style.display = 'inline-block';
      } else {
        dashKickAvatar.style.display = 'none';
      }
    }
  } else {
    if (kickStatusText) kickStatusText.textContent = 'No conectado';
    if (kickStatusBadge) {
      kickStatusBadge.textContent = '● Desconectado';
      kickStatusBadge.style.background = 'rgba(255,255,255,0.08)';
      kickStatusBadge.style.color = '#94a3b8';
      kickStatusBadge.style.border = 'none';
    }
    if (kickDiscView) kickDiscView.style.display = 'flex';
    if (kickConnView) kickConnView.style.display = 'none';
    if (dashKickAvatar) dashKickAvatar.style.display = 'none';
  }

  // 3. Multi-Chat Platform Toggles & Status
  let chatPlatforms = appConfig?.chatPlatforms || (adminTargetStreamerId ? { twitch: true, kick: true } : (() => {
    try { return JSON.parse(localStorage.getItem('orbibot_chat_platforms') || '{"twitch":true,"kick":true}'); } catch (e) { return { twitch: true, kick: true }; }
  })());

  const toggleTwitch = document.getElementById('toggleChatTwitch');
  const toggleKick = document.getElementById('toggleChatKick');
  if (toggleTwitch) toggleTwitch.checked = chatPlatforms.twitch !== false;
  if (toggleKick) toggleKick.checked = chatPlatforms.kick !== false;

  const twitchActive = isTwitchConn && (chatPlatforms.twitch !== false);
  const kickActive = isKickConn && (chatPlatforms.kick !== false);

  const multiChatBadge = document.getElementById('multiChatIndicatorBadge');
  const multiChatIcon = document.getElementById('multiChatIcon');
  const multiChatText = document.getElementById('multiChatText');

  if (multiChatBadge && multiChatText) {
    if (twitchActive && kickActive) {
      multiChatBadge.style.display = 'inline-flex';
      multiChatBadge.style.background = 'linear-gradient(90deg, rgba(145, 70, 255, 0.25), rgba(83, 252, 24, 0.25))';
      multiChatBadge.style.border = '1px solid rgba(83, 252, 24, 0.5)';
      multiChatBadge.style.color = '#fff';
      if (multiChatIcon) multiChatIcon.textContent = '⚡';
      multiChatText.textContent = 'Multi-Chat Activo (Twitch & Kick)';
    } else if (twitchActive) {
      multiChatBadge.style.display = 'inline-flex';
      multiChatBadge.style.background = 'rgba(145, 70, 255, 0.15)';
      multiChatBadge.style.border = '1px solid rgba(145, 70, 255, 0.4)';
      multiChatBadge.style.color = '#c4b5fd';
      if (multiChatIcon) multiChatIcon.textContent = '🟣';
      multiChatText.textContent = 'Chat Twitch Activo';
    } else if (kickActive) {
      multiChatBadge.style.display = 'inline-flex';
      multiChatBadge.style.background = 'rgba(83, 252, 24, 0.15)';
      multiChatBadge.style.border = '1px solid rgba(83, 252, 24, 0.4)';
      multiChatBadge.style.color = '#53fc18';
      if (multiChatIcon) multiChatIcon.textContent = '🟢';
      multiChatText.textContent = 'Chat Kick Activo';
    } else {
      multiChatBadge.style.display = 'none';
    }
  }
}

// ================= MULTI-PLATFORM CHAT TOGGLES =================
function handleChatPlatformToggle(platform, enabled) {
  if (!appConfig) appConfig = {};
  if (!appConfig.chatPlatforms) appConfig.chatPlatforms = { twitch: true, kick: true };
  appConfig.chatPlatforms[platform] = enabled;

  try {
    localStorage.setItem('orbibot_chat_platforms', JSON.stringify(appConfig.chatPlatforms));
  } catch (e) { }

  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatPlatforms: appConfig.chatPlatforms })
  }).catch(() => { });

  broadcastEvent('chat_platform_toggle', appConfig.chatPlatforms);

  updatePlatformLinkingUI();
  populateWidgetUrls();

  const platName = platform === 'kick' ? 'Kick' : 'Twitch';
  showToast(enabled ? `🟢 Chat de ${platName} activado en OBS` : `⚪ Chat de ${platName} pausado en OBS`, 'info');
}

// Helper: Check if both platforms are enabled
function areBothPlatformsEnabledInDash() {
  const twitchConn = Boolean(appConfig?.twitch?.connected || localStorage.getItem('orbibot_twitch_auth'));
  const kickConn = Boolean(appConfig?.kick?.connected || localStorage.getItem('orbibot_kick_auth'));
  const platforms = appConfig?.chatPlatforms || { twitch: true, kick: true };
  return Boolean(twitchConn && kickConn && (platforms.twitch !== false) && (platforms.kick !== false));
}

// Helper: Render Kick Badges
function renderKickBadges(badges) {
  if (!badges || !Array.isArray(badges) || badges.length === 0) return '';
  let html = '';
  badges.forEach(b => {
    const type = b.type || '';
    if (type === 'broadcaster') {
      html += `<span class="kick-badge" style="display:inline-block; padding:1px 5px; background:#53fc18; color:#000; font-size:10px; font-weight:800; border-radius:3px; margin-right:4px; vertical-align:middle; line-height:1.2;">HOST</span>`;
    } else if (type === 'moderator') {
      html += `<span class="kick-badge" style="display:inline-block; padding:1px 5px; background:#10b981; color:#fff; font-size:10px; font-weight:800; border-radius:3px; margin-right:4px; vertical-align:middle; line-height:1.2;">MOD</span>`;
    } else if (type === 'subscriber') {
      html += `<span class="kick-badge" style="display:inline-block; padding:1px 5px; background:#3b82f6; color:#fff; font-size:10px; font-weight:800; border-radius:3px; margin-right:4px; vertical-align:middle; line-height:1.2;">SUB</span>`;
    } else if (type === 'vip') {
      html += `<span class="kick-badge" style="display:inline-block; padding:1px 5px; background:#ec4899; color:#fff; font-size:10px; font-weight:800; border-radius:3px; margin-right:4px; vertical-align:middle; line-height:1.2;">VIP</span>`;
    }
  });
  return html;
}

// ================= KICK OAUTH 2.0 FRONTEND LOGIC =================
let activeKickAuthPopup = null;

function triggerKickOAuthLogin() {
  const width = 560, height = 750;
  const left = Math.max(0, (window.innerWidth - width) / 2 + window.screenX);
  const top = Math.max(0, (window.innerHeight - height) / 2 + window.screenY);

  showToast('Abriendo ventana segura de inicio de sesión con Kick...', 'info');

  // Clean any prior auth event or error
  localStorage.removeItem('orbibot_kick_auth_event');
  localStorage.removeItem('orbibot_kick_auth_error');

  const kickAuthUrl = '/api/auth/kick/login';
  activeKickAuthPopup = window.open(kickAuthUrl, 'KickOAuthLogin', `width=${width},height=${height},top=${top},left=${left},status=no,menubar=no,toolbar=no,scrollbars=yes`);

  if (!activeKickAuthPopup || activeKickAuthPopup.closed || typeof activeKickAuthPopup.closed === 'undefined') {
    window.location.href = kickAuthUrl;
    return;
  }

  let pollCount = 0;
  const authPollInterval = setInterval(async () => {
    pollCount++;

    // 1. Check for success
    const rawEvent = localStorage.getItem('orbibot_kick_auth_event');
    if (rawEvent) {
      clearInterval(authPollInterval);
      localStorage.removeItem('orbibot_kick_auth_event');
      try {
        if (activeKickAuthPopup && !activeKickAuthPopup.closed) activeKickAuthPopup.close();
      } catch (e) { }
      activeKickAuthPopup = null;

      try {
        const payload = JSON.parse(rawEvent);
        await handleKickAuthSuccess(payload);
      } catch (err) {
        console.error('Error handling Kick auth success payload:', err);
      }
      return;
    }

    // 2. Check for error
    const rawError = localStorage.getItem('orbibot_kick_auth_error');
    if (rawError) {
      clearInterval(authPollInterval);
      localStorage.removeItem('orbibot_kick_auth_error');
      try {
        const errData = JSON.parse(rawError);
        showToast(`⚠️ Kick: ${errData.desc || errData.error}`, 'error');
      } catch (e) { }
      return;
    }

    if (pollCount > 600) {
      clearInterval(authPollInterval);
    }
  }, 300);
}

async function handleKickAuthSuccess(payload) {
  if (activeKickAuthPopup) {
    try { activeKickAuthPopup.close(); } catch (e) { }
    activeKickAuthPopup = null;
  }
  try { window.focus(); } catch (e) { }

  const kick = payload.kick || payload;
  const channel = (kick.channel || kick.username || '').toLowerCase();
  const displayName = kick.username || kick.name || channel;
  const profilePicture = kick.profile_picture || kick.avatar || '';

  if (!appConfig) appConfig = {};
  appConfig.kick = {
    channel,
    username: displayName,
    profile_picture: profilePicture,
    userId: kick.userId || '',
    accessToken: kick.accessToken || '',
    refreshToken: kick.refreshToken || '',
    clientId: kick.clientId || '01M0VT0JC58YQEVGRHM8JFXQX3',
    connected: true
  };

  localStorage.setItem('orbibot_kick_auth', JSON.stringify(appConfig.kick));
  localStorage.setItem('orbibot_kick_channel', channel);

  // Sincronizar en la nube con Supabase
  if (typeof saveToAllSupabaseScopes === 'function') {
    saveToAllSupabaseScopes('kick_auth', appConfig.kick).catch(() => {});
    saveToAllSupabaseScopes('config', appConfig).catch(() => {});
  }

  showToast(`🟢 ¡Kick vinculado con éxito! Conectado como @${displayName || channel}`, 'success');

  connectInBrowserKickBot(appConfig.kick);
  updatePlatformLinkingUI();
  populateWidgetUrls();
}

async function disconnectKickAccount() {
  if (browserKickWs) {
    try { browserKickWs.close(); } catch (e) { }
    browserKickWs = null;
  }

  try {
    await fetch('/api/auth/kick/disconnect', { method: 'POST' });
  } catch (e) { }

  localStorage.removeItem('orbibot_kick_auth');
  localStorage.removeItem('orbibot_kick_channel');
  localStorage.removeItem('orbibot_kick_auth_event');
  localStorage.removeItem('orbibot_kick_auth_error');

  if (!appConfig) appConfig = {};
  appConfig.kick = {
    channel: '',
    username: '',
    profile_picture: '',
    userId: '',
    accessToken: '',
    refreshToken: '',
    clientId: '01M0VT0JC58YQEVGRHM8JFXQX3',
    connected: false
  };

  // Limpiar en la nube con Supabase
  if (typeof saveToAllSupabaseScopes === 'function') {
    saveToAllSupabaseScopes('kick_auth', null).catch(() => {});
    saveToAllSupabaseScopes('config', appConfig).catch(() => {});
  }

  showToast('Canal de Kick desvinculado.', 'info');
  updatePlatformLinkingUI();
  populateWidgetUrls();
}

// Export auth functions to window
window.initSupabaseAuth = initSupabaseAuth;
window.signInWithGoogle = signInWithGoogle;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleDashboardNavClick = handleDashboardNavClick;
window.handleAuthRegisterSubmit = handleAuthRegisterSubmit;
window.handleAuthLoginSubmit = handleAuthLoginSubmit;
window.handleAuthLogout = handleAuthLogout;
window.getUserSession = getUserSession;
window.updatePlatformLinkingUI = updatePlatformLinkingUI;
window.handleChatPlatformToggle = handleChatPlatformToggle;
window.triggerKickOAuthLogin = triggerKickOAuthLogin;
window.handleKickAuthSuccess = handleKickAuthSuccess;
window.disconnectKickAccount = disconnectKickAccount;

// Export Custom Goals Manager functions to window
window.renderGoals = renderGoals;
window.toggleGoalForm = toggleGoalForm;
window.saveGoalFormUI = saveGoalFormUI;
window.editGoalForm = editGoalForm;
window.adjustGoalProgress = adjustGoalProgress;
window.resetGoalProgress = resetGoalProgress;
window.deleteGoalUI = deleteGoalUI;
window.toggleGoalUrlVisibility = toggleGoalUrlVisibility;
window.copyGoalWidgetUrl = copyGoalWidgetUrl;

// ================= VIEW SWITCHER (LANDING VS DASHBOARD) =================
function showLandingView() {
  const landingView = document.getElementById('landingView');
  const dashboardView = document.getElementById('dashboardAppView');
  if (landingView) landingView.style.display = 'flex';
  if (dashboardView) dashboardView.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDashboardView(targetTab = null) {
  const session = getUserSession();
  if (!session || !session.email) {
    showLandingView();
    openAuthModal('login');
    showToast('Debes iniciar sesión para acceder al Panel de Control.', 'warn');
    return;
  }

  const landingView = document.getElementById('landingView');
  const dashboardView = document.getElementById('dashboardAppView');
  if (landingView) landingView.style.display = 'none';
  if (dashboardView) dashboardView.style.display = 'flex';

  const tabToOpen = targetTab || getActiveDashboardTab();
  switchTab(tabToOpen);

  updateAuthUI();
  updatePlatformLinkingUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showLandingView = showLandingView;
window.showDashboardView = showDashboardView;

function initLandingPage() {
  updateAuthUI();

  // Navigation & CTA buttons on Landing
  const landingNavDashboardBtn = document.getElementById('landingNavDashboardBtn');
  if (landingNavDashboardBtn) {
    landingNavDashboardBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleDashboardNavClick(getActiveDashboardTab());
    });
  }

  const landingNavLoginBtn = document.getElementById('landingNavLoginBtn');
  if (landingNavLoginBtn) landingNavLoginBtn.addEventListener('click', () => openAuthModal('login'));

  const landingHeroLoginBtn = document.getElementById('landingHeroLoginBtn');
  if (landingHeroLoginBtn) landingHeroLoginBtn.addEventListener('click', triggerTwitchOAuthLogin);

  const landingHeroDashboardBtn = document.getElementById('landingHeroDashboardBtn');
  if (landingHeroDashboardBtn) {
    landingHeroDashboardBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleDashboardNavClick(getActiveDashboardTab());
    });
  }

  const landingBottomLoginBtn = document.getElementById('landingBottomLoginBtn');
  if (landingBottomLoginBtn) landingBottomLoginBtn.addEventListener('click', () => openAuthModal('login'));

  // Return to Home Buttons
  const sidebarGoHomeBtn = document.getElementById('sidebarGoHomeBtn');
  if (sidebarGoHomeBtn) sidebarGoHomeBtn.addEventListener('click', showLandingView);

  const topGoHomeBtn = document.getElementById('topGoHomeBtn');
  if (topGoHomeBtn) topGoHomeBtn.addEventListener('click', showLandingView);

  // FAQ Accordion
  document.querySelectorAll('.landing-faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.parentElement;
      const isActive = item.classList.contains('active');
      document.querySelectorAll('.landing-faq-item').forEach(i => i.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // Check session on load
  const session = getUserSession();
  if (session && session.email) {
    const tabName = getActiveDashboardTab();
    showDashboardView(tabName);
  } else {
    showLandingView();
  }
}

// ================= NAVIGATION =================
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const titleEl = document.getElementById('currentTabTitle');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetTabId = item.getAttribute('data-tab');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) {
        targetPane.classList.add('active');
      }

      if (titleEl && item.querySelector('span:last-child')) {
        titleEl.innerText = item.querySelector('span:last-child').innerText;
      }
      saveActiveDashboardTab(targetTabId);

      if (targetTabId === 'tab-admin' && typeof loadAdminStreamersList === 'function') {
        loadAdminStreamersList();
      }
    });
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#tab-')) {
      const tabId = hash.substring(1);
      const target = document.getElementById(tabId);
      if (target) {
        switchTab(tabId);
      }
    }
  });
}

function switchTab(tabId) {
  if (!tabId) tabId = getActiveDashboardTab();
  saveActiveDashboardTab(tabId);
  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  if (navItem) {
    navItem.click();
  } else {
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabPanes.forEach(p => p.classList.remove('active'));
    const target = document.getElementById(tabId);
    if (target) {
      target.classList.add('active');
      saveActiveDashboardTab(tabId);
    }
  }
}

// ================= TOAST NOTIFICATIONS =================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warn') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3500);
}

// ================= WEBSOCKET & MULTI-CHANNEL REALTIME =================
const broadcastChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('orbibot_stream_channel') : null;
let dashboardMqttClient = null;
let isMqttConnected = false;

function isStreamerLoggedIn() {
  if (adminTargetStreamerId) {
    const twitchChannel = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '');
    const kickChannel = (appConfig?.kick?.channel || appConfig?.kick?.username || '').toLowerCase().replace(/^@/, '').replace(/^#/, '');
    return Boolean(twitchChannel || kickChannel || adminTargetStreamerId);
  }
  const session = getUserSession();
  const twitchChannel = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '');
  const kickChannel = (appConfig?.kick?.channel || appConfig?.kick?.username || localStorage.getItem('orbibot_kick_channel') || '').toLowerCase().replace(/^@/, '').replace(/^#/, '');
  const hasTwitch = (appConfig?.twitch?.connected || Boolean(localStorage.getItem('orbibot_twitch_auth'))) && Boolean(twitchChannel);
  const hasKick = (appConfig?.kick?.connected !== false || Boolean(localStorage.getItem('orbibot_kick_auth'))) && Boolean(kickChannel);
  const hasUserSession = Boolean(session && session.email);
  return hasTwitch || hasKick || hasUserSession;
}

function getActiveStreamerRoom() {
  if (adminTargetStreamerId) {
    const twitchChannel = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
    const kickChannel = (appConfig?.kick?.channel || appConfig?.kick?.username || '').toLowerCase().replace(/^@/, '').replace(/^#/, '').trim();
    if (twitchChannel) return twitchChannel;
    if (kickChannel) return kickChannel;
    return adminTargetStreamerId.toLowerCase();
  }
  const twitchChannel = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
  const kickChannel = (appConfig?.kick?.channel || appConfig?.kick?.username || localStorage.getItem('orbibot_kick_channel') || '').toLowerCase().replace(/^@/, '').replace(/^#/, '').trim();
  const session = getUserSession();
  if (twitchChannel) return twitchChannel;
  if (kickChannel) return kickChannel;
  if (session && session.email) return session.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (session && session.id) return ('user_' + session.id.substring(0, 10)).toLowerCase();
  const token = (appConfig?.security?.widgetToken || localStorage.getItem('orbibot_widget_token') || '').trim();
  if (token) return token.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return 'streamer';
}

function initDashboardMqtt() {
  if (typeof Paho === 'undefined') return;
  const channel = (appConfig?.twitch?.channel || appConfig?.kick?.channel || getActiveStreamerRoom()).toLowerCase().replace(/^#/, '');
  const isConn = isStreamerLoggedIn();

  if (!isConn || !channel) {
    if (dashboardMqttClient) {
      try { dashboardMqttClient.disconnect(); } catch (e) { }
      dashboardMqttClient = null;
    }
    isMqttConnected = false;
    return;
  }

  const clientId = 'orbi_dash_' + Math.random().toString(36).substring(2, 9);
  try {
    if (dashboardMqttClient) {
      try { dashboardMqttClient.disconnect(); } catch (e) { }
    }
    dashboardMqttClient = new Paho.MQTT.Client('broker.emqx.io', 8084, clientId);
    dashboardMqttClient.onConnectionLost = () => {
      isMqttConnected = false;
      setTimeout(initDashboardMqtt, 4000);
    };
    dashboardMqttClient.connect({
      useSSL: true,
      timeout: 6,
      keepAliveInterval: 30,
      onSuccess: () => {
        isMqttConnected = true;
        console.log(`🟢 OrbyxBot Dashboard conectado a Cloud Relay MQTT (#${channel})`);
      },
      onFailure: (err) => {
        isMqttConnected = false;
        console.warn('MQTT Connection failed:', err);
        setTimeout(initDashboardMqtt, 6000);
      }
    });
  } catch (e) {
    console.warn('Error creating MQTT client:', e);
  }
}

function findVoiceCommandOrAlias(firstWord) {
  if (!firstWord || typeof firstWord !== 'string') return null;
  const cleanCmd = firstWord.toLowerCase().trim();
  if (!cleanCmd.startsWith('!')) return null;
  const token = cleanCmd.slice(1).replace(/^[-@/]/, '').replace(/^voice:/, '').trim();
  if (!token) return null;

  // 1. Buscar en comandos cacheados del streamer
  const commands = (typeof cachedTTSCommands !== 'undefined' && Array.isArray(cachedTTSCommands) && cachedTTSCommands.length)
    ? cachedTTSCommands
    : ((typeof appConfig !== 'undefined' && Array.isArray(appConfig?.ttsCommands) && appConfig.ttsCommands.length) ? appConfig.ttsCommands : (typeof DEFAULT_TTS_COMMANDS !== 'undefined' ? DEFAULT_TTS_COMMANDS : []));

  const matched = commands.find(c => c && c.enabled !== false && c.command && c.command.toLowerCase().trim() === cleanCmd);
  if (matched) return matched;

  // 2. Buscar en DEFAULT_TTS_COMMANDS si aún no estaba en la lista local
  if (typeof DEFAULT_TTS_COMMANDS !== 'undefined' && Array.isArray(DEFAULT_TTS_COMMANDS)) {
    const defMatched = DEFAULT_TTS_COMMANDS.find(c => c && c.enabled !== false && c.command && c.command.toLowerCase().trim() === cleanCmd);
    if (defMatched) return defMatched;
  }

  // 3. Catálogo Universal de Alias de Voces
  const aliasMap = {
    // Voces IA / Famosas (Fish Audio)
    messi: 'es_ar_messi', lionel_messi: 'es_ar_messi', leo_messi: 'es_ar_messi',
    maduro: 'es_ve_maduro', nicolas_maduro: 'es_ve_maduro',
    tiktok: 'es_tiktok', voz_tiktok: 'es_tiktok',
    homero: 'es_mx_homero', homero_simpson: 'es_mx_homero', homer: 'es_mx_homero',
    dross: 'es_dross', drossrotzank: 'es_dross',
    badbunny: 'es_badbunny', bad_bunny: 'es_badbunny', benito: 'es_badbunny',
    rubius: 'es_rubius', elrubius: 'es_rubius', el_rubius: 'es_rubius',
    farid: 'es_farid', farid_dieck: 'es_farid',
    westcol: 'es_westcol',
    cr7: 'es_cr7', cristiano: 'es_cr7', cristiano_ronaldo: 'es_cr7', ronaldo: 'es_cr7', bicho: 'es_cr7', siuuu: 'es_cr7',
    goku: 'es_goku', goku_latino: 'es_goku',
    maradona: 'es_maradona', diego_maradona: 'es_maradona',
    xokas: 'es_xokas', elxokas: 'es_xokas', el_xokas: 'es_xokas',
    illojuan: 'es_illojuan', illo_juan: 'es_illojuan', juan: 'es_illojuan',
    auron: 'es_auronplay', auronplay: 'es_auronplay',
    peruano: 'es_peruano',
    closs: 'es_marianocloss', marianocloss: 'es_marianocloss', mariano_closs: 'es_marianocloss',
    lacobra: 'es_lacobra', la_cobra: 'es_lacobra', cobra: 'es_lacobra',
    davo: 'es_davo', davoxeneize: 'es_davo', davo_xeneize: 'es_davo',

    // Voces Estándar / Idiomas
    mia: 'es_mx_mia', miguel: 'es_us_miguel', lupe: 'es_us_lupe', penelope: 'es_us_penelope',
    enrique: 'es_es_enrique', conchita: 'es_es_conchita', lucia: 'es_es_lucia',
    brian: 'en_brian', emma: 'en_emma', joey: 'en_joey', matthew: 'en_matthew',
    kendra: 'en_kendra', justin: 'en_justin', russell: 'en_russell',
    giorgio: 'it_giorgio', hans: 'de_hans', takumi: 'ja_takumi', mizuki: 'ja_mizuki', mathieu: 'fr_mathieu'
  };

  const resolvedVoiceId = aliasMap[token] || (typeof VOICE_PROFILES !== 'undefined' && VOICE_PROFILES[token] ? token : (typeof VOICE_PROFILES !== 'undefined' && VOICE_PROFILES['es_' + token] ? 'es_' + token : null));
  if (resolvedVoiceId) {
    const profile = (typeof VOICE_PROFILES !== 'undefined' && (VOICE_PROFILES[resolvedVoiceId] || VOICE_PROFILES[token])) || {};
    return {
      id: 'tts_auto_' + token,
      voiceId: resolvedVoiceId,
      name: profile.name || token,
      command: cleanCmd,
      permissions: ['todos'],
      enabled: true,
      volume: 90,
      rate: profile.rate || 1.0,
      pitch: profile.pitch || 1.0
    };
  }

  return null;
}

function broadcastEvent(event, data) {
  const room = getActiveStreamerRoom();
  const channel = (appConfig?.twitch?.channel || appConfig?.kick?.channel || room).toLowerCase().replace(/^#/, '');
  const isConn = isStreamerLoggedIn();

  const eventId = data.id || ('evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
  const token = getEffectiveWidgetToken();
  const payload = { id: eventId, event, data, channel: room, room, token, timestamp: Date.now() };

  // 1. BroadcastChannel: emitir en múltiples nombres para asegurar recepción instantánea de widgets
  try {
    const bcNames = new Set(['orbibot_stream_channel', 'orbyxbot_stream_default']);
    if (room && room !== 'default') bcNames.add('orbyxbot_stream_' + room);
    if (token) bcNames.add('orbyxbot_stream_' + token);
    if (channel && channel !== room) bcNames.add('orbyxbot_stream_' + channel);

    bcNames.forEach(name => {
      try {
        const scopedBc = new BroadcastChannel(name);
        scopedBc.postMessage(payload);
        scopedBc.close();
      } catch (e) { }
    });
  } catch (e) { }

  // 2. Storage event con namespace privado por streamer y token
  try {
    localStorage.setItem('orbibot_last_event', JSON.stringify(payload));
    if (room && room !== 'default') {
      localStorage.setItem('orbibot_last_event_' + room, JSON.stringify(payload));
    }
    if (token) {
      localStorage.setItem('orbibot_last_event_' + token, JSON.stringify(payload));
    }
    if (channel && channel !== room) {
      localStorage.setItem('orbibot_last_event_' + channel, JSON.stringify(payload));
    }
  } catch (e) { }

  // 3. Cloud MQTT Relay (aislamiento estricto con token privado por streamer)
  if (isConn && dashboardMqttClient && isMqttConnected) {
    try {
      const msgStr = JSON.stringify(payload);
      const effectiveTopic = token ? `orbibot/${room}_${token}/events` : `orbibot/${room}/events`;
      const msgPriv = new Paho.MQTT.Message(msgStr);
      msgPriv.destinationName = effectiveTopic;
      dashboardMqttClient.send(msgPriv);
      if (channel && channel !== room) {
        const chanTopic = token ? `orbibot/${channel}_${token}/events` : `orbibot/${channel}/events`;
        const msgChan = new Paho.MQTT.Message(msgStr);
        msgChan.destinationName = chanTopic;
        dashboardMqttClient.send(msgChan);
      }
    } catch (e) {
      console.warn('Error publishing to MQTT relay:', e);
    }
  }

  // 4. Local WebSocket Server (si el backend local node server.js está corriendo)
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (e) { }
  }
}

function connectWebSocket() {
  // Listen on BroadcastChannel only for OAuth callbacks
  if (broadcastChannel) {
    broadcastChannel.onmessage = (e) => {
      if (e.data) {
        if (e.data.type === 'TWITCH_AUTH_SUCCESS') {
          handleAuthSuccess(e.data);
          return;
        }
        if (e.data.type === 'KICK_AUTH_SUCCESS') {
          handleKickAuthSuccess(e.data);
          return;
        }
      }
    };
  }

  // Scoped BroadcastChannel listener for this streamer only
  try {
    const room = getActiveStreamerRoom();
    const token = getEffectiveWidgetToken();
    if (room && room !== 'default') {
      const scopedBc = new BroadcastChannel('orbyxbot_stream_' + room);
      scopedBc.onmessage = (e) => {
        if (e.data) handleSocketMessage(e.data);
      };
    }
    if (token) {
      const tokenBc = new BroadcastChannel('orbyxbot_stream_' + token);
      tokenBc.onmessage = (e) => {
        if (e.data) handleSocketMessage(e.data);
      };
    }
  } catch (e) { }

  // Storage event listener aislado por streamer y token
  window.addEventListener('storage', (e) => {
    const room = getActiveStreamerRoom();
    const token = getEffectiveWidgetToken();
    if (room && room !== 'default' && e.key === ('orbibot_last_event_' + room) && e.newValue) {
      try { handleSocketMessage(JSON.parse(e.newValue)); } catch (err) { }
    }
    if (token && e.key === ('orbibot_last_event_' + token) && e.newValue) {
      try { handleSocketMessage(JSON.parse(e.newValue)); } catch (err) { }
    }
    if (e.key === 'orbibot_twitch_auth_event' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        handleAuthSuccess(payload);
      } catch (err) { }
    }
    if (e.key === 'orbibot_kick_auth_event' && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        handleKickAuthSuccess(payload);
      } catch (err) { }
    }
  });

  // WebSocket for backend (works on Render, localhost, or any custom domain; skips only static github.io)
  const isGitHubPages = location.hostname.endsWith('github.io');
  if (!isGitHubPages) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      const room = getActiveStreamerRoom();
      const token = getEffectiveWidgetToken();
      const wsParams = [];
      if (room && room !== 'default') wsParams.push(`channel=${encodeURIComponent(room)}`);
      if (token) wsParams.push(`token=${encodeURIComponent(token)}`);
      const wsQs = wsParams.length ? `?${wsParams.join('&')}` : '';

      socket = new WebSocket(`${protocol}//${location.host}${wsQs}`);

      socket.onopen = () => {
        console.log('Connected to OrbyxBot Server WebSocket (Room: ' + room + ')');
        socket.send(JSON.stringify({ action: 'join', room, channel: room, token }));
        if (browserKickWs) {
          try { browserKickWs.close(); } catch (e) { }
          browserKickWs = null;
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleSocketMessage(msg);
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      socket.onclose = () => {
        setTimeout(connectWebSocket, 3000);
      };
    } catch (e) { }
  }
}

function handleSocketMessage(msg) {
  if (!msg) return;
  const { event, data, room, channel } = msg;

  // IMPORTANT: Never display toasts or execute stream alert audio on the landing page!
  const landingView = document.getElementById('landingView');
  const isLandingActive = landingView && landingView.style.display !== 'none';
  if (isLandingActive) {
    if (event === 'init_state' || event === 'bot_status') {
      if (data?.botStatus) updateBotStatusUI(data.botStatus);
      else if (data) updateBotStatusUI(data);
    }
    return;
  }

  // Room verification: Asegurar aislamiento estricto por streamer
  const myRoom = (getActiveStreamerRoom() || '').toLowerCase().replace(/^#/, '').trim();
  const myToken = getEffectiveWidgetToken();
  const targetRoom = (room || channel || data?.channel || data?.room || '').toLowerCase().replace(/^#/, '').trim();
  const targetToken = (msg.token || data?.token || '').trim();

  if (targetRoom && targetRoom !== 'default' && myRoom && myRoom !== 'default' && targetRoom !== myRoom && targetRoom !== myToken) {
    return;
  }
  if (targetRoom === 'default' && myRoom && myRoom !== 'default') {
    return;
  }
  if (myToken && targetToken && targetToken !== myToken) {
    return;
  }

  if (event === 'init_state') {
    if (data.botStatus) updateBotStatusUI(data.botStatus);
    if (data.srState) updateSongRequestUI(data.srState);
  } else if (event === 'bot_status') {
    updateBotStatusUI(data);
  } else if (event === 'chat_message') {
    appendChatMessage(data);
  } else if (event === 'sr_update') {
    updateSongRequestUI(data.state || data);
    if (data.action === 'play' && data.data) {
      playYouTubeSong(data.data.videoId);
    } else if (data.action === 'pause') {
      if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    } else if (data.action === 'resume') {
      if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
    }
  } else if (event === 'sr_play' || event === 'sr_resume') {
    if (data && data.videoId) {
      playYouTubeSong(data.videoId);
    } else if (ytPlayer && ytPlayer.playVideo) {
      ytPlayer.playVideo();
    }
  } else if (event === 'sr_pause') {
    if (ytPlayer && ytPlayer.pauseVideo) {
      ytPlayer.pauseVideo();
    }
  } else if (event === 'alert') {
    const alertType = data.type ? data.type.toUpperCase().replace('_', ' ') : 'EVENTO';
    showToast(`🔔 Alerta en OBS: ${alertType} de ${data.user || 'Espectador'}`, 'info');
  } else if (event === 'tts') {
    console.log('TTS triggered in dashboard:', data);
    if (data && typeof renderTTSQueue === 'function') {
      if (!cachedTTSQueue.queue) cachedTTSQueue.queue = [];
      const exists = cachedTTSQueue.queue.some(q => q.id === data.id);
      if (!exists) {
        cachedTTSQueue.queue.push(data);
        renderTTSQueue(cachedTTSQueue);
      }
    }
  } else if (event === 'tts_control') {
    if (data && typeof renderTTSQueue === 'function') {
      if (data.action === 'reset' || data.action === 'clear') {
        cachedTTSQueue.queue = [];
        renderTTSQueue(cachedTTSQueue);
      } else if (data.action === 'skip') {
        if (cachedTTSQueue.queue && cachedTTSQueue.queue.length > 0) {
          cachedTTSQueue.queue.shift();
          renderTTSQueue(cachedTTSQueue);
        }
      } else if (data.action === 'item_removed' && data.id) {
        if (cachedTTSQueue.queue) {
          cachedTTSQueue.queue = cachedTTSQueue.queue.filter(i => i.id !== data.id);
          renderTTSQueue(cachedTTSQueue);
        }
      }
      if (Array.isArray(data.queue)) {
        cachedTTSQueue.queue = data.queue;
        renderTTSQueue(cachedTTSQueue);
      }
    }
  } else if (event === 'tts_queue_update') {
    if (data && Array.isArray(data.queue) && typeof renderTTSQueue === 'function') {
      cachedTTSQueue.queue = data.queue;
      renderTTSQueue(cachedTTSQueue);
    }
  } else if (event === 'tts_commands_updated') {
    if (Array.isArray(data)) {
      cachedTTSCommands = data;
      renderTTSCommands(data);
    }
  } else if (event === 'tts_catalog_updated') {
    if (Array.isArray(data)) {
      renderVoiceLibrary(data);
    }
  } else if (event === 'goal_update' || event === 'goals_updated') {
    if (event === 'goals_updated' && Array.isArray(data)) {
      localStorage.setItem('orbibot_goals', JSON.stringify(data));
      if (typeof renderGoals === 'function') renderGoals(data);
    } else if (event === 'goal_update') {
      try {
        let goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
        const targetGoal = data.goal || data;
        const targetId = data.goalId || targetGoal.id;
        const idx = goals.findIndex(g => g.id === targetId || (g.type && g.type === data.type));
        if (idx !== -1) {
          goals[idx] = { ...goals[idx], ...targetGoal };
          localStorage.setItem('orbibot_goals', JSON.stringify(goals));
          if (typeof renderGoals === 'function') renderGoals(goals);
        }
      } catch(e) {}
    }
  }
}

// ================= LOAD DATA =================
async function loadStandaloneData() {
  const session = getUserSession();
  if (!session || !session.email) {
    const defaultCfg = getFreshDefaultConfig();
    appConfig = defaultCfg;
    bindConfigToUI(defaultCfg);
    renderCommands([]);
    renderRewards([]);
    if (typeof renderGoals === 'function') renderGoals([]);
    updateSongRequestUI({ currentSong: null, queue: [], isPlaying: false });
    updatePlatformLinkingUI();
    populateWidgetUrls();
    return;
  }

  // Load from localStorage for the active session
  const localTwitch = localStorage.getItem('orbibot_twitch_auth');
  const localKick = localStorage.getItem('orbibot_kick_auth');
  const localCfg = localStorage.getItem('orbibot_config');
  const localCmds = localStorage.getItem('orbibot_commands');
  const localRwds = localStorage.getItem('orbibot_rewards');
  const localGoals = localStorage.getItem('orbibot_goals');

  let twitchData = localTwitch ? JSON.parse(localTwitch) : {
    channel: '',
    botUsername: '',
    oauthToken: '',
    clientId: 'yw1vr664ichms8an2x5lhji58v7ozk',
    connected: false
  };

  const chan = (twitchData.channel || twitchData.login || (twitchData.displayName ? twitchData.displayName.toLowerCase() : '') || '').replace(/^#/, '');
  if (chan) {
    twitchData.channel = chan;
    twitchData.connected = true;
  }

  let kickData = null;
  try {
    kickData = localKick ? JSON.parse(localKick) : null;
  } catch (e) { }

  let cfg = localCfg ? JSON.parse(localCfg) : getFreshDefaultConfig();

  cfg.twitch = { ...(cfg.twitch || {}), ...twitchData };
  if (kickData) {
    cfg.kick = { ...(cfg.kick || {}), ...kickData };
  }
  appConfig = cfg;
  bindConfigToUI(cfg);

  renderCommands(localCmds ? JSON.parse(localCmds) : []);
  renderRewards(localRwds !== null ? JSON.parse(localRwds) : []);
  renderGoals(localGoals ? JSON.parse(localGoals) : []);

  updateSongRequestUI({ currentSong: null, queue: [], isPlaying: false });
  updatePlatformLinkingUI();
  populateWidgetUrls();
  await loadSounds();

  // In-browser Twitch IRC connection (solo si hay canal explícito)
  if (twitchData.channel && window.tmi && (!browserTmiClient || browserTmiClient.readyState() !== 'OPEN')) {
    connectInBrowserTwitchBot(twitchData);
  }
  if (kickData && (kickData.channel || kickData.username) && typeof connectInBrowserKickBot === 'function') {
    connectInBrowserKickBot(kickData);
  }
}

async function loadInitialData() {
  const isStaticHosting = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
  if (isStaticHosting) {
    console.log('⚡ OrbyxBot funcionando en modo Standalone / GitHub Pages.');
    await loadStandaloneData();
    return;
  }

  const session = getUserSession();
  if (!session || !session.email) {
    const defaultCfg = getFreshDefaultConfig();
    appConfig = defaultCfg;
    bindConfigToUI(defaultCfg);
    renderCommands([]);
    renderRewards([]);
    if (typeof renderGoals === 'function') renderGoals([]);
    updateSongRequestUI({ currentSong: null, queue: [], isPlaying: false });
    updatePlatformLinkingUI();
    populateWidgetUrls();
    return;
  }

  // Prioridad Absoluta de Aislamiento: Si el usuario tiene sesión activa y Supabase está configurado,
  // cargar exclusivamente sus datos privados desde Supabase para evitar contaminar con datos globales del backend.
  if (supabaseClient) {
    try {
      await loadUserDataFromSupabase(session.email);
      return;
    } catch (sbErr) {
      console.warn('⚠️ [loadInitialData] Error al cargar desde Supabase, intentando fallback:', sbErr);
    }
  }

  try {
    const streamerRoom = getActiveStreamerRoom();
    const [cfgRes, cmdRes, rwdRes, srRes, goalsRes] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/commands').then(r => r.json()),
      fetch('/api/rewards').then(r => r.json()),
      fetch(`/api/sr/state?channel=${encodeURIComponent(streamerRoom)}`).then(r => r.json()),
      fetch('/api/goals').then(r => r.json()).catch(() => [])
    ]);

    // Sync localStorage Twitch auth if present for active session
    const localTwitch = localStorage.getItem('orbibot_twitch_auth');
    let effectiveTwitch = cfgRes.twitch || {};
    if (localTwitch) {
      try {
        const parsed = JSON.parse(localTwitch);
        const chan = (parsed.channel || parsed.login || (parsed.displayName ? parsed.displayName.toLowerCase() : '') || '').replace(/^#/, '');
        if (chan) {
          parsed.channel = chan;
          parsed.connected = true;
          effectiveTwitch = { ...effectiveTwitch, ...parsed };
          cfgRes.twitch = effectiveTwitch;
          if (parsed.oauthToken) {
            fetch('/api/auth/twitch-token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: parsed.oauthToken, channel: chan })
            }).catch(() => { });
          }
        }
      } catch (e) { }
    }

    let effectiveCommands = Array.isArray(cmdRes) ? cmdRes : [];
    let effectiveRewards = Array.isArray(rwdRes) ? rwdRes : [];
    let effectiveGoals = Array.isArray(goalsRes) ? goalsRes : [];

    // Deduplicate rewards by name
    const seenRwds = new Set();
    const cleanRwds = [];
    for (const r of effectiveRewards) {
      const k = (r.rewardName || r.name || r.id || '').trim().toLowerCase();
      if (k && !seenRwds.has(k)) {
        seenRwds.add(k);
        cleanRwds.push(r);
      }
    }
    effectiveRewards = cleanRwds;

    localStorage.setItem('orbibot_commands', JSON.stringify(effectiveCommands));
    localStorage.setItem('orbibot_rewards', JSON.stringify(effectiveRewards));
    localStorage.setItem('orbibot_goals', JSON.stringify(effectiveGoals));

    appConfig = cfgRes;
    bindConfigToUI(cfgRes);
    renderCommands(effectiveCommands);
    renderRewards(effectiveRewards);
    renderGoals(effectiveGoals);
    updateSongRequestUI(srRes);
    updatePlatformLinkingUI();
    populateWidgetUrls();
    await loadSounds();

    if (effectiveTwitch.channel && window.tmi && (!browserTmiClient || browserTmiClient.readyState() !== 'OPEN')) {
      connectInBrowserTwitchBot(effectiveTwitch);
    }
  } catch (err) {
    console.warn('Backend API not reachable. Falling back to standalone mode:', err);
    await loadStandaloneData();
  }
}

// In-Browser Twitch Bot for GitHub Pages
let browserTmiClient = null;
function connectInBrowserTwitchBot(twitchData) {
  if (!window.tmi || !twitchData) return;
  const rawChannel = twitchData.channel || twitchData.login || (twitchData.displayName ? twitchData.displayName.toLowerCase() : '');
  const channel = (rawChannel || '').toLowerCase().replace(/^#/, '');
  if (!channel) return;

  if (browserTmiClient) {
    try { browserTmiClient.disconnect(); } catch (e) { }
  }

  const opts = {
    options: { debug: false },
    connection: { reconnect: true, secure: true },
    channels: [channel]
  };

  if (twitchData.oauthToken) {
    const token = twitchData.oauthToken.startsWith('oauth:') ? twitchData.oauthToken : `oauth:${twitchData.oauthToken}`;
    opts.identity = {
      username: twitchData.botUsername || channel,
      password: token
    };
  }

  updateBotStatusUI({ status: 'connecting', channel });

  function setupClient(client) {
    client.on('connected', () => {
      updateBotStatusUI({ status: 'connected', channel });
      const statChan = document.getElementById('statChannelName');
      if (statChan) statChan.innerText = `#${channel}`;
      const notice = document.getElementById('chatStatusNotice');
      if (notice) notice.innerText = `🟢 En línea (#${channel})`;
      const chatContainer = document.getElementById('liveChatMessages');
      if (chatContainer && chatContainer.innerText.includes('Conecta tu canal de Twitch')) {
        chatContainer.innerHTML = `<div class="chat-msg-row" style="color: var(--cyan-accent);"><em>🟢 Conectado al chat de #${channel}. Esperando mensajes...</em></div>`;
      }
      showToast(`Conectado al chat de #${channel}`, 'success');
    });

    client.on('message', (ch, tags, message, self) => {
      if (self) return;
      const username = tags['display-name'] || tags.username;
      const isMod = tags.mod || tags.badges?.broadcaster === '1';
      const isSub = tags.subscriber || tags.badges?.subscriber !== undefined;
      const userColor = tags.color || '#9146ff';

      const chatData = {
        id: tags.id || Date.now().toString(),
        user: username,
        color: userColor,
        message,
        isMod,
        isSub,
        badges: tags.badges || {},
        badgesRaw: tags['badges-raw'] || null,
        emotes: tags.emotes || null,
        roomId: tags['room-id'] || null
      };

      appendChatMessage(chatData);
      broadcastEvent('chat_message', chatData);

      // Bits
      if (tags.bits) {
        const bitCount = parseInt(tags.bits, 10);
        const alertData = { type: 'bits', user: username, amount: bitCount, message };
        broadcastEvent('alert', alertData);
        showToast(`¡${username} donó ${bitCount} bits!`, 'success');
      }

      // Puntos de Canal (Twitch Channel Points) con texto
      if (tags['custom-reward-id']) {
        handleBrowserChannelPointRedemption(tags['custom-reward-id'], username, message);
        return;
      }

      // Procesamiento de comandos TTS desde el chat de Twitch en cliente de navegador
      try {
        const currentCfg = JSON.parse(localStorage.getItem('orbibot_config') || '{}');
        const ttsCfg = currentCfg.tts || {};
        const isBroadcaster = Boolean(tags.badges?.broadcaster === '1' || tags.username === channel.toLowerCase());
        const isModOrBroadcaster = isMod || isBroadcaster;
        const firstWord = message.trim().split(' ')[0].toLowerCase();
        const trimmed = message.trim();

        if (ttsCfg.enabled !== false && ttsCfg.allowChatCommand !== false) {
          const ttsCmd = (ttsCfg.chatCommand || '!tts').toLowerCase();
          const matchedVoiceCmd = findVoiceCommandOrAlias(firstWord);

          if (firstWord === '!ttsdetener' || firstWord === '!ttsstop' || firstWord === '!ttspause') {
            if (isModOrBroadcaster) {
              broadcastEvent('tts_control', { action: 'stop', channel });
              return;
            }
          }
          if (firstWord === '!ttsreiniciar' || firstWord === '!ttsreset' || firstWord === '!ttsclear') {
            if (isModOrBroadcaster) {
              broadcastEvent('tts_control', { action: 'reset', channel });
              return;
            }
          }
          if (firstWord === '!ttsskip' || firstWord === '!ttssaltar') {
            if (isModOrBroadcaster) {
              broadcastEvent('tts_control', { action: 'skip', channel });
              return;
            }
          }

          if (trimmed.toLowerCase().startsWith(ttsCmd)) {
            let ttsRaw = trimmed.slice(ttsCmd.length).trim();
            if (ttsRaw) {
              let selectedVoice = ttsCfg.voice || 'es_mx_mia';
              const firstToken = ttsRaw.split(/\s+/)[0].toLowerCase().replace(/^[-@/]/, '').replace(/^voice:/, '');
              const aliasMap = {
                messi: 'es_ar_messi', maduro: 'es_ve_maduro', tiktok: 'es_tiktok', homero: 'es_mx_homero',
                dross: 'es_dross', badbunny: 'es_badbunny', rubius: 'es_rubius', farid: 'es_farid',
                westcol: 'es_westcol', cr7: 'es_cr7', goku: 'es_goku', maradona: 'es_maradona',
                xokas: 'es_xokas', illojuan: 'es_illojuan', auron: 'es_auronplay', peruano: 'es_peruano',
                closs: 'es_marianocloss', lacobra: 'es_lacobra', davo: 'es_davo', mia: 'es_mx_mia',
                miguel: 'es_us_miguel', brian: 'en_brian'
              };
              if (aliasMap[firstToken] || (typeof SE_VOICE_MAP !== 'undefined' && SE_VOICE_MAP[firstToken]) || (typeof VOICE_PROFILES !== 'undefined' && VOICE_PROFILES[firstToken])) {
                selectedVoice = aliasMap[firstToken] || firstToken;
                ttsRaw = ttsRaw.slice(ttsRaw.indexOf(' ') + 1).trim();
              }
              if (ttsRaw) {
                const ttsAudioUrl = getTTSAudioUrl(ttsRaw, selectedVoice);
                const ttsData = {
                  id: 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                  user: username,
                  text: ttsRaw,
                  voice: selectedVoice,
                  volume: Number(ttsCfg.volume !== undefined ? ttsCfg.volume : 90) / 100,
                  rate: Number(ttsCfg.rate || 1.0),
                  pitch: Number(ttsCfg.pitch || 1.0),
                  audioUrl: ttsAudioUrl,
                  channel,
                  platform: 'twitch',
                  timestamp: Date.now()
                };
                broadcastEvent('tts', ttsData);
                return;
              }
            }
          } else if (matchedVoiceCmd) {
            const userBadges = { isMod, isSub, vip: Boolean(tags.badges?.vip), broadcaster: isBroadcaster };
            const allowed = !matchedVoiceCmd.permissions || matchedVoiceCmd.permissions.includes('todos') ||
              (userBadges.broadcaster && matchedVoiceCmd.permissions.includes('broadcaster')) ||
              (userBadges.isMod && matchedVoiceCmd.permissions.includes('mod')) ||
              (userBadges.isSub && matchedVoiceCmd.permissions.includes('sub')) ||
              (userBadges.vip && matchedVoiceCmd.permissions.includes('vip'));

            if (allowed) {
              const voiceText = trimmed.slice(firstWord.length).trim();
              if (voiceText) {
                const selectedVoice = matchedVoiceCmd.voiceId || ttsCfg.voice || 'es_mx_mia';
                const ttsAudioUrl = getTTSAudioUrl(voiceText, selectedVoice);
                const ttsData = {
                  id: 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                  user: username,
                  text: voiceText,
                  voice: selectedVoice,
                  volume: Number(matchedVoiceCmd.volume !== undefined ? matchedVoiceCmd.volume : (ttsCfg.volume || 90)) / 100,
                  rate: Number(matchedVoiceCmd.rate || ttsCfg.rate || 1.0),
                  pitch: Number(matchedVoiceCmd.pitch || ttsCfg.pitch || 1.0),
                  audioUrl: ttsAudioUrl,
                  channel,
                  platform: 'twitch',
                  timestamp: Date.now()
                };
                broadcastEvent('tts', ttsData);
                return;
              }
            }
          }
        }

        // Procesamiento de comandos de Song Request desde el chat en cliente de navegador
        const srCfg = currentCfg.songRequest || {};
        const srPrefix = (srCfg.prefix || '!sr').toLowerCase();

        if (srCfg.enabled !== false) {
          if (firstWord === '!srpausa' || firstWord === '!srpause' || firstWord === '!pausa' || firstWord === '!pause') {
            if (isModOrBroadcaster) {
              fetch('/api/sr/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel, by: username })
              }).catch(() => {});
              if (typeof togglePausePlaySongRequest === 'function') {
                const state = currentSrState || getLocalSrState();
                if (state.isPlaying !== false) togglePausePlaySongRequest();
              }
            }
            return;
          }

          if (firstWord === '!srplay' || firstWord === '!srresume' || firstWord === '!srreanudar' || firstWord === '!reanudar' || firstWord === '!resume') {
            if (isModOrBroadcaster) {
              fetch('/api/sr/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel, by: username })
              }).catch(() => {});
              if (typeof togglePausePlaySongRequest === 'function') {
                const state = currentSrState || getLocalSrState();
                if (state.isPlaying === false) togglePausePlaySongRequest();
              }
            }
            return;
          }

          if (firstWord === '!skip' || firstWord === '!saltar') {
            if (isModOrBroadcaster && typeof skipCurrentSong === 'function') {
              skipCurrentSong();
            }
            return;
          }

          if (message.trim().toLowerCase().startsWith(srPrefix)) {
            const q = message.trim().slice(srPrefix.length).trim();
            if (q) {
              fetch('/api/sr/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q, requester: username, isMod: isModOrBroadcaster, isSub, channel })
              }).then(r => {
                if (!r.ok && typeof handleClientSongRequest === 'function') {
                  handleClientSongRequest(q, username, false);
                }
              }).catch(() => {
                if (typeof handleClientSongRequest === 'function') {
                  handleClientSongRequest(q, username, false);
                }
              });
            }
          }
        }
      } catch (e) { }
    });

    // Capturar canjes de Puntos de Canal sin texto vía raw_message / USERNOTICE
    client.on('raw_message', (raw) => {
      try {
        if (raw && raw.raw && raw.raw.includes('custom-reward-id=')) {
          const rewardMatch = raw.raw.match(/custom-reward-id=([^;\s]+)/);
          if (rewardMatch) {
            const customRewardId = rewardMatch[1];
            const userMatch = raw.raw.match(/display-name=([^;\s]+)/) || raw.raw.match(/login=([^;\s]+)/);
            const username = userMatch ? decodeURIComponent(userMatch[1]) : (raw.tags?.['display-name'] || raw.tags?.username || 'Espectador');
            const msgMatch = raw.raw.match(/USERNOTICE\s+#[^\s]+\s+:(.*)$/);
            const userMsg = msgMatch ? msgMatch[1] : '';
            handleBrowserChannelPointRedemption(customRewardId, username, userMsg);
          }
        }
      } catch (e) { }
    });

    client.on('usernotice', (msgId, ch, tags, msg) => {
      try {
        const customRewardId = tags?.['custom-reward-id'];
        if (customRewardId) {
          const username = tags['display-name'] || tags.username || 'Espectador';
          handleBrowserChannelPointRedemption(customRewardId, username, msg || '');
        }
      } catch (e) { }
    });

    client.on('reconnect', () => {
      updateBotStatusUI({ status: 'connecting', channel });
      console.log(`[Browser IRC] 🔄 Reconectando con #${channel}...`);
    });

    client.on('disconnected', (reason) => {
      console.warn(`[Browser IRC] ⚠️ Desconectado (${reason}). Reintentando conexión...`);
      const isStillConnected = Boolean((appConfig?.twitch?.channel || localStorage.getItem('orbibot_twitch_auth')) && (appConfig?.twitch?.connected !== false));
      if (isStillConnected) {
        updateBotStatusUI({ status: 'connecting', channel });
        setTimeout(() => {
          if (window.tmi && isStillConnected) {
            connectInBrowserTwitchBot(twitchData);
          }
        }, 4000);
      } else {
        updateBotStatusUI({ status: 'disconnected' });
      }
    });
  }

  browserTmiClient = new window.tmi.Client(opts);
  setupClient(browserTmiClient);

  browserTmiClient.connect().then(() => {
    if (twitchData && twitchData.userId && twitchData.clientId && twitchData.oauthToken) {
      connectBrowserEventSub(twitchData.userId, twitchData.clientId, twitchData.oauthToken);
    }
  }).catch(e => {
    console.warn('IRC authed connection failed, falling back to anonymous read-only:', e);
    try {
      delete opts.identity;
      browserTmiClient = new window.tmi.Client(opts);
      setupClient(browserTmiClient);
      browserTmiClient.connect().then(() => {
        if (twitchData && twitchData.userId && twitchData.clientId && twitchData.oauthToken) {
          connectBrowserEventSub(twitchData.userId, twitchData.clientId, twitchData.oauthToken);
        }
      }).catch(err => {
        updateBotStatusUI({ status: 'connected', channel });
      });
    } catch (err) {
      updateBotStatusUI({ status: 'connected', channel });
    }
  });
}

let browserEventSubWs = null;
let activeBrowserEventSubUserId = null;

function connectBrowserEventSub(userId, clientId, token) {
  if (!userId || !clientId || !token) return;
  if (typeof WebSocket === 'undefined') return;

  if (browserEventSubWs && (browserEventSubWs.readyState === 1 || browserEventSubWs.readyState === 0) && activeBrowserEventSubUserId === userId) {
    return;
  }

  if (browserEventSubWs) {
    try { browserEventSubWs.close(); } catch(e){}
    browserEventSubWs = null;
  }
  activeBrowserEventSubUserId = userId;

  try {
    const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
    browserEventSubWs = ws;

    ws.onopen = () => {
      console.log('[Dashboard EventSub] 🟢 Conectado a Twitch EventSub WebSocket en navegador.');
    };

    ws.onmessage = async (event) => {
      try {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString();
        const msg = JSON.parse(raw);

        if (msg.metadata && msg.metadata.message_type === 'session_welcome') {
          const sessionId = msg.payload.session.id;
          const cleanToken = token.replace(/^oauth:/i, '').trim();

          const subRes = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST',
            headers: {
              'Client-Id': clientId,
              'Authorization': `Bearer ${cleanToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              type: 'channel.channel_points_custom_reward_redemption.add',
              version: '1',
              condition: { broadcaster_user_id: userId },
              transport: {
                method: 'websocket',
                session_id: sessionId
              }
            })
          });

          if (subRes.ok) {
            console.log('[Dashboard EventSub] ✅ Suscripción a Puntos de Canal activa en vivo.');
          } else {
            const errData = await subRes.json().catch(() => ({}));
            console.warn('[Dashboard EventSub] Subscription info:', errData.message || subRes.statusText);
          }
        } else if (msg.metadata && msg.metadata.message_type === 'notification') {
          const ev = msg.payload?.event;
          if (ev && ev.reward) {
            console.log(`[Dashboard EventSub] 🎁 Canje detectado: "${ev.reward.title}" por @${ev.user_name || ev.user_login}`);
            handleBrowserChannelPointRedemption(ev.reward.id, ev.user_name || ev.user_login || 'Espectador', ev.user_input || '', ev.reward.title || '');
          }
        }
      } catch (err) {
        console.warn('[Dashboard EventSub] Error procesando mensaje:', err.message);
      }
    };

    ws.onclose = () => {
      browserEventSubWs = null;
      const currentCfg = (typeof appConfig !== 'undefined' && appConfig) ? appConfig : {};
      const tCfg = currentCfg.twitch || {};
      if (tCfg.connected && tCfg.userId && tCfg.clientId && tCfg.oauthToken) {
        setTimeout(() => connectBrowserEventSub(tCfg.userId, tCfg.clientId, tCfg.oauthToken), 10000);
      }
    };

    ws.onerror = (err) => {
      console.warn('[Dashboard EventSub] WebSocket error:', err?.message || err);
    };
  } catch(e) {
    console.warn('[Dashboard EventSub] No se pudo inicializar WebSocket:', e.message);
  }
}
window.connectBrowserEventSub = connectBrowserEventSub;

let browserRecentRedemptions = new Set();
async function handleBrowserChannelPointRedemption(customRewardId, username, message = '', rewardTitle = '') {
  let rewards = [];
  try {
    rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
  } catch(e) {}

  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  let matchedReward = rewards.find(r => r.enabled && (
    (r.rewardId && customRewardId && r.rewardId.toLowerCase() === customRewardId.toLowerCase()) ||
    (r.id && customRewardId && r.id.toLowerCase() === customRewardId.toLowerCase()) ||
    (rewardTitle && r.rewardName && norm(r.rewardName) === norm(rewardTitle))
  ));

  // Si no coincide directamente, buscar por cachedTwitchHelixRewards
  if (!matchedReward && customRewardId && typeof cachedTwitchHelixRewards !== 'undefined' && Array.isArray(cachedTwitchHelixRewards)) {
    const helixMatch = cachedTwitchHelixRewards.find(tr => tr.id === customRewardId);
    if (helixMatch) {
      matchedReward = rewards.find(r => r.enabled && norm(r.rewardName) === norm(helixMatch.title));
      if (matchedReward) {
        matchedReward.rewardId = customRewardId;
        localStorage.setItem('orbibot_rewards', JSON.stringify(rewards));
      }
    }
  }

  // Si la recompensa requiere texto del usuario (Song Request o TTS sin plantilla fija) y viene vacía
  // (típico del evento USERNOTICE previo a PRIVMSG), NO deduplicar ni procesar: esperamos al evento PRIVMSG
  const isTextAction = matchedReward && (
    matchedReward.action === 'song_request' || 
    (matchedReward.action === 'tts' && !matchedReward.customMessage)
  );
  const cleanMsg = (message || '').trim();
  if (isTextAction && !cleanMsg) {
    console.log(`[Dashboard] ⏳ Canje de "${matchedReward.rewardName}" detectado sin texto aún. Esperando mensaje del chat...`);
    return;
  }

  const dedupeKey = `${customRewardId || rewardTitle}_${username}_${Math.floor(Date.now() / 2500)}`;
  if (browserRecentRedemptions.has(dedupeKey)) return;
  browserRecentRedemptions.add(dedupeKey);
  setTimeout(() => browserRecentRedemptions.delete(dedupeKey), 10000);

  if (matchedReward && matchedReward.enabled) {
    console.log(`[Dashboard] 🎁 Canje procesado: "${matchedReward.rewardName}" (${matchedReward.action}) por @${username}`);
    if (matchedReward.action === 'sound') {
      const soundUrl = matchedReward.soundUrl || './assets/sounds/airhorn.mp3';
      broadcastEvent('alert', {
        type: 'sound',
        user: username,
        soundUrl: soundUrl,
        reward: matchedReward.rewardName || 'Efecto de Sonido',
        message
      });
      previewSound(soundUrl);
      showToast(`🔊 @${username} canjeó sonido: "${matchedReward.rewardName}"`, 'success');
      return;
    } else if (matchedReward.action === 'tts') {
      const ttsConfig = (appConfig?.tts) || {};
      if (ttsConfig.enabled === false) {
        console.log('[Dashboard] TTS desactivado en la configuración. Omitiendo TTS de canje.');
        return;
      }
      const voice = matchedReward.voiceId || matchedReward.voice || ttsConfig.voice || 'es_mx_mia';

      let textToSpeak = (matchedReward.customMessage || '').trim();
      if (textToSpeak) {
        textToSpeak = textToSpeak
          .replace(/\{user\}|\{usuario\}|\{name\}/gi, username)
          .replace(/\{message\}|\{mensaje\}|\{input\}|\{texto\}/gi, cleanMsg || '')
          .replace(/\{reward\}|\{recompensa\}/gi, matchedReward.rewardName || 'Recompensa')
          .trim();
      } else {
        textToSpeak = cleanMsg || `¡${username} ha canjeado ${matchedReward.rewardName}!`;
      }
      if (!textToSpeak) return;

      // Si el servidor backend está activo, el servidor ya procesa el TTS
      // No emitir desde el navegador para evitar doble reproducción en OBS
      if (socket && socket.readyState === 1) {
        console.log('[Dashboard] Canje de TTS procesado por el bot del servidor.');
        return;
      }

      const ttsData = {
        id: 'tts_' + Date.now(),
        user: username,
        text: textToSpeak,
        voice,
        voiceOverride: voice,
        source: 'channel_points',
        volume: Number(ttsConfig.volume !== undefined ? ttsConfig.volume : 90) / 100,
        audioUrl: getTTSAudioUrl(textToSpeak, voice),
        timestamp: Date.now()
      };
      broadcastEvent('tts', ttsData);
      return;
    } else if (matchedReward.action === 'song_request') {
      const songQuery = cleanMsg;
      if (!songQuery) return;

      let addedViaBackend = false;
      try {
        const res = await fetch('/api/sr/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: songQuery, requester: username, isPriority: true })
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.success) {
            addedViaBackend = true;
            showToast(`🌟 [VIP] @${username} pidió canción: ${data.song?.title || songQuery}`, 'success');
          }
        }
      } catch(e) {}

      // Si falla la API backend o estamos en GitHub Pages, procesar localmente
      if (!addedViaBackend && typeof handleClientSongRequest === 'function') {
        handleClientSongRequest(songQuery, username, true);
      }

      broadcastEvent('alert', {
        type: 'channel_points',
        user: username,
        reward: matchedReward.rewardName || 'Pedir Canción VIP',
        message: songQuery
      });
      return;
    }
  } else {
    broadcastEvent('alert', {
      type: 'channel_points',
      user: username,
      reward: rewardTitle || 'Puntos de Canal',
      message
    });
  }
}

// ================= IN-BROWSER KICK CHAT LISTENER =================
let browserKickWs = null;

function connectInBrowserKickBot(kickData) {
  const channel = (kickData?.channel || kickData?.username || localStorage.getItem('orbibot_kick_channel') || '').toLowerCase().replace(/^@/, '').trim();
  if (!channel) return;

  const isGitHubPages = location.hostname.endsWith('github.io');
  const isBackendRunning = !isGitHubPages && socket && socket.readyState === 1;

  if (browserKickWs) {
    try { browserKickWs.close(); } catch (e) { }
    browserKickWs = null;
  }

  // Si el backend de Node está activo, el servidor ya maneja Kick con kickBot.js para evitar doble ejecución
  if (isBackendRunning) {
    return;
  }

  const pusherUrl = 'wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false';

  async function startKickSocket() {
    let chatroomId = null;
    try {
      const res = await fetch(`/api/kick/chatroom/${channel}`);
      if (res.ok) {
        const d = await res.json();
        chatroomId = d.chatroomId;
      }
    } catch (e) { }

    const targetRoom = chatroomId || kickData?.userId || channel;
    try {
      browserKickWs = new WebSocket(pusherUrl);
      browserKickWs.onopen = () => {
        browserKickWs.send(JSON.stringify({
          event: 'pusher:subscribe',
          data: { auth: '', channel: `chatrooms.${targetRoom}.v2` }
        }));
        browserKickWs.send(JSON.stringify({
          event: 'pusher:subscribe',
          data: { auth: '', channel: `channel.${targetRoom}` }
        }));
        console.log(`🟢 [Dashboard] Conectado al chat y eventos de Kick @${channel} (Room: ${targetRoom})`);
      };

      browserKickWs.onmessage = (ev) => {
        if (socket && socket.readyState === 1) {
          try { browserKickWs.close(); } catch(e) {}
          browserKickWs = null;
          return;
        }
        try {
          const pkt = JSON.parse(ev.data);
          if (pkt.event === 'App\\Events\\ChatMessageEvent' || pkt.event === 'ChatMessageEvent') {
            const msgData = typeof pkt.data === 'string' ? JSON.parse(pkt.data) : pkt.data;
            const sender = msgData.sender || {};
            const badges = sender.identity?.badges || [];
            const username = sender.username || sender.slug || 'KickUser';
            const color = sender.identity?.color || '#53fc18';
            const message = msgData.content || '';

            const isBroadcaster = badges.some(b => b.type === 'broadcaster') || (username.toLowerCase() === channel.toLowerCase());
            const isMod = badges.some(b => b.type === 'moderator') || isBroadcaster;
            const isSub = badges.some(b => b.type === 'subscriber' || b.type === 'sub_gifter');
            const isModOrBroadcaster = isMod || isBroadcaster;

            const chatData = {
              id: msgData.id || `kick-${Date.now()}`,
              platform: 'kick',
              user: username,
              color,
              message,
              isMod,
              isSub,
              badges,
              emotes: null,
              channel
            };

            appendChatMessage(chatData);
            broadcastEvent('chat_message', chatData);

            const trimmed = message.trim();
            const firstWord = trimmed.split(' ')[0].toLowerCase();
            const currentCfg = JSON.parse(localStorage.getItem('orbibot_config') || '{}');

            // 1. PROCESAMIENTO DE SONG REQUEST EN KICK
            const srCfg = currentCfg.songRequest || appConfig?.songRequest || {};
            const srPrefix = (srCfg.prefix || '!sr').toLowerCase();
            if (srCfg.enabled !== false) {
              if (firstWord === '!srpausa' || firstWord === '!srpause' || firstWord === '!pausa' || firstWord === '!pause') {
                if (isModOrBroadcaster) {
                  fetch('/api/sr/pause', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, by: username })
                  }).catch(() => {});
                  if (typeof togglePausePlaySongRequest === 'function') {
                    const state = currentSrState || getLocalSrState();
                    if (state.isPlaying !== false) togglePausePlaySongRequest();
                  }
                }
                return;
              }

              if (firstWord === '!srplay' || firstWord === '!srresume' || firstWord === '!srreanudar' || firstWord === '!reanudar' || firstWord === '!resume') {
                if (isModOrBroadcaster) {
                  fetch('/api/sr/resume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, by: username })
                  }).catch(() => {});
                  if (typeof togglePausePlaySongRequest === 'function') {
                    const state = currentSrState || getLocalSrState();
                    if (state.isPlaying === false) togglePausePlaySongRequest();
                  }
                }
                return;
              }

              if (firstWord === '!skip' || firstWord === '!saltar') {
                if (isModOrBroadcaster && typeof skipCurrentSong === 'function') {
                  skipCurrentSong();
                }
                return;
              }

              if (trimmed.toLowerCase().startsWith(srPrefix)) {
                const q = trimmed.slice(srPrefix.length).trim();
                if (q) {
                  fetch('/api/sr/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, requester: username, isMod: isModOrBroadcaster, isSub, channel })
                  }).then(r => {
                    if (!r.ok && typeof handleClientSongRequest === 'function') {
                      handleClientSongRequest(q, username, false);
                    }
                  }).catch(() => {
                    if (typeof handleClientSongRequest === 'function') {
                      handleClientSongRequest(q, username, false);
                    }
                  });
                  return;
                }
              }
            }

            // 2. PROCESAMIENTO DE TTS EN KICK
            const ttsConfig = currentCfg.tts || appConfig?.tts || {};
            if (ttsConfig.enabled !== false && ttsConfig.allowChatCommand !== false) {
              const ttsCmd = (ttsConfig.chatCommand || '!tts').toLowerCase();
              const matchedVoiceCmd = findVoiceCommandOrAlias(firstWord);

              if (firstWord === '!ttsdetener' || firstWord === '!ttsstop' || firstWord === '!ttspause') {
                if (isModOrBroadcaster) {
                  broadcastEvent('tts_control', { action: 'stop', channel });
                  return;
                }
              }
              if (firstWord === '!ttsreiniciar' || firstWord === '!ttsreset' || firstWord === '!ttsclear') {
                if (isModOrBroadcaster) {
                  broadcastEvent('tts_control', { action: 'reset', channel });
                  return;
                }
              }
              if (firstWord === '!ttsskip' || firstWord === '!ttssaltar') {
                if (isModOrBroadcaster) {
                  broadcastEvent('tts_control', { action: 'skip', channel });
                  return;
                }
              }

              if (trimmed.toLowerCase().startsWith(ttsCmd)) {
                let ttsRaw = trimmed.slice(ttsCmd.length).trim();
                if (ttsRaw) {
                  let selectedVoice = ttsConfig.voice || 'es_mx_mia';
                  const firstToken = ttsRaw.split(/\s+/)[0].toLowerCase().replace(/^[-@/]/, '').replace(/^voice:/, '');
                  const aliasMap = {
                    messi: 'es_ar_messi', maduro: 'es_ve_maduro', tiktok: 'es_tiktok', homero: 'es_mx_homero',
                    dross: 'es_dross', badbunny: 'es_badbunny', rubius: 'es_rubius', farid: 'es_farid',
                    westcol: 'es_westcol', cr7: 'es_cr7', goku: 'es_goku', maradona: 'es_maradona',
                    xokas: 'es_xokas', illojuan: 'es_illojuan', auron: 'es_auronplay', peruano: 'es_peruano',
                    closs: 'es_marianocloss', lacobra: 'es_lacobra', davo: 'es_davo', mia: 'es_mx_mia',
                    miguel: 'es_us_miguel', brian: 'en_brian'
                  };
                  if (aliasMap[firstToken] || (typeof SE_VOICE_MAP !== 'undefined' && SE_VOICE_MAP[firstToken]) || (typeof VOICE_PROFILES !== 'undefined' && VOICE_PROFILES[firstToken])) {
                    selectedVoice = aliasMap[firstToken] || firstToken;
                    ttsRaw = ttsRaw.slice(ttsRaw.indexOf(' ') + 1).trim();
                  }
                  if (ttsRaw) {
                    const ttsAudioUrl = getTTSAudioUrl(ttsRaw, selectedVoice);
                    const ttsData = {
                      id: 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                      user: username,
                      text: ttsRaw,
                      voice: selectedVoice,
                      volume: Number(ttsConfig.volume !== undefined ? ttsConfig.volume : 90) / 100,
                      rate: Number(ttsConfig.rate || 1.0),
                      pitch: Number(ttsConfig.pitch || 1.0),
                      audioUrl: ttsAudioUrl,
                      channel,
                      platform: 'kick',
                      timestamp: Date.now()
                    };
                    broadcastEvent('tts', ttsData);
                    return;
                  }
                }
              } else if (matchedVoiceCmd) {
                const userBadges = { isMod, isSub, vip: badges.some(b => b.type === 'vip'), broadcaster: isBroadcaster };
                const allowed = !matchedVoiceCmd.permissions || matchedVoiceCmd.permissions.includes('todos') ||
                  (userBadges.broadcaster && matchedVoiceCmd.permissions.includes('broadcaster')) ||
                  (userBadges.isMod && matchedVoiceCmd.permissions.includes('mod')) ||
                  (userBadges.isSub && matchedVoiceCmd.permissions.includes('sub')) ||
                  (userBadges.vip && matchedVoiceCmd.permissions.includes('vip'));

                if (allowed) {
                  const voiceText = trimmed.slice(firstWord.length).trim();
                  if (voiceText) {
                    const selectedVoice = matchedVoiceCmd.voiceId || ttsConfig.voice || 'es_mx_mia';
                    const ttsAudioUrl = getTTSAudioUrl(voiceText, selectedVoice);
                    const ttsData = {
                      id: 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
                      user: username,
                      text: voiceText,
                      voice: selectedVoice,
                      volume: Number(matchedVoiceCmd.volume !== undefined ? matchedVoiceCmd.volume : (ttsConfig.volume || 90)) / 100,
                      rate: Number(matchedVoiceCmd.rate || ttsConfig.rate || 1.0),
                      pitch: Number(matchedVoiceCmd.pitch || ttsConfig.pitch || 1.0),
                      audioUrl: ttsAudioUrl,
                      channel,
                      platform: 'kick',
                      timestamp: Date.now()
                    };
                    broadcastEvent('tts', ttsData);
                    return;
                  }
                }
              }
            }
          } else if (pkt.event === 'App\\Events\\SubscriptionEvent' || pkt.event === 'SubscriptionEvent') {
            const subData = typeof pkt.data === 'string' ? JSON.parse(pkt.data) : pkt.data;
            const user = subData.username || subData.user?.username || 'KickUser';
            const months = subData.months || 1;
            broadcastEvent('alert', {
              type: 'kick_sub',
              platform: 'kick',
              user,
              months,
              message: `¡Nueva suscripción en Kick (${months} meses)!`
            });
          } else if (pkt.event === 'App\\Events\\GiftedSubscriptionsEvent' || pkt.event === 'GiftedSubscriptionsEvent') {
            const giftData = typeof pkt.data === 'string' ? JSON.parse(pkt.data) : pkt.data;
            const gifter = giftData.gifter_username || giftData.username || 'KickUser';
            const count = Array.isArray(giftData.gifted_usernames) ? giftData.gifted_usernames.length : (giftData.count || 1);
            broadcastEvent('alert', {
              type: 'kick_gift',
              platform: 'kick',
              user: gifter,
              amount: count,
              isGift: true,
              message: `¡${gifter} regaló ${count} suscripción(es) en Kick! 🎁`
            });
          } else if (pkt.event === 'App\\Events\\FollowersUpdated' || pkt.event === 'FollowersUpdated' || pkt.event === 'FollowEvent') {
            const folData = typeof pkt.data === 'string' ? JSON.parse(pkt.data) : pkt.data;
            const user = folData.username || folData.user?.username || 'Nuevo Seguidor';
            broadcastEvent('alert', {
              type: 'kick_follower',
              platform: 'kick',
              user,
              message: '¡Nuevo seguidor en Kick!'
            });
          }
        } catch (e) { }
      };
      browserKickWs.onclose = () => {
        const isConn = (appConfig?.kick?.connected !== false) && Boolean(localStorage.getItem('orbibot_kick_auth') || localStorage.getItem('orbibot_kick_channel'));
        if (isConn) {
          setTimeout(startKickSocket, 6000);
        }
      };
    } catch (e) { }
  }
  startKickSocket();
}

// ================= UI BINDING =================
function bindConfigToUI(cfg) {
  if (!cfg) return;
  if (!cfg.twitch && !adminTargetStreamerId) {
    try {
      const local = localStorage.getItem('orbibot_twitch_auth');
      if (local) cfg.twitch = JSON.parse(local);
    } catch (e) { }
  }

  // Twitch Profile & Connection
  if (cfg.twitch) {
    const channel = (cfg.twitch.channel || cfg.twitch.login || (cfg.twitch.displayName ? cfg.twitch.displayName.toLowerCase() : '') || '').replace(/^#/, '');
    if (channel) {
      cfg.twitch.channel = channel;
    }
    const isConn = (cfg.twitch.connected || Boolean(cfg.twitch.oauthToken) || Boolean(channel)) && Boolean(channel);

    // Header elements
    const topTwitchLoginBtn = document.getElementById('topTwitchLoginBtn');
    const topUserPill = document.getElementById('topUserPill');
    const topUserAvatar = document.getElementById('topUserAvatar');
    const topUserName = document.getElementById('topUserName');

    // Dashboard Hero elements
    const loginHero = document.getElementById('dashboardLoginHero');
    const connectedHero = document.getElementById('dashboardConnectedHero');
    const dashUserAvatar = document.getElementById('dashUserAvatar');
    const dashUserName = document.getElementById('dashUserName');
    const dashUserTag = document.getElementById('dashUserTag');

    const avatar = cfg.twitch.profileImage || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb60-aee8f1560db5-profile_image-300x300.png';
    const dName = cfg.twitch.displayName || channel || (adminTargetStreamerId ? `@${adminTargetStreamerId}` : 'Streamer');
    const login = channel || (adminTargetStreamerId ? adminTargetStreamerId : '');

    if (isConn || adminTargetStreamerId) {
      if (topTwitchLoginBtn) topTwitchLoginBtn.style.display = 'none';
      if (topUserPill) {
        topUserPill.style.display = 'inline-flex';
        if (topUserAvatar) topUserAvatar.src = avatar;
        if (topUserName) topUserName.innerText = `@${login || dName}`;
      }

      if (loginHero) loginHero.style.display = 'none';
      if (connectedHero) {
        connectedHero.style.display = 'block';
        if (dashUserAvatar) dashUserAvatar.src = avatar;
        if (dashUserName) dashUserName.innerText = dName;
        if (dashUserTag) dashUserTag.innerText = `@${login || dName}`;
      }

      updateBotStatusUI({ status: 'connected', channel: login });
    } else {
      if (topTwitchLoginBtn) topTwitchLoginBtn.style.display = 'inline-flex';
      if (topUserPill) topUserPill.style.display = 'none';

      if (loginHero) loginHero.style.display = 'block';
      if (connectedHero) connectedHero.style.display = 'none';

      updateBotStatusUI({ status: 'disconnected' });
    }

    if (document.getElementById('cfgTwitchChannel')) document.getElementById('cfgTwitchChannel').value = channel;
    if (document.getElementById('cfgTwitchBotUser')) document.getElementById('cfgTwitchBotUser').value = cfg.twitch.botUsername || channel;
    if (document.getElementById('cfgTwitchToken')) document.getElementById('cfgTwitchToken').value = cfg.twitch.oauthToken || '';
    if (document.getElementById('cfgTwitchClientId')) {
      document.getElementById('cfgTwitchClientId').value = cfg.twitch.clientId || 'yw1vr664ichms8an2x5lhji58v7ozk';
    }
    if (document.getElementById('statChannelName')) {
      document.getElementById('statChannelName').innerText = channel ? `#${channel}` : (adminTargetStreamerId ? `#${adminTargetStreamerId}` : 'Ninguno');
    }
    populateWidgetUrls();
  }

  // Song Request
  if (cfg.songRequest) {
    document.getElementById('cfgSrPrefix').value = cfg.songRequest.prefix || '!sr';
    document.getElementById('cfgSrUserLevel').value = cfg.songRequest.userLevel || 'all';
    document.getElementById('cfgSrMaxDuration').value = cfg.songRequest.maxDurationMinutes || 8;
    document.getElementById('cfgSrMaxPerUser').value = cfg.songRequest.maxPerUser || 5;
    document.getElementById('cfgSrEnabled').checked = cfg.songRequest.enabled !== false;
  }

  // TTS
  if (cfg.tts) {
    if (document.getElementById('cfgTtsEnabled')) {
      document.getElementById('cfgTtsEnabled').checked = cfg.tts.enabled !== false;
    }
    const savedActiveVoice = localStorage.getItem('orbibot_active_tts_voice');
    let vVal = savedActiveVoice || cfg.tts.voice || 'es_mx_mia';
    if (vVal === 'es_001' || vVal === 'es_female') vVal = 'es_mx_mia';
    if (vVal === 'es_male') vVal = 'es_us_miguel';
    if (vVal === 'es_002') vVal = 'es_es_conchita';
    if (vVal === 'en_001') vVal = 'en_brian';
    if (vVal === 'en_002') vVal = 'en_emma';
    if (vVal === 'es-ES-Standard-A') vVal = 'es_es_enrique';
    const voiceSelect = document.getElementById('cfgTtsVoice');
    if (voiceSelect) {
      voiceSelect.value = vVal;
      if (!voiceSelect.value) {
        voiceSelect.value = 'es_mx_mia';
      } else {
        localStorage.setItem('orbibot_active_tts_voice', voiceSelect.value);
      }
    }
    if (document.getElementById('cfgTtsVolume')) {
      document.getElementById('cfgTtsVolume').value = cfg.tts.volume !== undefined ? cfg.tts.volume : 90;
      if (document.getElementById('valTtsVolume')) document.getElementById('valTtsVolume').innerText = `${document.getElementById('cfgTtsVolume').value}%`;
    }
    if (document.getElementById('cfgTtsRate')) {
      document.getElementById('cfgTtsRate').value = cfg.tts.rate || 1.0;
      if (document.getElementById('valTtsRate')) document.getElementById('valTtsRate').innerText = `${document.getElementById('cfgTtsRate').value}x`;
    }
    if (document.getElementById('cfgTtsPitch')) {
      document.getElementById('cfgTtsPitch').value = cfg.tts.pitch || 1.0;
      if (document.getElementById('valTtsPitch')) document.getElementById('valTtsPitch').innerText = document.getElementById('cfgTtsPitch').value;
    }
    if (document.getElementById('cfgTtsMaxLength')) document.getElementById('cfgTtsMaxLength').value = cfg.tts.maxLength || 250;
    if (document.getElementById('cfgTtsBannedWords')) document.getElementById('cfgTtsBannedWords').value = (cfg.tts.bannedWords || []).join(', ');
    if (document.getElementById('cfgTtsAllowCommand')) document.getElementById('cfgTtsAllowCommand').checked = cfg.tts.allowChatCommand !== false;
    if (document.getElementById('cfgTtsCommand')) document.getElementById('cfgTtsCommand').value = cfg.tts.chatCommand || '!tts';
    if (document.getElementById('cfgTtsMinBits')) document.getElementById('cfgTtsMinBits').value = cfg.tts.minBits !== undefined ? cfg.tts.minBits : 50;
    if (document.getElementById('cfgTtsFishApiKey')) {
      document.getElementById('cfgTtsFishApiKey').value = cfg.tts.fishApiKey || 'sk-fish-rOpXPwPZLXZAk5SPYaeSKBue6QfPM3l4i6Q3VG8ZbGI';
    }

    // Sync Master Chat TTS Toggle & Status Badge
    const isTtsChatActive = cfg.tts.enabled !== false && cfg.tts.allowChatCommand !== false;
    const masterToggle = document.getElementById('toggleTtsMasterChat');
    const masterBadge = document.getElementById('ttsMasterStatusBadge');
    const masterLabel = document.getElementById('ttsMasterToggleLabel');

    if (masterToggle) masterToggle.checked = isTtsChatActive;
    if (masterLabel) masterLabel.textContent = isTtsChatActive ? 'TTS Habilitado' : 'TTS Silenciado';
    if (masterBadge) {
      if (isTtsChatActive) {
        masterBadge.textContent = 'ACTIVO EN CHAT';
        masterBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        masterBadge.style.color = '#10b981';
        masterBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      } else {
        masterBadge.textContent = 'DESACTIVADO EN CHAT';
        masterBadge.style.background = 'rgba(239, 68, 68, 0.2)';
        masterBadge.style.color = '#ef4444';
        masterBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
      }
    }
  }

  // Custom Goals
  if (Array.isArray(cfg.goals)) {
    renderGoals(cfg.goals);
  }
}

function setupRangeInputs() {
  const vol = document.getElementById('cfgTtsVolume');
  const rate = document.getElementById('cfgTtsRate');
  const pitch = document.getElementById('cfgTtsPitch');

  if (vol) vol.addEventListener('input', () => { if (document.getElementById('valTtsVolume')) document.getElementById('valTtsVolume').innerText = `${vol.value}%`; });
  if (rate) rate.addEventListener('input', () => { if (document.getElementById('valTtsRate')) document.getElementById('valTtsRate').innerText = `${rate.value}x`; });
  if (pitch) pitch.addEventListener('input', () => { if (document.getElementById('valTtsPitch')) document.getElementById('valTtsPitch').innerText = pitch.value; });
}

// ================= BOT STATUS =================
function updateBotStatusUI(botStatus) {
  const dot = document.getElementById('botStatusDot');
  const text = document.getElementById('botStatusText');
  const badge = document.getElementById('twitchConnectionBadge');
  const statText = document.getElementById('statBotStatus');
  const quickBtn = document.getElementById('quickConnectBtn');
  const statChan = document.getElementById('statChannelName');

  let currentChannel = (appConfig?.twitch?.channel || '').replace(/^#/, '');
  if (!currentChannel) {
    try {
      const local = localStorage.getItem('orbibot_twitch_auth');
      if (local) {
        const p = JSON.parse(local);
        currentChannel = (p.channel || p.login || (p.displayName ? p.displayName.toLowerCase() : '') || '').replace(/^#/, '');
      }
    } catch (e) { }
  }

  const isConnected = Boolean(currentChannel && (appConfig?.twitch?.connected || browserTmiClient || localStorage.getItem('orbibot_twitch_auth')));
  let status = botStatus?.status || (isConnected ? 'connected' : 'disconnected');
  if (!isConnected) {
    status = 'disconnected';
  }

  if (dot) dot.className = `status-dot ${status}`;
  if (text) text.innerText = status === 'connected' ? 'En Línea' : (status === 'connecting' ? 'Conectando...' : 'Desconectado');

  if (status === 'connected') {
    if (badge) {
      badge.className = 'btn btn-sm btn-accent';
      badge.innerText = '🟢 Conectado';
    }
    if (statText) {
      statText.innerText = 'En Línea';
      statText.style.color = 'var(--green-success)';
    }
    if (quickBtn) {
      quickBtn.innerText = 'Desconectar';
      quickBtn.className = 'btn btn-danger btn-sm';
    }
    if (statChan && currentChannel) statChan.innerText = `#${currentChannel}`;
  } else if (status === 'connecting') {
    if (badge) {
      badge.className = 'btn btn-sm btn-secondary';
      badge.innerText = '🟡 Conectando...';
    }
    if (statText) {
      statText.innerText = 'Conectando';
      statText.style.color = 'var(--yellow-warn)';
    }
    if (quickBtn) {
      quickBtn.innerText = 'Conectando...';
      quickBtn.className = 'btn btn-secondary btn-sm';
    }
    if (statChan) statChan.innerText = currentChannel ? `#${currentChannel}` : 'Ninguno';
  } else {
    if (badge) {
      badge.className = 'btn btn-sm btn-danger';
      badge.innerText = '🔴 Desconectado';
    }
    if (statText) {
      statText.innerText = 'Inactivo';
      statText.style.color = 'var(--red-danger)';
    }
    if (quickBtn) {
      quickBtn.innerText = 'Iniciar Sesión';
      quickBtn.className = 'btn btn-primary btn-sm';
    }
    if (statChan) statChan.innerText = 'Ninguno';
  }
}

// ================= TWITCH BADGES & EMOTES =================
const DEFAULT_TWITCH_BADGES = {
  broadcaster: {
    title: 'Streamer / Transmisor',
    url: 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1'
  },
  moderator: {
    title: 'Moderador',
    url: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/1'
  },
  vip: {
    title: 'VIP',
    url: 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/1'
  },
  subscriber: {
    title: 'Suscriptor',
    url: 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/1'
  },
  founder: {
    title: 'Fundador',
    url: 'https://static-cdn.jtvnw.net/badges/v1/511b78a9-ab37-472f-9569-457753bbe7d3/1'
  },
  premium: {
    title: 'Prime Gaming',
    url: 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/1'
  },
  turbo: {
    title: 'Turbo',
    url: 'https://static-cdn.jtvnw.net/badges/v1/bd444ec6-8f34-4bf9-91f4-af1e3428d80f/1'
  },
  partner: {
    title: 'Verificado',
    url: 'https://static-cdn.jtvnw.net/badges/v1/d12a2e27-16f6-41d0-ab77-b780518f00a3/1'
  },
  'artist-badge': {
    title: 'Artista',
    url: 'https://static-cdn.jtvnw.net/badges/v1/4300a897-03dc-4e83-8c0e-c332fee7057f/1'
  },
  'bot-badge': {
    title: 'Bot de Chat',
    url: 'https://static-cdn.jtvnw.net/badges/v1/3ffa9565-c35b-4cad-800b-041e60659cf2/1'
  },
  staff: {
    title: 'Twitch Staff',
    url: 'https://static-cdn.jtvnw.net/badges/v1/d97c37bd-a6f5-4c38-8f57-4e4bef88af34/1'
  },
  admin: {
    title: 'Twitch Admin',
    url: 'https://static-cdn.jtvnw.net/badges/v1/9ef7e029-4cdf-4d4d-a0d5-e2b3fb2583fe/1'
  },
  global_mod: {
    title: 'Moderador Global',
    url: 'https://static-cdn.jtvnw.net/badges/v1/9384c43e-4ce7-4e94-b2a1-b93656896eba/1'
  },
  'glhf-pledge': {
    title: 'GLHF Pledge',
    url: 'https://static-cdn.jtvnw.net/badges/v1/3158e758-3cb4-43c5-94b3-7639810451c5/1'
  },
  'sub-gifter': {
    title: 'Regalador de Suscripciones',
    url: 'https://static-cdn.jtvnw.net/badges/v1/a5ef6c17-2e5b-4d8f-9b80-2779fd722414/1'
  },
  no_video: {
    title: 'Solo Audio',
    url: 'https://static-cdn.jtvnw.net/badges/v1/aef2cd08-f292-42c6-917d-f4728562d49b/1'
  }
};

const channelBadgesCache = {};
const loadedBadgesChannels = new Set();

async function loadChannelBadges(channelIdOrName) {
  if (!channelIdOrName || loadedBadgesChannels.has(channelIdOrName)) return;
  loadedBadgesChannels.add(channelIdOrName);
  try {
    const isId = /^\d+$/.test(channelIdOrName);
    const param = isId ? `id=${channelIdOrName}` : `name=${channelIdOrName.toLowerCase().replace(/^#/, '')}`;
    const res = await fetch(`https://api.ivr.fi/v2/twitch/badges/channel?${param}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.forEach(set => {
          if (!channelBadgesCache[set.set_id]) channelBadgesCache[set.set_id] = {};
          if (Array.isArray(set.versions)) {
            set.versions.forEach(v => {
              channelBadgesCache[set.set_id][v.id] = {
                title: v.title,
                url: v.image_url_1x || v.image_url_2x || v.image_url_4x
              };
            });
          }
        });
      }
    }
  } catch (e) { }
}

function getTwitchBadgeInfo(setId, version) {
  if (channelBadgesCache[setId] && channelBadgesCache[setId][version]) {
    return channelBadgesCache[setId][version];
  }
  if (DEFAULT_TWITCH_BADGES[setId]) {
    return DEFAULT_TWITCH_BADGES[setId];
  }
  return null;
}

function renderTwitchBadges(badgesData, isMod, isSub) {
  let badges = {};
  if (typeof badgesData === 'string') {
    badgesData.split(',').forEach(part => {
      const [k, v] = part.split('/');
      if (k) badges[k] = v || '1';
    });
  } else if (badgesData && typeof badgesData === 'object') {
    badges = badgesData;
  }

  let html = '';
  const badgeOrder = [
    'staff', 'admin', 'global_mod', 'broadcaster', 'moderator',
    'vip', 'founder', 'subscriber', 'artist-badge', 'partner',
    'premium', 'turbo', 'sub-gifter', 'bot-badge', 'glhf-pledge', 'no_video'
  ];

  const processed = new Set();
  for (const key of badgeOrder) {
    if (badges[key] !== undefined) {
      processed.add(key);
      const info = getTwitchBadgeInfo(key, badges[key]);
      if (info) {
        html += `<img class="twitch-badge" src="${info.url}" alt="${escapeHtml(info.title)}" title="${escapeHtml(info.title)}" loading="lazy">`;
      }
    }
  }

  for (const key in badges) {
    if (!processed.has(key)) {
      const info = getTwitchBadgeInfo(key, badges[key]);
      if (info) {
        html += `<img class="twitch-badge" src="${info.url}" alt="${escapeHtml(info.title)}" title="${escapeHtml(info.title)}" loading="lazy">`;
      }
    }
  }

  // Fallback if badges object is empty
  if (!html) {
    if (isMod) {
      const m = DEFAULT_TWITCH_BADGES.moderator;
      html += `<img class="twitch-badge" src="${m.url}" alt="${m.title}" title="${m.title}" loading="lazy">`;
    } else if (isSub) {
      const s = DEFAULT_TWITCH_BADGES.subscriber;
      html += `<img class="twitch-badge" src="${s.url}" alt="${s.title}" title="${s.title}" loading="lazy">`;
    }
  }

  return html;
}

function formatTwitchEmotes(message, emotes) {
  if (!message) return '';
  if (!emotes || typeof emotes !== 'object' || Object.keys(emotes).length === 0) {
    return escapeHtml(message);
  }
  const ranges = [];
  for (const emoteId in emotes) {
    const list = emotes[emoteId];
    if (Array.isArray(list)) {
      list.forEach(range => {
        const parts = range.split('-');
        const start = parseInt(parts[0], 10);
        const end = parseInt(parts[1], 10);
        if (!isNaN(start) && !isNaN(end)) {
          ranges.push({ id: emoteId, start, end });
        }
      });
    }
  }
  if (ranges.length === 0) {
    return escapeHtml(message);
  }
  ranges.sort((a, b) => a.start - b.start);

  let html = '';
  let lastIdx = 0;
  for (const r of ranges) {
    if (r.start > lastIdx) {
      html += escapeHtml(message.slice(lastIdx, r.start));
    }
    const emoteName = message.slice(r.start, r.end + 1);
    html += `<img class="twitch-emote" src="https://static-cdn.jtvnw.net/emoticons/v2/${r.id}/default/dark/1.0" alt="${escapeHtml(emoteName)}" title="${escapeHtml(emoteName)}" loading="lazy">`;
    lastIdx = r.end + 1;
  }
  if (lastIdx < message.length) {
    html += escapeHtml(message.slice(lastIdx));
  }
  return html;
}

// ================= CHAT LIVE LOG =================
function appendChatMessage(data) {
  const container = document.getElementById('liveChatMessages');
  if (!container || !data || !data.message) return;

  const platform = data.platform || 'twitch';
  const platforms = appConfig?.chatPlatforms || { twitch: true, kick: true };
  if (platforms[platform] === false) return;

  // Clear initial placeholder notice if present
  const placeholder = container.querySelector('em');
  if (placeholder && placeholder.parentElement && placeholder.parentElement.parentElement === container) {
    container.innerHTML = '';
  }

  if (data.roomId && platform === 'twitch') {
    loadChannelBadges(data.roomId);
  }

  const row = document.createElement('div');
  row.className = `chat-msg-row chat-platform-${platform}`;

  // Check if both platforms are enabled and active
  const bothActive = areBothPlatformsEnabledInDash();
  let platformBadge = '';
  if (bothActive) {
    if (platform === 'kick') {
      platformBadge = `
        <span title="Kick" style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:#53fc18; border-radius:3px; margin-right:5px; vertical-align:middle; box-shadow: 0 0 5px rgba(83,252,24,0.4);">
          <svg viewBox="0 0 32 32" width="10" height="10" fill="#000"><path d="M4 2h8v8h3V6h3V2h10v10h-3v3h-3v2h3v3h3v10H18v-4h-3v-3h-3v-2H9v9H4V2z"/></svg>
        </span>
      `;
    } else {
      platformBadge = `
        <span title="Twitch" style="display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; background:#9146ff; border-radius:3px; margin-right:5px; vertical-align:middle; box-shadow: 0 0 5px rgba(145,70,255,0.4);">
          <svg viewBox="0 0 24 24" width="10" height="10" fill="#fff"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>
        </span>
      `;
    }
  }

  const badgeHtml = platform === 'kick' ? renderKickBadges(data.badges) : renderTwitchBadges(data.badges || data.badgesRaw, data.isMod, data.isSub);
  const formattedText = platform === 'twitch' ? formatTwitchEmotes(data.message, data.emotes) : escapeHtml(data.message);
  const userColor = data.color || (platform === 'kick' ? '#53fc18' : '#9146ff');

  row.innerHTML = `
    ${platformBadge}
    <span class="chat-badges">${badgeHtml}</span>
    <span class="chat-user" style="color: ${userColor}">${escapeHtml(data.user)}:</span>
    <span class="chat-text">${formattedText}</span>
  `;

  container.appendChild(row);
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function triggerTestChat() {
  const twitchChan = (appConfig?.twitch?.channel || 'StreamerMaster').replace(/^#/, '');
  const kickChan = (appConfig?.kick?.channel || appConfig?.kick?.username || 'KickStreamer').replace(/^@/, '');
  const bothActive = areBothPlatformsEnabledInDash();

  const sampleMessages = [
    {
      platform: 'twitch',
      user: twitchChan,
      color: '#ff007f',
      message: '¡Hola a todos en Twitch! Bienvenidos al directo Kappa Keepo',
      badges: { broadcaster: '1', subscriber: '12' },
      isMod: true,
      isSub: true,
      emotes: { '25': ['42-46'], '1902': ['48-52'] }
    },
    {
      platform: 'kick',
      user: kickChan,
      color: '#53fc18',
      message: '¡Y un saludo gigante a toda la comunidad de Kick activa en el chat!',
      badges: [{ type: 'broadcaster' }, { type: 'subscriber' }],
      isMod: true,
      isSub: true,
      emotes: null
    },
    {
      platform: 'twitch',
      user: 'Moderador_Twitch',
      color: '#00f2fe',
      message: 'Recuerden respetar las reglas del chat y pasarla bien PogChamp',
      badges: { moderator: '1', partner: '1' },
      isMod: true,
      isSub: false,
      emotes: { '88': ['52-59'] }
    },
    {
      platform: 'kick',
      user: 'KickViewerVIP',
      color: '#38bdf8',
      message: '¡Multi-chat funcionando perfecto en Kick y Twitch al mismo tiempo! 🔥',
      badges: [{ type: 'vip' }, { type: 'subscriber' }],
      isMod: false,
      isSub: true,
      emotes: null
    }
  ];

  sampleMessages.forEach((msg, idx) => {
    setTimeout(() => {
      appendChatMessage(msg);
      broadcastEvent('chat_message', msg);
    }, idx * 600);
  });
  showToast(bothActive ? '💬 Mensajes de prueba con logos Multi-Chat (Twitch + Kick) enviados a OBS' : '💬 Mensajes de prueba enviados a OBS', 'success');
}
window.triggerTestChat = triggerTestChat;

// ================= SONG REQUEST UI & YOUTUBE =================
const DEFAULT_SONG_THUMB = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80';
let currentSrState = {
  currentSong: null,
  queue: [],
  isPlaying: false
};

function getLocalSrState() {
  try {
    const saved = localStorage.getItem('orbibot_sr_state');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  return currentSrState || { currentSong: null, queue: [], isPlaying: false };
}

function saveLocalSrState(state, syncCloud = true) {
  currentSrState = state;
  try {
    localStorage.setItem('orbibot_sr_state', JSON.stringify(state));
  } catch(e) {}
  if (syncCloud) {
    saveToAllSupabaseScopes('sr_state', state).catch(() => {});
  }
}

function extractYouTubeVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim();
  const watchMatch = str.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  if (watchMatch && watchMatch[1]) return watchMatch[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) return str;
  return null;
}

function handleClientSongRequest(query, requester, isPriority = false) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return;

  const videoId = extractYouTubeVideoId(cleanQuery);
  const song = {
    id: 'sr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    videoId: videoId || null,
    query: cleanQuery,
    title: cleanQuery,
    author: 'YouTube',
    thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : DEFAULT_SONG_THUMB,
    durationSeconds: 210,
    durationFormatted: '3:30',
    requester: requester || 'Anónimo',
    isPriority: !!isPriority,
    requestedAt: new Date().toLocaleTimeString()
  };

  // Si se reconoció un ID de video, consultar oEmbed para obtener título y autor reales
  if (videoId) {
    fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
      .then(r => r.json())
      .then(d => {
        if (d.title) song.title = d.title;
        if (d.author_name) song.author = d.author_name;
        updateSongRequestUI(currentSrState);
      })
      .catch(() => {});
  }

  const state = getLocalSrState();
  state.queue = state.queue || [];

  if (!state.currentSong) {
    state.currentSong = song;
    state.isPlaying = true;
    saveLocalSrState(state);
    updateSongRequestUI(state);
    if (song.videoId) {
      playYouTubeSong(song.videoId);
    } else if (ytPlayer && ytPlayer.loadPlaylist) {
      ytPlayer.loadPlaylist({ listType: 'search', list: song.query });
    }
    broadcastEvent('sr_update', { action: 'play', data: song, state });
    showToast(isPriority ? `🌟 [VIP] Reproduciendo ahora: ${song.title}` : `▶️ Reproduciendo ahora: ${song.title}`, 'success');
  } else if (isPriority) {
    // Prioridad VIP (Puntos de Canal): ubicar por delante de canciones normales
    const lastPriorityIdx = state.queue.map(s => !!s.isPriority).lastIndexOf(true);
    if (lastPriorityIdx === -1) {
      state.queue.unshift(song);
    } else {
      state.queue.splice(lastPriorityIdx + 1, 0, song);
    }
    saveLocalSrState(state);
    updateSongRequestUI(state);
    broadcastEvent('sr_update', { action: 'queue_add', data: song, state });
    const pos = state.queue.indexOf(song) + 1;
    showToast(`🌟 [VIP] @${requester} pidió canción con prioridad (#${pos} en cola): ${song.title}`, 'success');
  } else {
    state.queue.push(song);
    saveLocalSrState(state);
    updateSongRequestUI(state);
    broadcastEvent('sr_update', { action: 'queue_add', data: song, state });
    showToast(`🎵 Canción añadida (#${state.queue.length} en cola): ${song.title}`, 'info');
  }
}
window.handleClientSongRequest = handleClientSongRequest;

function updateSongRequestUI(state, shouldSave = true) {
  if (!state) return;
  currentSrState = state;
  if (shouldSave) {
    saveLocalSrState(state);
  }

  const current = state.currentSong;
  const queue = state.queue || [];

  // Update Stats
  const statQ = document.getElementById('statQueueCount');
  if (statQ) statQ.innerText = queue.length;
  const qBadge = document.getElementById('queueBadgeTotal');
  if (qBadge) qBadge.innerText = `${queue.length} canciones`;

  // Update Current Song Banner
  const thumb = document.getElementById('srCurrentThumb');
  const title = document.getElementById('srCurrentTitle');
  const author = document.getElementById('srCurrentAuthor');
  const requester = document.getElementById('srCurrentRequester');

  if (current) {
    if (thumb) thumb.src = current.thumbnail || DEFAULT_SONG_THUMB;
    if (title) title.innerText = current.title;
    if (author) author.innerText = current.author || 'YouTube';
    if (requester) requester.innerHTML = `${current.isPriority ? '<span class="badge badge-accent" style="margin-right: 4px;">🌟 VIP</span> ' : ''}Pedida por: <strong>@${current.requester}</strong> (${current.durationFormatted || '3:30'})`;

    if (ytPlayer && ytApiReady && current.videoId) {
      const currentVideoId = ytPlayer.getVideoData ? ytPlayer.getVideoData().video_id : null;
      if (currentVideoId !== current.videoId) {
        if (state.isPlaying !== false) {
          playYouTubeSong(current.videoId);
        }
      }
    }
  } else {
    if (thumb) thumb.src = DEFAULT_SONG_THUMB;
    if (title) title.innerText = 'No hay canción sonando';
    if (author) author.innerText = 'Pide una canción con !sr o puntos del canal';
    if (requester) requester.innerText = 'Esperando solicitudes...';
  }

  // Update Pause/Play Button in Dashboard
  const btnPausePlay = document.getElementById('btnSrPausePlay');
  if (btnPausePlay) {
    if (current) {
      if (state.isPlaying === false) {
        btnPausePlay.innerHTML = '▶️ Reanudar';
        btnPausePlay.title = 'Reanudar canción actual';
        btnPausePlay.classList.add('btn-primary');
        btnPausePlay.classList.remove('btn-secondary');
      } else {
        btnPausePlay.innerHTML = '⏸️ Pausar';
        btnPausePlay.title = 'Pausar canción actual';
        btnPausePlay.classList.remove('btn-primary');
        btnPausePlay.classList.add('btn-secondary');
      }
    } else {
      btnPausePlay.innerHTML = '▶️ Reproducir';
      btnPausePlay.title = (queue.length > 0) ? 'Iniciar cola de reproducción' : 'No hay canciones en cola';
      btnPausePlay.classList.remove('btn-primary');
      btnPausePlay.classList.add('btn-secondary');
    }
  }

  // Visualizer wave
  const wave = document.getElementById('srMusicWave');
  if (wave) {
    wave.style.display = (current && state.isPlaying !== false) ? 'flex' : 'none';
  }

  // Render Queue List
  const queueContainer = document.getElementById('srQueueContainer');
  if (!queueContainer) return;

  if (queue.length === 0) {
    queueContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 36px 20px;">
        <div style="font-size: 32px; margin-bottom: 8px;">🎵</div>
        <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">No hay canciones en cola actualmente</div>
        <div style="font-size: 12px; margin-top: 4px;">Tus espectadores pueden usar <code>!sr nombre de la canción</code> o canjear Puntos de Canal en Twitch.</div>
      </div>
    `;
    return;
  }

  queueContainer.innerHTML = '';
  queue.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className = 'queue-item' + (song.isPriority ? ' queue-item-vip' : '');
    const thumbUrl = song.thumbnail || DEFAULT_SONG_THUMB;
    item.innerHTML = `
      <div class="queue-index">#${idx + 1}</div>
      <img class="queue-thumb" src="${escapeHtml(thumbUrl)}" alt="Thumb">
      <div class="queue-info">
        <div class="queue-title">${escapeHtml(song.title)} ${song.isPriority ? '<span class="badge badge-accent" style="font-size: 10px; margin-left: 6px;">🌟 VIP</span>' : ''}</div>
        <div class="queue-req">Pedida por <strong style="color: var(--cyan-accent);">@${escapeHtml(song.requester)}</strong> • ⏱️ ${song.durationFormatted || '3:30'}</div>
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeSongFromQueue('${song.id}')" title="Eliminar de la cola">🗑️</button>
    `;
    queueContainer.appendChild(item);
  });
}

// YouTube Player Integration
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  ytPlayer = new YT.Player('youtubePlayerContainer', {
    height: '100%',
    width: '100%',
    videoId: '',
    playerVars: {
      autoplay: 1,
      controls: 1,
      modestbranding: 1
    },
    events: {
      onReady: (event) => {
        // Player ready
        if (appConfig?.songRequest?.volume !== undefined) {
          event.target.setVolume(appConfig.songRequest.volume);
        }
      },
      onStateChange: (event) => {
        // YT.PlayerState.ENDED is 0
        if (event.data === YT.PlayerState.ENDED) {
          skipCurrentSong();
        }
      }
    }
  });
};

let dashboardAudioMuted = false;

async function togglePausePlaySongRequest() {
  const state = currentSrState || getLocalSrState();
  const isCurrentlyPlaying = state.isPlaying !== false && Boolean(state.currentSong);
  const myRoom = getActiveStreamerRoom();

  if (isCurrentlyPlaying) {
    // Pausar
    try {
      const res = await fetch('/api/sr/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: myRoom, by: 'Streamer' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) showToast(data.message, 'info');
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        return;
      }
    } catch (e) { }

    // Fallback local
    state.isPlaying = false;
    saveLocalSrState(state);
    updateSongRequestUI(state);
    if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
    broadcastEvent('sr_update', { action: 'pause', data: { current: state.currentSong }, state });
    showToast(`⏸️ Canción pausada: ${state.currentSong?.title || ''}`, 'info');
  } else {
    // Reanudar o reproducir
    try {
      const res = await fetch('/api/sr/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: myRoom, by: 'Streamer' })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) showToast(data.message, 'success');
        if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
        return;
      }
    } catch (e) { }

    // Fallback local
    if (state.currentSong) {
      state.isPlaying = true;
      saveLocalSrState(state);
      updateSongRequestUI(state);
      if (ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
      broadcastEvent('sr_update', { action: 'resume', data: { current: state.currentSong }, state });
      showToast(`▶️ Reanudando: ${state.currentSong.title}`, 'success');
    } else if (state.queue && state.queue.length > 0) {
      skipCurrentSong();
    } else {
      showToast('No hay canciones en cola para reproducir', 'warn');
    }
  }
}
window.togglePausePlaySongRequest = togglePausePlaySongRequest;

function toggleDashboardAudio() {
  dashboardAudioMuted = !dashboardAudioMuted;
  const btn = document.getElementById('btnSrMuteDashboard');
  if (ytPlayer) {
    if (dashboardAudioMuted) {
      if (ytPlayer.mute) ytPlayer.mute();
      if (btn) {
        btn.innerText = '🔇 Audio Panel: OFF';
        btn.classList.add('btn-danger');
        btn.classList.remove('btn-secondary');
      }
      showToast('Audio de este panel silenciado (ideal si usas audio vía OBS)', 'info');
    } else {
      if (ytPlayer.unMute) ytPlayer.unMute();
      if (btn) {
        btn.innerText = '🔊 Audio Panel: ON';
        btn.classList.remove('btn-danger');
        btn.classList.add('btn-secondary');
      }
      showToast('Audio de este panel activado', 'success');
    }
  }
}
window.toggleDashboardAudio = toggleDashboardAudio;

function playYouTubeSong(videoId) {
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
    if (dashboardAudioMuted && ytPlayer.mute) {
      ytPlayer.mute();
    }
    ytPlayer.playVideo();
  }
}

async function skipCurrentSong() {
  const myRoom = getActiveStreamerRoom();
  try {
    const res = await fetch('/api/sr/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: myRoom })
    });
    if (res.ok) {
      const data = await res.json();
      showToast(data.message || 'Canción saltada');
      return;
    }
  } catch (e) { }

  // Modo local / standalone si no hay backend activo
  const state = getLocalSrState();
  state.queue = state.queue || [];
  if (state.queue.length > 0) {
    state.currentSong = state.queue.shift();
    state.isPlaying = true;
    saveLocalSrState(state);
    updateSongRequestUI(state);
    if (state.currentSong.videoId) {
      playYouTubeSong(state.currentSong.videoId);
    } else if (ytPlayer && ytPlayer.loadPlaylist) {
      ytPlayer.loadPlaylist({ listType: 'search', list: state.currentSong.query });
    }
    broadcastEvent('sr_update', { action: 'skip', data: { current: state.currentSong }, state });
    showToast(`⏭️ Saltada. Ahora suena: ${state.currentSong.title}`);
  } else {
    state.currentSong = null;
    state.isPlaying = false;
    saveLocalSrState(state);
    updateSongRequestUI(state);
    broadcastEvent('sr_update', { action: 'stop', state });
    showToast('⏭️ Cola vacía');
  }
}

async function removeSongFromQueue(songId) {
  const myRoom = getActiveStreamerRoom();
  try {
    const res = await fetch('/api/sr/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: songId, channel: myRoom })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast('Canción eliminada de la cola');
        return;
      }
    }
  } catch (e) { }

  // Fallback local
  const state = getLocalSrState();
  state.queue = state.queue || [];
  const idx = state.queue.findIndex(s => s.id === songId);
  if (idx !== -1) {
    const removed = state.queue.splice(idx, 1)[0];
    saveLocalSrState(state);
    updateSongRequestUI(state);
    broadcastEvent('sr_update', { action: 'queue_remove', data: removed, state });
    showToast('Canción eliminada de la cola');
  }
}

// ================= WIDGET SECURITY & PRIVATE TOKENS =================
function getEffectiveWidgetToken() {
  if (adminTargetStreamerId) {
    if (appConfig?.security?.widgetToken) {
      return appConfig.security.widgetToken;
    }
    const token = 'sec_' + adminTargetStreamerId.toLowerCase().replace(/[^a-z0-9_]/g, '') + '_tkn';
    if (appConfig) {
      if (!appConfig.security) appConfig.security = {};
      appConfig.security.widgetToken = token;
    }
    return token;
  }
  if (appConfig?.security?.widgetToken) {
    return appConfig.security.widgetToken;
  }
  let localToken = localStorage.getItem('orbibot_widget_token');
  if (!localToken) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      localToken = 'sec_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      localToken = 'sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    localStorage.setItem('orbibot_widget_token', localToken);
  }
  if (appConfig) {
    if (!appConfig.security) appConfig.security = {};
    appConfig.security.widgetToken = localToken;
  }
  saveToAllSupabaseScopes('widget_token', localToken).catch(() => {});
  return localToken;
}

let isTokenVisible = false;
function toggleTokenVisibility() {
  isTokenVisible = !isTokenVisible;
  const input = document.getElementById('cfgWidgetTokenDisplay');
  const btn = document.getElementById('btnToggleTokenVisibility');
  if (input) {
    input.type = isTokenVisible ? 'text' : 'password';
  }
  if (btn) {
    btn.innerText = isTokenVisible ? '🙈' : '👁️';
  }
}
window.toggleTokenVisibility = toggleTokenVisibility;

function copyWidgetToken() {
  const token = getEffectiveWidgetToken();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(token).then(() => {
      showToast('🔒 Token secreto copiado al portapapeles', 'success');
    }).catch(() => {
      showToast('🔒 Token copiado', 'success');
    });
  } else {
    showToast('Token: ' + token, 'info');
  }
}
window.copyWidgetToken = copyWidgetToken;

async function regenerateWidgetTokenUI() {
  if (!confirm('¿Estás seguro de regenerar tu Clave Secreta de Widgets?\n\nTodos los enlaces anteriores dejarán de funcionar y deberás actualizar las URLs de tus fuentes de navegador en OBS Studio.')) {
    return;
  }

  let newToken = '';
  try {
    const res = await fetch('/api/config/widget-token/regenerate', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      newToken = data.widgetToken;
      if (appConfig) {
        if (!appConfig.security) appConfig.security = {};
        appConfig.security.widgetToken = newToken;
      }
    }
  } catch (e) { }

  if (!newToken) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      newToken = 'sec_' + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      newToken = 'sec_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }
    if (appConfig) {
      if (!appConfig.security) appConfig.security = {};
      appConfig.security.widgetToken = newToken;
    }
  }

  if (!adminTargetStreamerId) {
    localStorage.setItem('orbibot_widget_token', newToken);
  }
  populateWidgetUrls();
  showToast('🛡️ ¡Nueva Clave Secreta generada! Enlaces de OBS actualizados.', 'success');
}
window.regenerateWidgetTokenUI = regenerateWidgetTokenUI;

// ================= OBS WIDGET URLs =================
function populateWidgetUrls() {
  const origin = window.location.origin;
  const path = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '');
  const baseUrl = `${origin}${path}`;

  let channel = '';
  if (appConfig && appConfig.twitch && appConfig.twitch.channel) {
    channel = appConfig.twitch.channel.trim().toLowerCase().replace(/^#/, '');
  }
  if (!channel && !adminTargetStreamerId) {
    try {
      const localTwitch = localStorage.getItem('orbibot_twitch_auth');
      if (localTwitch) {
        const parsed = JSON.parse(localTwitch);
        if (parsed.channel) channel = parsed.channel.trim().toLowerCase().replace(/^#/, '');
      }
    } catch (e) { }
  }
  if (!channel && !adminTargetStreamerId) {
    const inputCh = document.getElementById('cfgTwitchChannel');
    if (inputCh && inputCh.value) {
      channel = inputCh.value.trim().toLowerCase().replace(/^#/, '');
    }
  }

  let kickChannel = '';
  if (appConfig && appConfig.kick) {
    kickChannel = (appConfig.kick.channel || appConfig.kick.username || '').trim().toLowerCase().replace(/^@/, '');
  }
  if (!kickChannel && !adminTargetStreamerId) {
    try {
      const localKick = localStorage.getItem('orbibot_kick_auth');
      if (localKick) {
        const parsed = JSON.parse(localKick);
        if (parsed.channel || parsed.username) kickChannel = (parsed.channel || parsed.username).trim().toLowerCase().replace(/^@/, '');
      }
    } catch (e) { }
  }
  if (!kickChannel && !adminTargetStreamerId) {
    kickChannel = (localStorage.getItem('orbibot_kick_channel') || '').trim().toLowerCase().replace(/^@/, '');
  }

  const token = getEffectiveWidgetToken();
  const tokenDisplay = document.getElementById('cfgWidgetTokenDisplay');
  if (tokenDisplay) {
    tokenDisplay.value = token;
  }

  const effectiveChannel = (channel || kickChannel || (adminTargetStreamerId ? adminTargetStreamerId.toLowerCase() : getActiveStreamerRoom()) || 'streamer').toLowerCase().replace(/^#/, '');

  const channelParam = `channel=${encodeURIComponent(effectiveChannel)}`;
  const kickParam = kickChannel ? `kick=${encodeURIComponent(kickChannel)}` : '';
  const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';

  const params = [channelParam, tokenParam].filter(Boolean).join('&');
  const qs = params ? `?${params}` : '';
  const goalParams = [channelParam, 'type=subs', tokenParam].filter(Boolean).join('&');
  const goalQs = goalParams ? `?${goalParams}` : '?type=subs';

  const chatParams = [channelParam, kickParam, tokenParam].filter(Boolean).join('&');
  const chatQs = chatParams ? `?${chatParams}` : '';

  const alertsUrl = `${baseUrl}/overlays/alerts.html${qs}`;
  const npUrl = `${baseUrl}/overlays/nowplaying.html${qs}`;
  const goalUrl = `${baseUrl}/overlays/goals.html${goalQs}`;
  const musicPlayerUrl = `${baseUrl}/overlays/music_player.html${qs}`;
  const ttsUrl = `${baseUrl}/overlays/tts.html${qs}`;
  const chatUrl = `${baseUrl}/overlays/chat.html${chatQs}`;

  if (document.getElementById('urlAlertsWidget')) document.getElementById('urlAlertsWidget').value = alertsUrl;
  if (document.getElementById('urlNowPlayingWidget')) document.getElementById('urlNowPlayingWidget').value = npUrl;
  if (document.getElementById('urlGoalWidget')) document.getElementById('urlGoalWidget').value = goalUrl;
  if (document.getElementById('urlMusicPlayerWidget')) document.getElementById('urlMusicPlayerWidget').value = musicPlayerUrl;
  if (document.getElementById('urlTtsWidget')) document.getElementById('urlTtsWidget').value = ttsUrl;
  if (document.getElementById('urlChatWidget')) document.getElementById('urlChatWidget').value = chatUrl;

  // URLs en la pestaña de Puntos de Canal
  if (document.getElementById('urlPointsTtsWidget')) document.getElementById('urlPointsTtsWidget').value = ttsUrl;
  if (document.getElementById('urlPointsAlertsWidget')) document.getElementById('urlPointsAlertsWidget').value = alertsUrl;

  // Actualizar enlaces de vista previa
  if (document.getElementById('btnPreviewAlerts')) document.getElementById('btnPreviewAlerts').href = alertsUrl;
  if (document.getElementById('btnPreviewNowPlaying')) document.getElementById('btnPreviewNowPlaying').href = npUrl;
  if (document.getElementById('btnPreviewGoal')) document.getElementById('btnPreviewGoal').href = goalUrl;
  if (document.getElementById('btnPreviewMusicPlayer')) document.getElementById('btnPreviewMusicPlayer').href = musicPlayerUrl;
  if (document.getElementById('btnPreviewTts')) document.getElementById('btnPreviewTts').href = ttsUrl;
  if (document.getElementById('btnPreviewChat')) document.getElementById('btnPreviewChat').href = chatUrl;
  if (document.getElementById('btnPreviewPointsTts')) document.getElementById('btnPreviewPointsTts').href = ttsUrl;
  if (document.getElementById('btnPreviewPointsAlerts')) document.getElementById('btnPreviewPointsAlerts').href = alertsUrl;

  const appBaseUrl = `${baseUrl}/`;
  if (document.getElementById('displayRedirectUri')) {
    document.getElementById('displayRedirectUri').innerText = appBaseUrl;
  }
  if (document.getElementById('cfgTwitchRedirectUri') && !document.getElementById('cfgTwitchRedirectUri').value) {
    document.getElementById('cfgTwitchRedirectUri').value = appBaseUrl;
  }
}

function copyWidgetUrl(inputId) {
  const el = document.getElementById(inputId);
  if (el) {
    const text = el.value || el.innerText || el.textContent;
    navigator.clipboard.writeText(text).then(() => {
      showToast('🔒 ¡Enlace privado copiado al portapapeles!', 'success');
    }).catch(() => {
      showToast('¡Copiado!', 'success');
    });
  }
}

function toggleWidgetUrlVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input) {
    if (input.type === 'password') {
      input.type = 'text';
      if (btn) btn.innerText = '🙈';
    } else {
      input.type = 'password';
      if (btn) btn.innerText = '👁️';
    }
  }
}
window.toggleWidgetUrlVisibility = toggleWidgetUrlVisibility;

// ================= EVENT TESTS =================
async function triggerTestAlert(type) {
  if (!isStreamerLoggedIn()) {
    showToast('⚠️ Debes iniciar sesión o vincular un canal para probar las alertas en OBS.', 'warn');
    return;
  }
  const isKick = type.startsWith('kick_');
  const payload = {
    type,
    user: isKick ? 'KickGamer_2026' : 'StreamerPro',
    amount: type === 'bits' ? 500 : (type === 'kick_gift' ? 5 : 1),
    viewers: 45,
    tier: '1',
    reward: 'Saludo en Directo',
    message: isKick ? '¡Apoyando con todo en Kick! 🚀' : '¡Excelente directo, crack! Saludos a toda la comunidad.',
    platform: isKick ? 'kick' : 'twitch'
  };

  const room = getActiveStreamerRoom();
  const token = getEffectiveWidgetToken();
  const fullPayload = { ...payload, room, channel: room, token };

  // Immediate multi-channel broadcast (for OBS Studio & browser)
  broadcastEvent('alert', fullPayload);
  showToast(`¡Alerta de ${type.toUpperCase().replace('_', ' ')} enviada a OBS Studio!`, 'success');

  try {
    await fetch('/api/alert/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-streamer-id': room
      },
      body: JSON.stringify(fullPayload)
    });
  } catch (e) { }
}

function toggleAlertTestDropdown(event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  const menu = document.getElementById('alertTestDropdownMenu');
  if (!menu) return;
  const isVisible = menu.style.display === 'block';
  menu.style.display = isVisible ? 'none' : 'block';
}

function selectAlertTest(type) {
  const menu = document.getElementById('alertTestDropdownMenu');
  if (menu) menu.style.display = 'none';
  triggerTestAlert(type);
}

// Cerrar el menú desplegable si se hace clic afuera
document.addEventListener('click', (e) => {
  const menu = document.getElementById('alertTestDropdownMenu');
  const btn = document.getElementById('btnOpenAlertTestMenu');
  if (menu && menu.style.display === 'block') {
    if (!menu.contains(e.target) && (!btn || !btn.contains(e.target))) {
      menu.style.display = 'none';
    }
  }
});

window.toggleAlertTestDropdown = toggleAlertTestDropdown;
window.selectAlertTest = selectAlertTest;

const VOICE_PROFILES = {
  // Voces IA (Fish Audio S2.1 Pro Free)
  es_ar_messi: { id: 'es_ar_messi', name: 'Lionel Messi', lang: 'es-AR', gender: 'male', pitch: 0.78, rate: 0.98 },
  messi: { id: 'es_ar_messi', name: 'Lionel Messi', lang: 'es-AR', gender: 'male', pitch: 0.78, rate: 0.98 },
  lionel_messi: { id: 'es_ar_messi', name: 'Lionel Messi', lang: 'es-AR', gender: 'male', pitch: 0.78, rate: 0.98 },
  'lionel messi': { id: 'es_ar_messi', name: 'Lionel Messi', lang: 'es-AR', gender: 'male', pitch: 0.78, rate: 0.98 },
  'leo messi': { id: 'es_ar_messi', name: 'Lionel Messi', lang: 'es-AR', gender: 'male', pitch: 0.78, rate: 0.98 },

  es_ve_maduro: { id: 'es_ve_maduro', name: 'Nicolás Maduro', lang: 'es-VE', gender: 'male', pitch: 0.72, rate: 0.95 },
  maduro: { id: 'es_ve_maduro', name: 'Nicolás Maduro', lang: 'es-VE', gender: 'male', pitch: 0.72, rate: 0.95 },
  nicolas_maduro: { id: 'es_ve_maduro', name: 'Nicolás Maduro', lang: 'es-VE', gender: 'male', pitch: 0.72, rate: 0.95 },
  'nicolas maduro': { id: 'es_ve_maduro', name: 'Nicolás Maduro', lang: 'es-VE', gender: 'male', pitch: 0.72, rate: 0.95 },

  es_tiktok: { id: 'es_tiktok', name: 'Voz TikTok', lang: 'es-MX', gender: 'female', pitch: 1.2, rate: 1.05 },
  tiktok: { id: 'es_tiktok', name: 'Voz TikTok', lang: 'es-MX', gender: 'female', pitch: 1.2, rate: 1.05 },
  voz_tiktok: { id: 'es_tiktok', name: 'Voz TikTok', lang: 'es-MX', gender: 'female', pitch: 1.2, rate: 1.05 },
  'voz tiktok': { id: 'es_tiktok', name: 'Voz TikTok', lang: 'es-MX', gender: 'female', pitch: 1.2, rate: 1.05 },

  es_mx_homero: { id: 'es_mx_homero', name: 'Homero Simpson', lang: 'es-MX', gender: 'male', pitch: 0.85, rate: 0.92 },
  homero: { id: 'es_mx_homero', name: 'Homero Simpson', lang: 'es-MX', gender: 'male', pitch: 0.85, rate: 0.92 },
  homero_simpson: { id: 'es_mx_homero', name: 'Homero Simpson', lang: 'es-MX', gender: 'male', pitch: 0.85, rate: 0.92 },
  'homero simpson': { id: 'es_mx_homero', name: 'Homero Simpson', lang: 'es-MX', gender: 'male', pitch: 0.85, rate: 0.92 },
  homer: { id: 'es_mx_homero', name: 'Homero Simpson', lang: 'es-MX', gender: 'male', pitch: 0.85, rate: 0.92 },

  es_dross: { id: 'es_dross', name: 'Dross Rotzank', lang: 'es-VE', gender: 'male', pitch: 0.70, rate: 0.95 },
  dross: { id: 'es_dross', name: 'Dross Rotzank', lang: 'es-VE', gender: 'male', pitch: 0.70, rate: 0.95 },
  drossrotzank: { id: 'es_dross', name: 'Dross Rotzank', lang: 'es-VE', gender: 'male', pitch: 0.70, rate: 0.95 },

  es_badbunny: { id: 'es_badbunny', name: 'Bad Bunny', lang: 'es-PR', gender: 'male', pitch: 0.75, rate: 0.95 },
  badbunny: { id: 'es_badbunny', name: 'Bad Bunny', lang: 'es-PR', gender: 'male', pitch: 0.75, rate: 0.95 },
  bad_bunny: { id: 'es_badbunny', name: 'Bad Bunny', lang: 'es-PR', gender: 'male', pitch: 0.75, rate: 0.95 },
  benito: { id: 'es_badbunny', name: 'Bad Bunny', lang: 'es-PR', gender: 'male', pitch: 0.75, rate: 0.95 },

  es_rubius: { id: 'es_rubius', name: 'ElRubius', lang: 'es-ES', gender: 'male', pitch: 1.05, rate: 1.05 },
  rubius: { id: 'es_rubius', name: 'ElRubius', lang: 'es-ES', gender: 'male', pitch: 1.05, rate: 1.05 },
  elrubius: { id: 'es_rubius', name: 'ElRubius', lang: 'es-ES', gender: 'male', pitch: 1.05, rate: 1.05 },
  el_rubius: { id: 'es_rubius', name: 'ElRubius', lang: 'es-ES', gender: 'male', pitch: 1.05, rate: 1.05 },

  es_farid: { id: 'es_farid', name: 'Farid Dieck', lang: 'es-MX', gender: 'male', pitch: 1.0, rate: 1.0 },
  farid: { id: 'es_farid', name: 'Farid Dieck', lang: 'es-MX', gender: 'male', pitch: 1.0, rate: 1.0 },
  es_westcol: { id: 'es_westcol', name: 'WestCol', lang: 'es-CO', gender: 'male', pitch: 1.0, rate: 1.0 },
  westcol: { id: 'es_westcol', name: 'WestCol', lang: 'es-CO', gender: 'male', pitch: 1.0, rate: 1.0 },
  es_cr7: { id: 'es_cr7', name: 'Cristiano Ronaldo', lang: 'es-ES', gender: 'male', pitch: 0.75, rate: 1.0 },
  cr7: { id: 'es_cr7', name: 'Cristiano Ronaldo', lang: 'es-ES', gender: 'male', pitch: 0.75, rate: 1.0 },
  es_goku: { id: 'es_goku', name: 'Goku Latino', lang: 'es-MX', gender: 'male', pitch: 1.05, rate: 1.0 },
  goku: { id: 'es_goku', name: 'Goku Latino', lang: 'es-MX', gender: 'male', pitch: 1.05, rate: 1.0 },
  es_maradona: { id: 'es_maradona', name: 'Diego Maradona', lang: 'es-AR', gender: 'male', pitch: 0.85, rate: 0.95 },
  maradona: { id: 'es_maradona', name: 'Diego Maradona', lang: 'es-AR', gender: 'male', pitch: 0.85, rate: 0.95 },
  es_xokas: { id: 'es_xokas', name: 'El Xokas', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.05 },
  xokas: { id: 'es_xokas', name: 'El Xokas', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.05 },
  es_illojuan: { id: 'es_illojuan', name: 'IlloJuan', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.0 },
  illojuan: { id: 'es_illojuan', name: 'IlloJuan', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.0 },
  es_auronplay: { id: 'es_auronplay', name: 'Auronplay', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.0 },
  auron: { id: 'es_auronplay', name: 'Auronplay', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.0 },
  auronplay: { id: 'es_auronplay', name: 'Auronplay', lang: 'es-ES', gender: 'male', pitch: 1.0, rate: 1.0 },

  es_peruano: { id: 'es_peruano', name: 'Peruano', lang: 'es-PE', gender: 'male', pitch: 1.0, rate: 1.0 },
  peruano: { id: 'es_peruano', name: 'Peruano', lang: 'es-PE', gender: 'male', pitch: 1.0, rate: 1.0 },

  es_marianocloss: { id: 'es_marianocloss', name: 'Mariano Closs', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  closs: { id: 'es_marianocloss', name: 'Mariano Closs', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  marianocloss: { id: 'es_marianocloss', name: 'Mariano Closs', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },

  es_lacobra: { id: 'es_lacobra', name: 'La Cobra', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  lacobra: { id: 'es_lacobra', name: 'La Cobra', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  cobra: { id: 'es_lacobra', name: 'La Cobra', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },

  es_davo: { id: 'es_davo', name: 'Davo Xeneize', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  davo: { id: 'es_davo', name: 'Davo Xeneize', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },
  davoxeneize: { id: 'es_davo', name: 'Davo Xeneize', lang: 'es-AR', gender: 'male', pitch: 1.0, rate: 1.0 },

  // Español Latino
  es_mx_mia: { id: 'es_mx_mia', name: 'Mia', lang: 'es-MX', gender: 'female', pitch: 1.15, rate: 1.0 },
  mia: { id: 'es_mx_mia', name: 'Mia', lang: 'es-MX', gender: 'female', pitch: 1.15, rate: 1.0 },
  es_us_miguel: { id: 'es_us_miguel', name: 'Miguel', lang: 'es-US', gender: 'male', pitch: 0.65, rate: 1.0 },
  miguel: { id: 'es_us_miguel', name: 'Miguel', lang: 'es-US', gender: 'male', pitch: 0.65, rate: 1.0 },
  es_us_lupe: { id: 'es_us_lupe', name: 'Lupe', lang: 'es-US', gender: 'female', pitch: 1.2, rate: 1.0 },
  lupe: { id: 'es_us_lupe', name: 'Lupe', lang: 'es-US', gender: 'female', pitch: 1.2, rate: 1.0 },
  es_us_penelope: { id: 'es_us_penelope', name: 'Penelope', lang: 'es-US', gender: 'female', pitch: 1.05, rate: 0.95 },
  penelope: { id: 'es_us_penelope', name: 'Penelope', lang: 'es-US', gender: 'female', pitch: 1.05, rate: 0.95 },
  'penélope': { id: 'es_us_penelope', name: 'Penelope', lang: 'es-US', gender: 'female', pitch: 1.05, rate: 0.95 },

  // Español España / Castellano
  es_es_enrique: { id: 'es_es_enrique', name: 'Enrique', lang: 'es-ES', gender: 'male', pitch: 0.62, rate: 1.05 },
  enrique: { id: 'es_es_enrique', name: 'Enrique', lang: 'es-ES', gender: 'male', pitch: 0.62, rate: 1.05 },
  es_es_conchita: { id: 'es_es_conchita', name: 'Conchita', lang: 'es-ES', gender: 'female', pitch: 1.1, rate: 1.0 },
  conchita: { id: 'es_es_conchita', name: 'Conchita', lang: 'es-ES', gender: 'female', pitch: 1.1, rate: 1.0 },
  es_es_lucia: { id: 'es_es_lucia', name: 'Lucia', lang: 'es-ES', gender: 'female', pitch: 1.25, rate: 1.05 },
  lucia: { id: 'es_es_lucia', name: 'Lucia', lang: 'es-ES', gender: 'female', pitch: 1.25, rate: 1.05 },
  'lucía': { id: 'es_es_lucia', name: 'Lucia', lang: 'es-ES', gender: 'female', pitch: 1.25, rate: 1.05 },

  // English
  en_brian: { id: 'en_brian', name: 'Brian', lang: 'en-GB', gender: 'male', pitch: 0.7, rate: 0.95 },
  brian: { id: 'en_brian', name: 'Brian', lang: 'en-GB', gender: 'male', pitch: 0.7, rate: 0.95 },
  en_emma: { id: 'en_emma', name: 'Emma', lang: 'en-GB', gender: 'female', pitch: 1.15, rate: 1.0 },
  emma: { id: 'en_emma', name: 'Emma', lang: 'en-GB', gender: 'female', pitch: 1.15, rate: 1.0 },
  en_joey: { id: 'en_joey', name: 'Joey', lang: 'en-US', gender: 'male', pitch: 0.68, rate: 1.0 },
  joey: { id: 'en_joey', name: 'Joey', lang: 'en-US', gender: 'male', pitch: 0.68, rate: 1.0 },
  en_matthew: { id: 'en_matthew', name: 'Matthew', lang: 'en-US', gender: 'male', pitch: 0.6, rate: 0.95 },
  matthew: { id: 'en_matthew', name: 'Matthew', lang: 'en-US', gender: 'male', pitch: 0.6, rate: 0.95 },
  en_kendra: { id: 'en_kendra', name: 'Kendra', lang: 'en-US', gender: 'female', pitch: 1.2, rate: 1.0 },
  kendra: { id: 'en_kendra', name: 'Kendra', lang: 'en-US', gender: 'female', pitch: 1.2, rate: 1.0 },
  en_justin: { id: 'en_justin', name: 'Justin', lang: 'en-US', gender: 'male', pitch: 1.35, rate: 1.1 },
  justin: { id: 'en_justin', name: 'Justin', lang: 'en-US', gender: 'male', pitch: 1.35, rate: 1.1 },
  en_russell: { id: 'en_russell', name: 'Russell', lang: 'en-AU', gender: 'male', pitch: 0.75, rate: 1.0 },
  russell: { id: 'en_russell', name: 'Russell', lang: 'en-AU', gender: 'male', pitch: 0.75, rate: 1.0 },

  // Internacionales
  pt_cristiano: { id: 'pt_cristiano', name: 'Cristiano', lang: 'pt-BR', gender: 'male', pitch: 0.7, rate: 1.0 },
  cristiano: { id: 'pt_cristiano', name: 'Cristiano', lang: 'pt-BR', gender: 'male', pitch: 0.7, rate: 1.0 },
  fr_mathieu: { id: 'fr_mathieu', name: 'Mathieu', lang: 'fr-FR', gender: 'male', pitch: 0.7, rate: 1.0 },
  mathieu: { id: 'fr_mathieu', name: 'Mathieu', lang: 'fr-FR', gender: 'male', pitch: 0.7, rate: 1.0 },
  it_giorgio: { id: 'it_giorgio', name: 'Giorgio', lang: 'it-IT', gender: 'male', pitch: 0.7, rate: 1.0 },
  giorgio: { id: 'it_giorgio', name: 'Giorgio', lang: 'it-IT', gender: 'male', pitch: 0.7, rate: 1.0 },
  de_hans: { id: 'de_hans', name: 'Hans', lang: 'de-DE', gender: 'male', pitch: 0.65, rate: 0.95 },
  hans: { id: 'de_hans', name: 'Hans', lang: 'de-DE', gender: 'male', pitch: 0.65, rate: 0.95 },
  ja_takumi: { id: 'ja_takumi', name: 'Takumi', lang: 'ja-JP', gender: 'male', pitch: 0.8, rate: 1.1 },
  takumi: { id: 'ja_takumi', name: 'Takumi', lang: 'ja-JP', gender: 'male', pitch: 0.8, rate: 1.1 },
  ja_mizuki: { id: 'ja_mizuki', name: 'Mizuki', lang: 'ja-JP', gender: 'female', pitch: 1.25, rate: 1.05 },
  mizuki: { id: 'ja_mizuki', name: 'Mizuki', lang: 'ja-JP', gender: 'female', pitch: 1.25, rate: 1.05 },

  // Fallbacks
  es_001: { id: 'es_mx_mia', name: 'Mia', lang: 'es-MX', gender: 'female', pitch: 1.15, rate: 1.0 },
  es_female: { id: 'es_mx_mia', name: 'Mia', lang: 'es-MX', gender: 'female', pitch: 1.15, rate: 1.0 },
  es_male: { id: 'es_us_miguel', name: 'Miguel', lang: 'es-US', gender: 'male', pitch: 0.65, rate: 1.0 },
  es_002: { id: 'es_es_conchita', name: 'Conchita', lang: 'es-ES', gender: 'female', pitch: 1.1, rate: 1.0 },
  'es-es-standard-a': { id: 'es_es_enrique', name: 'Enrique', lang: 'es-ES', gender: 'male', pitch: 0.62, rate: 1.05 },
  en_001: { id: 'en_brian', name: 'Brian', lang: 'en-GB', gender: 'male', pitch: 0.7, rate: 0.95 },
  en_002: { id: 'en_emma', name: 'Emma', lang: 'en-GB', gender: 'female', pitch: 1.15, rate: 1.0 }
};

const FISH_AUDIO_KEYS = [
  'es_ar_messi', 'messi', 'lionel_messi', 'leo_messi',
  'es_ve_maduro', 'maduro', 'nicolas_maduro',
  'es_tiktok', 'tiktok', 'voz_tiktok',
  'es_mx_homero', 'homero', 'homero_simpson', 'homer',
  'es_dross', 'dross', 'drossrotzank',
  'es_badbunny', 'badbunny', 'bad_bunny', 'benito',
  'es_rubius', 'rubius', 'elrubius', 'el_rubius',
  'es_farid', 'farid', 'farid_dieck',
  'es_westcol', 'westcol',
  'es_cr7', 'cr7', 'cristiano_ronaldo', 'ronaldo', 'bicho',
  'es_goku', 'goku', 'goku_latino',
  'es_maradona', 'maradona', 'diego_maradona',
  'es_xokas', 'xokas', 'elxokas', 'el_xokas',
  'es_illojuan', 'illojuan', 'illo_juan', 'juan',
  'es_auronplay', 'auron', 'auronplay',
  'es_peruano', 'peruano',
  'es_marianocloss', 'marianocloss', 'mariano_closs', 'closs',
  'es_lacobra', 'lacobra', 'la_cobra', 'cobra',
  'es_davo', 'davo', 'davoxeneize', 'davo_xeneize'
];

function getTTSAudioUrl(text, voiceId) {
  const clean = (voiceId || '').toString().toLowerCase().trim().replace(/^[-@/]/, '').replace(/^voice:/, '');
  if (FISH_AUDIO_KEYS.includes(clean)) {
    return `/api/tts/audio?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(clean)}`;
  }
  const seVoiceMap = {
    es_mx_mia: 'Mia', mia: 'Mia',
    es_us_miguel: 'Miguel', miguel: 'Miguel',
    es_us_penelope: 'Penelope', penelope: 'Penelope',
    es_es_enrique: 'Enrique', enrique: 'Enrique',
    es_es_conchita: 'Conchita', conchita: 'Conchita',
    es_es_lucia: 'Lucia', lucia: 'Lucia',
    en_brian: 'Brian', brian: 'Brian',
    en_emma: 'Emma', emma: 'Emma',
    en_joey: 'Joey', joey: 'Joey',
    en_matthew: 'Matthew', matthew: 'Matthew',
    en_kendra: 'Kendra', kendra: 'Kendra',
    en_justin: 'Justin', justin: 'Justin',
    en_russell: 'Russell', russell: 'Russell',
    pt_cristiano: 'Cristiano', cristiano: 'Cristiano',
    fr_mathieu: 'Mathieu', mathieu: 'Mathieu',
    it_giorgio: 'Giorgio', giorgio: 'Giorgio',
    de_hans: 'Hans', hans: 'Hans',
    ja_takumi: 'Takumi', takumi: 'Takumi',
    ja_mizuki: 'Mizuki', mizuki: 'Mizuki'
  };
  const seVoice = seVoiceMap[clean];
  if (seVoice) {
    return `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(seVoice)}&text=${encodeURIComponent(text)}`;
  }
  const profile = VOICE_PROFILES[clean] || VOICE_PROFILES[voiceId] || VOICE_PROFILES['es_mx_mia'] || {};
  const lang = (profile.lang || 'es-ES').split('-')[0];
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
}

function playTTSAudioLocal(text, voiceKey, volume = 0.9, onEnd = null) {
  const cleanKey = (voiceKey || '').toString().toLowerCase().trim().replace(/^[-@/]/, '').replace(/^voice:/, '');
  const profile = VOICE_PROFILES[cleanKey] || VOICE_PROFILES[voiceKey] || VOICE_PROFILES['es_mx_mia'];
  const targetLang = (profile.lang || 'es-ES').split('-')[0].toLowerCase();

  // Si es voz IA (Fish Audio), reproducir directamente desde /api/tts/audio
  if (FISH_AUDIO_KEYS.includes(cleanKey)) {
    const directUrl = `/api/tts/audio?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(cleanKey)}`;
    const a = new Audio(directUrl);
    a.volume = volume;
    if (onEnd) a.onended = onEnd;
    a.onerror = () => {
      fallbackSpeechSynthLocal();
    };
    a.play().catch(() => {
      fallbackSpeechSynthLocal();
    });
    return;
  }

  if (!('speechSynthesis' in window)) {
    const audioUrl = getTTSAudioUrl(text, cleanKey);
    const a = new Audio(audioUrl);
    a.volume = volume;
    if (onEnd) a.onended = onEnd;
    a.play().catch(() => { if (onEnd) onEnd(); });
    return;
  }

  fallbackSpeechSynthLocal();

  function fallbackSpeechSynthLocal() {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.volume = volume;
      utterance.rate = profile.rate || 1.0;
      utterance.pitch = profile.pitch || 1.0;
      utterance.lang = profile.lang || 'es-ES';

      const voices = window.speechSynthesis.getVoices() || [];
      let matchedVoice = null;

      if (profile.gender === 'male') {
        matchedVoice = voices.find(v => {
          const vLang = v.lang.toLowerCase();
          const vName = v.name.toLowerCase();
          return (vLang.startsWith(targetLang) || (targetLang === 'es' && vLang.startsWith('es'))) &&
            (vName.includes('male') || vName.includes('david') || vName.includes('raul') || vName.includes('pablo') ||
             vName.includes('jorge') || vName.includes('alvaro') || vName.includes('enrique') || vName.includes('carlos') ||
             vName.includes('miguel') || vName.includes('george') || vName.includes('mark') || vName.includes('stefan') ||
             vName.includes('guy') || vName.includes('cosimo') || vName.includes('keita'));
        });
      } else {
        matchedVoice = voices.find(v => {
          const vLang = v.lang.toLowerCase();
          const vName = v.name.toLowerCase();
          return (vLang.startsWith(targetLang) || (targetLang === 'es' && vLang.startsWith('es'))) &&
            (vName.includes('female') || vName.includes('zira') || vName.includes('sabina') || vName.includes('helena') ||
             vName.includes('laura') || vName.includes('monica') || vName.includes('mia') || vName.includes('lucia') ||
             vName.includes('conchita') || vName.includes('susan') || vName.includes('hazel'));
        });
      }

      if (!matchedVoice) {
        matchedVoice = voices.find(v => v.lang.toLowerCase().startsWith(targetLang));
      }
      if (!matchedVoice) {
        matchedVoice = voices.find(v => v.lang.toLowerCase().startsWith('es') || v.lang.toLowerCase().startsWith('en'));
      }

      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onend = () => { if (onEnd) onEnd(); };
      utterance.onerror = () => { if (onEnd) onEnd(); };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      if (onEnd) onEnd();
    }
  }
}

async function triggerTestTTS() {
  if (!isStreamerLoggedIn()) {
    showToast('⚠️ Debes iniciar sesión o vincular un canal para probar TTS en OBS Studio.', 'warn');
    return;
  }
  const input = document.getElementById('testTtsInput');
  const text = (input ? input.value.trim() : '') || '¡Hola streamer! Este es un mensaje de prueba con Text to Speech en OBS.';
  const defaultVoice = document.getElementById('cfgTtsVoice')?.value || 'es_mx_mia';
  const volume = Number(document.getElementById('cfgTtsVolume')?.value || 90) / 100;
  const rate = Number(document.getElementById('cfgTtsRate')?.value || 1.0);
  const pitch = Number(document.getElementById('cfgTtsPitch')?.value || 1.0);

  // Detección multi-voz en la prueba local
  const commands = cachedTTSCommands.length ? cachedTTSCommands : (storage?.getTtsCommands ? storage.getTtsCommands() : []);
  const words = text.split(/\s+/);
  const triggerMap = new Map();
  commands.forEach(c => {
    if (c.command) triggerMap.set(c.command.toLowerCase().trim(), c);
  });

  const segments = [];
  let curVoice = defaultVoice;
  let curVoiceName = 'Voz';
  let curWords = [];

  for (const word of words) {
    const cleanW = word.toLowerCase().trim();
    const matched = triggerMap.get(cleanW) || triggerMap.get(cleanW.startsWith('!') ? cleanW : `!${cleanW}`);
    if (matched) {
      if (curWords.length > 0) {
        segments.push({
          voice: curVoice,
          voiceName: curVoiceName,
          text: curWords.join(' '),
          audioUrl: getTTSAudioUrl(curWords.join(' '), curVoice)
        });
        curWords = [];
      }
      curVoice = matched.voiceId || curVoice;
      curVoiceName = matched.name || 'Voz';
    } else {
      curWords.push(word);
    }
  }

  if (curWords.length > 0) {
    segments.push({
      voice: curVoice,
      voiceName: curVoiceName,
      text: curWords.join(' '),
      audioUrl: getTTSAudioUrl(curWords.join(' '), curVoice)
    });
  }

  const primaryVoice = segments[0]?.voice || defaultVoice;
  const primaryAudioUrl = segments[0]?.audioUrl || getTTSAudioUrl(text, primaryVoice);
  const eventId = 'tts_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

  const ttsData = {
    id: eventId,
    user: 'StreamerTest',
    text,
    voice: primaryVoice,
    segments: segments.length > 0 ? segments : [{ voice: primaryVoice, text, audioUrl: primaryAudioUrl }],
    volume,
    rate,
    pitch,
    audioUrl: primaryAudioUrl,
    timestamp: Date.now()
  };

  // Transmitir inmediatamente por MQTT y WebSocket a la fuente de OBS
  broadcastEvent('tts', ttsData);
  showToast('🗣️ Mensaje TTS enviado a OBS Studio', 'success');

  // Preview local secuencial si hay múltiples segmentos
  if (segments.length > 1) {
    let segIdx = 0;
    function playNextLocalSeg() {
      if (segIdx >= segments.length) return;
      const seg = segments[segIdx++];
      playTTSAudioLocal(seg.text, seg.voice, volume, playNextLocalSeg);
    }
    playNextLocalSeg();
  } else {
    playTTSAudioLocal(text, primaryVoice, volume);
  }

  try {
    const room = getActiveStreamerRoom();
    await fetch('/api/tts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: eventId, text, user: 'StreamerTest', voice: primaryVoice, room })
    });
  } catch (e) { }
}

// ================= TTS MULTI-VOICE SYSTEM & VOICE LIBRARY =================
const DEFAULT_VOICE_CATALOG = [
  // --- Voces IA (Fish Audio) ---
  {
    id: 'es_ar_messi',
    name: 'Lionel Messi',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'futbol', 'argentina'],
    lang: 'es-AR',
    defaultCommand: '!messi',
    stats: { uses: '1.2M', downloads: '8.5k' },
    previewText: 'Hola gente del stream, ¿qué mirás bobo? Andá pa allá.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'e3ded66586764591a457fcdaba8a268b'
  },
  {
    id: 'es_ve_maduro',
    name: 'Nicolás Maduro',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'politica'],
    lang: 'es-VE',
    defaultCommand: '!maduro',
    stats: { uses: '890k', downloads: '5.1k' },
    previewText: 'Compatriotas, los saludo a todos en el stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'b011ad1198284358b766a597f6fdd171'
  },
  {
    id: 'es_tiktok',
    name: 'Voz TikTok',
    category: 'memes',
    tags: ['popular', 'trending', 'ia', 'tiktok'],
    lang: 'es-MX',
    defaultCommand: '!tiktok',
    stats: { uses: '1.5M', downloads: '9.2k' },
    previewText: 'Esta es la clásica voz que escuchas en todos los videos de TikTok.',
    gender: 'female',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '1505e291ec504760a285fd163a78b5eb'
  },
  {
    id: 'es_mx_homero',
    name: 'Homero Simpson',
    category: 'tv',
    tags: ['popular', 'trending', 'ia', 'simpsons', 'caricatura'],
    lang: 'es-MX',
    defaultCommand: '!homero',
    stats: { uses: '1.1M', downloads: '7.8k' },
    previewText: '¡Ouch! ¡Mmm, rosquillas! Hola muchachos del chat.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '134d19eda4c64cb0b2a84d93e327be3b'
  },
  {
    id: 'es_dross',
    name: 'Dross Rotzank',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'terror', 'youtube'],
    lang: 'es-VE',
    defaultCommand: '!dross',
    stats: { uses: '940k', downloads: '6.4k' },
    previewText: 'Mi libro Luna de Plutón ya está disponible. Te ha hablado Dross y te deseo buenas noches.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'd9f0d3d3fe734af6acb5ecc9129bc49a'
  },
  {
    id: 'es_badbunny',
    name: 'Bad Bunny',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'musica', 'trap'],
    lang: 'es-PR',
    defaultCommand: '!badbunny',
    stats: { uses: '850k', downloads: '5.9k' },
    previewText: 'Ey, Benito en el stream. La noche de anoche fue una noche de locura.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '9b30f7190dbe49acb731345e70366cf7'
  },
  {
    id: 'es_rubius',
    name: 'ElRubius',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'gaming'],
    lang: 'es-ES',
    defaultCommand: '!rubius',
    stats: { uses: '780k', downloads: '4.8k' },
    previewText: '¡Muy buenas criaturitas del señor! Bienvenidos al stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '39382efbc7584d428f0f789d882cd3b8'
  },
  {
    id: 'es_farid',
    name: 'Farid Dieck',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'reflexion', 'motivacion'],
    lang: 'es-MX',
    defaultCommand: '!farid',
    stats: { uses: '890k', downloads: '6.2k' },
    previewText: 'Las cosas no pasan por algo, pasan para algo. Saludos a todos en el stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'dfa5b230c8054f429e434f4a6e9bbdec'
  },
  {
    id: 'es_westcol',
    name: 'WestCol',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'colombia'],
    lang: 'es-CO',
    defaultCommand: '!westcol',
    stats: { uses: '1.4M', downloads: '9.8k' },
    previewText: '¡Qué hubo pues parceros! Bienvenidos a la transmisión.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '1e5d99568ab847f499bb1d65be15afd6'
  },
  {
    id: 'es_cr7',
    name: 'Cristiano Ronaldo',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'futbol', 'cr7', 'siuuu'],
    lang: 'es-ES',
    defaultCommand: '!cr7',
    stats: { uses: '2.3M', downloads: '18k' },
    previewText: '¡Siuuu! Aquí el bicho mandando un saludo a toda la gente del chat.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '3521525edb80495e9ad276fc86c7a5e9'
  },
  {
    id: 'es_goku',
    name: 'Goku (Latino)',
    category: 'anime',
    tags: ['popular', 'trending', 'ia', 'anime', 'dragonball'],
    lang: 'es-MX',
    defaultCommand: '!goku',
    stats: { uses: '1.6M', downloads: '11k' },
    previewText: '¡Hola, soy Goku! ¡Levanten las manos para darme su energía!',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '9f850ee9ada24b20a6866825eaefd3f8'
  },
  {
    id: 'es_maradona',
    name: 'Diego Maradona',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'futbol', 'argentina', 'd10s'],
    lang: 'es-AR',
    defaultCommand: '!maradona',
    stats: { uses: '1.1M', downloads: '7.5k' },
    previewText: 'Eeee... la pelota no se mancha. Saludos a todo el stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '51f0a7c29e5f4743a84e41250898d293'
  },
  {
    id: 'es_xokas',
    name: 'El Xokas',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'gaming', 'twitch'],
    lang: 'es-ES',
    defaultCommand: '!xokas',
    stats: { uses: '1.3M', downloads: '8.9k' },
    previewText: '¡Esto es una locura! Soy el número uno y nadie me supera.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '8f23453397d14e4d9a579bad5aab41a8'
  },
  {
    id: 'es_illojuan',
    name: 'IlloJuan',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'malaga', 'twitch'],
    lang: 'es-ES',
    defaultCommand: '!illojuan',
    stats: { uses: '1.2M', downloads: '8.1k' },
    previewText: '¡Illo qué pasa cabeza! Un abrazo muy fuerte pa toda la gente del stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '97582f301e1c4f93a514ceda15e23e26'
  },
  {
    id: 'es_auronplay',
    name: 'Auronplay',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'twitch', 'youtube', 'espana'],
    lang: 'es-ES',
    defaultCommand: '!auron',
    stats: { uses: '2.1M', downloads: '15k' },
    previewText: '¡Hey, muy buenas a todos! Saludos a toda la gente del chat.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'cfc4b2bd851a49538201d20205ba9052'
  },
  {
    id: 'es_peruano',
    name: 'Peruano',
    category: 'memes',
    tags: ['popular', 'trending', 'ia', 'peru', 'meme', 'regional'],
    lang: 'es-PE',
    defaultCommand: '!peruano',
    stats: { uses: '1.7M', downloads: '12k' },
    previewText: '¡Habla causa! ¿Cómo estás pe? Saludos a toda la gente del stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: 'fc108d05e7984d4f8845381613e04209'
  },
  {
    id: 'es_marianocloss',
    name: 'Mariano Closs',
    category: 'celebrity',
    tags: ['popular', 'trending', 'ia', 'futbol', 'relator', 'argentina', 'libertadores'],
    lang: 'es-AR',
    defaultCommand: '!closs',
    stats: { uses: '1.9M', downloads: '14k' },
    previewText: '¡Señoras y señores! ¡Buenas noches para todos en esta transmisión!',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '5544ecf43b14452fa0ce23d888823367'
  },
  {
    id: 'es_lacobra',
    name: 'La Cobra',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'futbol', 'argentina', 'kick', 'twitch'],
    lang: 'es-AR',
    defaultCommand: '!lacobra',
    stats: { uses: '1.5M', downloads: '10.5k' },
    previewText: '¡Pero qué decís amigo! ¡Es una locura total lo que estamos viviendo en este stream!',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '5458dad9c902431cb0dbb37703160cb7'
  },
  {
    id: 'es_davo',
    name: 'Davo Xeneize',
    category: 'streamer',
    tags: ['popular', 'trending', 'ia', 'streamer', 'boca', 'argentina', 'twitch'],
    lang: 'es-AR',
    defaultCommand: '!davo',
    stats: { uses: '1.8M', downloads: '13k' },
    previewText: 'Buenas noches a todos muchachos, ¿cómo andan? Bienvenidos a un nuevo stream.',
    gender: 'male',
    isAI: true,
    model: 's2.1-pro-free',
    referenceId: '51ea54dc9b7d46b49a58918742c1a2cd'
  },

  // --- Voces Estándar ---
  {
    id: 'es_mx_mia',
    name: 'Mia (Español Latino)',
    category: 'standard',
    tags: ['recent', 'latino', 'femenino'],
    lang: 'es-MX',
    defaultCommand: '!mia',
    stats: { uses: '620k', downloads: '3.1k' },
    previewText: 'Hola streamer, soy Mia con voz en español latino.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'es_us_miguel',
    name: 'Miguel (Español Latino)',
    category: 'standard',
    tags: ['recent', 'latino', 'masculino'],
    lang: 'es-US',
    defaultCommand: '!miguel',
    stats: { uses: '450k', downloads: '2.4k' },
    previewText: 'Saludos a toda la comunidad del canal.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'es_us_lupe',
    name: 'Lupe (Español Neutro)',
    category: 'standard',
    tags: ['recent', 'neutro', 'femenino'],
    lang: 'es-US',
    defaultCommand: '!lupe',
    stats: { uses: '310k', downloads: '1.5k' },
    previewText: 'Esta es la voz de Lupe para tus alertas de chat.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'es_us_penelope',
    name: 'Penélope (Español US)',
    category: 'standard',
    tags: ['recent', 'femenino'],
    lang: 'es-US',
    defaultCommand: '!penelope',
    stats: { uses: '280k', downloads: '1.2k' },
    previewText: 'Mensaje de voz en español neutro con Penélope.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'es_es_enrique',
    name: 'Enrique (Castellano)',
    category: 'standard',
    tags: ['recent', 'españa', 'masculino'],
    lang: 'es-ES',
    defaultCommand: '!enrique',
    stats: { uses: '510k', downloads: '2.8k' },
    previewText: 'Hola a todos chavales, aquí Enrique desde España.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'es_es_conchita',
    name: 'Conchita (Castellano)',
    category: 'standard',
    tags: ['recent', 'españa', 'femenino'],
    lang: 'es-ES',
    defaultCommand: '!conchita',
    stats: { uses: '390k', downloads: '1.9k' },
    previewText: 'Voz clásica en castellano con Conchita.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'es_es_lucia',
    name: 'Lucía (Castellano Natural)',
    category: 'standard',
    tags: ['recent', 'españa', 'femenino'],
    lang: 'es-ES',
    defaultCommand: '!lucia',
    stats: { uses: '340k', downloads: '1.7k' },
    previewText: 'Voz natural en castellano para tus mensajes de TTS.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'en_brian',
    name: 'Brian (English UK Classic)',
    category: 'standard',
    tags: ['popular', 'english', 'meme', 'classic'],
    lang: 'en-GB',
    defaultCommand: '!brian',
    stats: { uses: '2.1M', downloads: '15k' },
    previewText: 'Hello there, I am Brian the classic Twitch TTS voice.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'en_emma',
    name: 'Emma (English UK)',
    category: 'standard',
    tags: ['recent', 'english', 'femenino'],
    lang: 'en-GB',
    defaultCommand: '!emma',
    stats: { uses: '420k', downloads: '2.1k' },
    previewText: 'Greetings to everyone in the stream chat.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'en_joey',
    name: 'Joey (English US)',
    category: 'standard',
    tags: ['recent', 'english', 'masculino'],
    lang: 'en-US',
    defaultCommand: '!joey',
    stats: { uses: '360k', downloads: '1.8k' },
    previewText: 'Hey what is going on stream! Joey here.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'en_matthew',
    name: 'Matthew (English US)',
    category: 'standard',
    tags: ['recent', 'english', 'masculino'],
    lang: 'en-US',
    defaultCommand: '!matthew',
    stats: { uses: '290k', downloads: '1.4k' },
    previewText: 'Welcome to the live broadcast.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'en_kendra',
    name: 'Kendra (English US)',
    category: 'standard',
    tags: ['recent', 'english', 'femenino'],
    lang: 'en-US',
    defaultCommand: '!kendra',
    stats: { uses: '310k', downloads: '1.5k' },
    previewText: 'This is Kendra reading your chat donation.',
    gender: 'female',
    isAI: false
  },
  {
    id: 'en_justin',
    name: 'Justin (English US Young)',
    category: 'standard',
    tags: ['recent', 'english', 'joven'],
    lang: 'en-US',
    defaultCommand: '!justin',
    stats: { uses: '240k', downloads: '1.1k' },
    previewText: 'Hey guys, Justin speaking!',
    gender: 'male',
    isAI: false
  },
  {
    id: 'en_russell',
    name: 'Russell (English Australia)',
    category: 'standard',
    tags: ['recent', 'australia'],
    lang: 'en-AU',
    defaultCommand: '!russell',
    stats: { uses: '190k', downloads: '980' },
    previewText: 'G day mate, having a great stream today.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'pt_cristiano',
    name: 'Cristiano (Português)',
    category: 'standard',
    tags: ['recent', 'brasil', 'portugal'],
    lang: 'pt-BR',
    defaultCommand: '!cristiano',
    stats: { uses: '370k', downloads: '2.3k' },
    previewText: 'Olá a todos no chat do canal.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'fr_mathieu',
    name: 'Mathieu (Français)',
    category: 'standard',
    tags: ['recent', 'frances'],
    lang: 'fr-FR',
    defaultCommand: '!mathieu',
    stats: { uses: '180k', downloads: '890' },
    previewText: 'Bonjour à tous sur le live stream.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'it_giorgio',
    name: 'Giorgio (Italiano)',
    category: 'standard',
    tags: ['recent', 'italiano'],
    lang: 'it-IT',
    defaultCommand: '!giorgio',
    stats: { uses: '160k', downloads: '750' },
    previewText: 'Ciao a todos, benvenuti nella directa.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'de_hans',
    name: 'Hans (Deutsch)',
    category: 'standard',
    tags: ['recent', 'aleman'],
    lang: 'de-DE',
    defaultCommand: '!hans',
    stats: { uses: '140k', downloads: '680' },
    previewText: 'Hallo zusammen im Live Stream.',
    gender: 'male',
    isAI: false
  },
  {
    id: 'ja_takumi',
    name: 'Takumi (日本語 Anime)',
    category: 'anime',
    tags: ['popular', 'japon', 'anime'],
    lang: 'ja-JP',
    defaultCommand: '!takumi',
    stats: { uses: '490k', downloads: '3.2k' },
    previewText: '皆さん、こんにちは！配信へようこそ。',
    gender: 'male',
    isAI: false
  },
  {
    id: 'ja_mizuki',
    name: 'Mizuki (日本語 Femenino)',
    category: 'anime',
    tags: ['popular', 'japon', 'anime', 'femenino'],
    lang: 'ja-JP',
    defaultCommand: '!mizuki',
    stats: { uses: '430k', downloads: '2.9k' },
    previewText: 'こんにちは！チャットの皆さん、よろしくお願いします。',
    gender: 'female',
    isAI: false
  }
];

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

function mergeVoiceCatalogs(primaryList = [], secondaryList = []) {
  const map = new Map();
  for (const v of primaryList) {
    if (v && v.id) map.set(v.id.toLowerCase().trim(), { ...v });
  }
  for (const v of secondaryList) {
    if (v && v.id) {
      const key = v.id.toLowerCase().trim();
      const existing = map.get(key);
      if (existing) {
        map.set(key, { ...existing, ...v });
      } else {
        map.set(key, { ...v });
      }
    }
  }
  return Array.from(map.values());
}

let cachedTTSCommands = [...DEFAULT_TTS_COMMANDS];
let cachedVoiceLibrary = [...DEFAULT_VOICE_CATALOG];
let activeVoiceCategory = 'popular';
let activeTTSPreviewAudio = null;

function initTTSMultiVoiceSystem() {
  // 1. Sub-tabs switching
  const subtabBtns = document.querySelectorAll('.tts-subtab-btn');
  subtabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetSubtab = btn.getAttribute('data-subtab');
      subtabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.tts-subtab-content').forEach(pane => {
        pane.classList.remove('active');
      });
      const targetPane = document.getElementById(targetSubtab);
      if (targetPane) targetPane.classList.add('active');

      if (targetSubtab === 'tts-subtab-library') {
        loadVoiceLibrary('', activeVoiceCategory);
      } else if (targetSubtab === 'tts-subtab-queue') {
        loadTTSQueue();
      }
    });
  });

  // 2. Switch to Voice Library button in header
  const btnSwitch = document.getElementById('btnSwitchToVoiceLib');
  if (btnSwitch) {
    btnSwitch.addEventListener('click', () => {
      const libTabBtn = document.querySelector('.tts-subtab-btn[data-subtab="tts-subtab-library"]');
      if (libTabBtn) libTabBtn.click();
    });
  }

  // 3. Voice Library Search
  const searchInput = document.getElementById('voiceLibrarySearch');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadVoiceLibrary(searchInput.value.trim(), activeVoiceCategory);
      }, 200);
    });
  }

  // 4. Voice Library Category Filters
  const filterBtns = document.querySelectorAll('.voice-filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeVoiceCategory = btn.getAttribute('data-category') || 'all';
      const q = searchInput ? searchInput.value.trim() : '';
      loadVoiceLibrary(q, activeVoiceCategory);
    });
  });

  // 5. Sort Select for Commands
  const sortSelect = document.getElementById('ttsSortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      renderTTSCommands(cachedTTSCommands);
    });
  }

  // 6. Cargar comandos iniciales
  loadTTSCommands();
}

function mergeDefaultTTSCommands(userCmds = []) {
  const map = new Map();
  if (typeof DEFAULT_TTS_COMMANDS !== 'undefined' && Array.isArray(DEFAULT_TTS_COMMANDS)) {
    for (const def of DEFAULT_TTS_COMMANDS) {
      if (def && def.command) {
        map.set(def.command.toLowerCase().trim(), { ...def });
      }
    }
  }
  if (Array.isArray(userCmds)) {
    for (const u of userCmds) {
      if (u && u.command) {
        const key = u.command.toLowerCase().trim();
        const existing = map.get(key);
        if (existing) {
          map.set(key, { ...existing, ...u });
        } else {
          map.set(key, { ...u });
        }
      }
    }
  }
  return Array.from(map.values());
}

async function loadTTSCommands() {
  let loaded = null;
  try {
    const res = await fetch('/api/tts/commands');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        loaded = data;
      }
    }
  } catch (err) {
    console.warn('Error loading TTS commands from API:', err);
  }

  if (!loaded || loaded.length === 0) {
    try {
      const local = localStorage.getItem('orbibot_tts_commands');
      if (local) {
        const parsed = JSON.parse(local);
        if (Array.isArray(parsed) && parsed.length > 0) {
          loaded = parsed;
        }
      }
    } catch (e) { }
  }

  cachedTTSCommands = mergeDefaultTTSCommands(loaded || []);
  renderTTSCommands(cachedTTSCommands);
}

function renderTTSCommands(commands) {
  const container = document.getElementById('ttsCommandsList');
  const countBadge = document.getElementById('ttsCmdCountBadge');
  if (!container) return;

  if (!Array.isArray(commands) || commands.length === 0) {
    commands = mergeDefaultTTSCommands([]);
  }
  cachedTTSCommands = commands;

  try {
    localStorage.setItem('orbibot_tts_commands', JSON.stringify(commands));
  } catch (e) { }

  // Actualizar contador
  if (countBadge) {
    countBadge.innerText = `${commands.length} ${commands.length === 1 ? 'comando' : 'comandos'}`;
  }

  // Aplicar ordenamiento
  const sortSelect = document.getElementById('ttsSortSelect');
  const sortMode = sortSelect ? sortSelect.value : 'az';
  let sorted = [...commands];

  if (sortMode === 'az') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else if (sortMode === 'za') {
    sorted.sort((a, b) => (b.name || '').localeCompare(a.name || ''));
  } else if (sortMode === 'enabled') {
    sorted = sorted.filter(c => c.enabled !== false);
  }

  if (sorted.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; background: #111522; border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
        <p style="color: var(--text-secondary); margin-bottom: 14px; font-size: 14px;">No tienes comandos de voz configurados todavía.</p>
        <button class="btn btn-primary btn-sm" onclick="document.querySelector('.tts-subtab-btn[data-subtab=\\'tts-subtab-library\\']').click()">
          <i class="fas fa-plus"></i> Explorar Biblioteca de Voces
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = sorted.map(cmd => {
    const isEnabled = cmd.enabled !== false;
    const permissions = Array.isArray(cmd.permissions) && cmd.permissions.length ? cmd.permissions : ['todos'];
    const isAll = permissions.includes('todos') || permissions.includes('all');
    const isVip = permissions.includes('vip');
    const isSub = permissions.includes('sub');
    const isMod = permissions.includes('mod');

    return `
      <div class="tts-cmd-row ${isEnabled ? '' : 'disabled'}" id="row_${cmd.id}" data-id="${cmd.id}">
        <!-- Izquierda: Nombre, Previa y Trigger -->
        <div class="tts-cmd-left">
          <div class="tts-cmd-info">
            <div class="tts-cmd-name-row">
              <span class="tts-cmd-name">${escapeHtml(cmd.name)}</span>
              <button class="btn-audio-preview" title="Escuchar previa" onclick="handleTTSVoicePreview('${escapeHtml(cmd.voiceId || cmd.command)}', '${escapeHtml(cmd.name)}', this)">
                <i class="fas fa-volume-up"></i>
              </button>
            </div>
            <div class="tts-cmd-trigger-wrap">
              <span class="tts-cmd-label">COMANDO</span>
              <input type="text" class="tts-cmd-input" value="${escapeHtml(cmd.command || '')}" 
                onchange="handleUpdateTTSCommandTrigger('${cmd.id}', this.value)"
                placeholder="!comando">
            </div>
          </div>
        </div>

        <!-- Centro: Selector de Roles QUIÉN PUEDE USARLA -->
        <div class="tts-cmd-center">
          <span class="tts-roles-label">QUIÉN PUEDE USARLA</span>
          <div class="role-badges">
            <button class="role-pill ${isAll ? 'active' : ''}" data-role="todos" onclick="handleToggleTTSCommandRole('${cmd.id}', 'todos')">Todos</button>
            <button class="role-pill ${isVip ? 'active' : ''}" data-role="vip" onclick="handleToggleTTSCommandRole('${cmd.id}', 'vip')">VIP</button>
            <button class="role-pill ${isSub ? 'active' : ''}" data-role="sub" onclick="handleToggleTTSCommandRole('${cmd.id}', 'sub')">Sub</button>
            <button class="role-pill ${isMod ? 'active' : ''}" data-role="mod" onclick="handleToggleTTSCommandRole('${cmd.id}', 'mod')">Mod</button>
          </div>
        </div>

        <!-- Derecha: Switch de Activación y Botón Eliminar -->
        <div class="tts-cmd-right">
          <label class="lime-switch" title="Activar/Desactivar">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="handleToggleTTSCommandEnabled('${cmd.id}', this.checked)">
            <span class="lime-slider"></span>
          </label>
          <button class="btn-delete-cmd" title="Eliminar de mis comandos" onclick="handleDeleteTTSCommand('${cmd.id}', '${escapeHtml(cmd.name)}')">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function getFilteredVoicesLocal(query = '', category = 'all') {
  let list = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, cachedVoiceLibrary || []);
  if (category && category !== 'all') {
    if (category === 'popular' || category === 'populares') {
      list = list.filter(v => (v.tags && v.tags.includes('popular')) || (v.stats && v.stats.uses && (v.stats.uses.includes('M') || parseInt(v.stats.uses) >= 300)));
    } else if (category === 'recent' || category === 'recientes') {
      list = list.filter(v => (v.tags && v.tags.includes('recent')) || (v.category === 'standard'));
    } else if (category === 'trending' || category === 'tendencia') {
      list = list.filter(v => (v.tags && v.tags.includes('trending')) || v.isAI);
    } else {
      list = list.filter(v => v.category === category || (v.tags && v.tags.includes(category)));
    }
  }
  if (query && query.trim()) {
    const q = query.trim().toLowerCase();
    list = list.filter(v =>
      (v.name || '').toLowerCase().includes(q) ||
      (v.id || '').toLowerCase().includes(q) ||
      (v.defaultCommand || '').toLowerCase().includes(q) ||
      (v.tags && v.tags.some(t => t.toLowerCase().includes(q))) ||
      (v.previewText || '').toLowerCase().includes(q)
    );
  }
  return list;
}

async function loadVoiceLibrary(query = '', category = 'all') {
  const grid = document.getElementById('voiceLibraryGrid');
  const countBadge = document.getElementById('voiceLibraryTotalCount');
  if (!grid) return;

  // 1. Mostrar de inmediato la lista filtrada combinando catálogo por defecto
  cachedVoiceLibrary = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, cachedVoiceLibrary);
  const localList = getFilteredVoicesLocal(query, category);
  if (countBadge) {
    countBadge.innerText = `${localList.length} voces`;
  }
  renderVoiceLibrary(localList);

  // 2. Si hay cliente Supabase disponible, consultar voice_catalog directamente de la base de datos
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('orbibot_settings')
        .select('value')
        .eq('key', 'voice_catalog')
        .limit(1);
      if (!error && data && data.length > 0 && Array.isArray(data[0].value) && data[0].value.length > 0) {
        cachedVoiceLibrary = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, data[0].value);
        const filtered = getFilteredVoicesLocal(query, category);
        if (countBadge) countBadge.innerText = `${filtered.length} voces`;
        renderVoiceLibrary(filtered);
      }
    } catch (e) { }
  }

  // 3. Si hay servidor Node backend disponible, refrescar
  try {
    const res = await fetch(`/api/tts/library?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.voices) && data.voices.length > 0) {
        cachedVoiceLibrary = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, data.voices);
        const filtered = getFilteredVoicesLocal(query, category);
        if (countBadge) {
          countBadge.innerText = `${data.total || filtered.length} voces`;
        }
        renderVoiceLibrary(filtered);
      }
    }
  } catch (err) {
    // Continuar con localList
  }
}

function renderVoiceLibrary(voices) {
  const grid = document.getElementById('voiceLibraryGrid');
  if (!grid) return;

  if (!voices || voices.length === 0) {
    grid.innerHTML = `
      <div style="text-align: center; grid-column: 1 / -1; padding: 40px 20px; color: var(--text-secondary);">
        <i class="fas fa-search" style="font-size: 24px; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
        No se encontraron voces coincidentes con tu búsqueda.
      </div>
    `;
    return;
  }

  const existingVoiceIds = new Set(cachedTTSCommands.map(c => (c.voiceId || c.command || '').toLowerCase().trim()));

  grid.innerHTML = voices.map(v => {
    const isAdded = existingVoiceIds.has(v.id.toLowerCase().trim()) || existingVoiceIds.has((v.defaultCommand || '').toLowerCase().trim());
    const stats = v.stats || { uses: '100k', downloads: '1k' };

    return `
      <div class="voice-catalog-card" data-voice-id="${v.id}">
        <div class="voice-card-left">
          <div class="voice-card-info">
            <span class="voice-card-name" title="${escapeHtml(v.name)}">${escapeHtml(v.name)}</span>
            <div class="voice-card-stats">
              <span><i class="fas fa-bolt" style="color: #a3e635;"></i> ${stats.uses || '50k'}</span>
              <span><i class="fas fa-download"></i> ${stats.downloads || '1k'}</span>
            </div>
          </div>
        </div>
        <div class="voice-card-actions">
          <button class="btn-card-play" title="Escuchar muestra de audio" onclick="handleTTSVoicePreview('${escapeHtml(v.id)}', '${escapeHtml(v.name)}', this)">
            <i class="fas fa-volume-up"></i>
          </button>
          <button class="btn-card-add ${isAdded ? 'added' : ''}" onclick="handleAddVoiceFromLibrary('${escapeHtml(v.id)}', '${escapeHtml(v.name)}', '${escapeHtml(v.defaultCommand || '')}', this)">
            ${isAdded ? '<i class="fas fa-check"></i> Añadido' : '+ Añadir'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function handleTTSVoicePreview(voiceId, voiceName, btnEl) {
  if (activeTTSPreviewAudio) {
    try {
      activeTTSPreviewAudio.pause();
      activeTTSPreviewAudio = null;
    } catch (e) { }
  }

  // Quitar estado activo de otros botones
  document.querySelectorAll('.btn-audio-preview.playing, .btn-card-play.playing').forEach(b => {
    b.classList.remove('playing');
    const icon = b.querySelector('i');
    if (icon && icon.classList.contains('fa-stop')) {
      icon.className = 'fas fa-volume-up';
    }
  });

  if (btnEl) {
    btnEl.classList.add('playing');
    const icon = btnEl.querySelector('i');
    if (icon) icon.className = 'fas fa-stop';
  }

  const sampleText = `¡Hola! Soy la voz de ${voiceName || 'TTS'} para el stream.`;
  const url = getTTSAudioUrl(sampleText, voiceId);

  const audio = new Audio(url);
  activeTTSPreviewAudio = audio;
  audio.volume = Number(document.getElementById('cfgTtsVolume')?.value || 90) / 100;

  function onEnd() {
    if (btnEl) {
      btnEl.classList.remove('playing');
      const icon = btnEl.querySelector('i');
      if (icon) icon.className = 'fas fa-volume-up';
    }
    activeTTSPreviewAudio = null;
  }

  audio.onended = onEnd;
  audio.onerror = () => {
    // Fallback con síntesis local
    playTTSAudioLocal(sampleText, voiceId, audio.volume, onEnd);
  };

  audio.play().catch(() => {
    playTTSAudioLocal(sampleText, voiceId, audio.volume, onEnd);
  });
}

async function handleAddVoiceFromLibrary(voiceId, voiceName, defaultCommand, btnEl) {
  const trigger = defaultCommand || `!${voiceId.replace(/^es_|^en_|^pt_|^ja_/, '')}`;
  const newCmd = {
    voiceId,
    name: voiceName,
    command: trigger,
    permissions: ['todos'],
    enabled: true
  };

  try {
    const res = await fetch('/api/tts/commands/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCmd)
    });

    if (res.ok) {
      const data = await res.json();
      cachedTTSCommands = data.commands || cachedTTSCommands;
      if (btnEl) {
        btnEl.classList.add('added');
        btnEl.innerHTML = '<i class="fas fa-check"></i> Añadido';
      }
      renderTTSCommands(cachedTTSCommands);
      saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});
      showToast(`✨ Voz "${voiceName}" agregada a tus comandos con "${trigger}"`, 'success');
      return;
    }
  } catch (err) {
    console.warn('Error adding voice from library:', err);
  }

  // Fallback local
  cachedTTSCommands.unshift({ ...newCmd, id: 'tts_cmd_' + Date.now() });
  renderTTSCommands(cachedTTSCommands);
  saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});
  if (btnEl) {
    btnEl.classList.add('added');
    btnEl.innerHTML = '<i class="fas fa-check"></i> Añadido';
  }
  showToast(`✨ Voz "${voiceName}" agregada a tus comandos`, 'success');
}

async function handleToggleTTSCommandRole(commandId, role) {
  const cmd = cachedTTSCommands.find(c => c.id === commandId);
  if (!cmd) return;

  let permissions = Array.isArray(cmd.permissions) ? [...cmd.permissions] : ['todos'];

  if (role === 'todos') {
    if (permissions.includes('todos')) {
      permissions = ['vip'];
    } else {
      permissions = ['todos'];
    }
  } else {
    // Si tenía 'todos', removerlo
    permissions = permissions.filter(p => p !== 'todos' && p !== 'all');
    if (permissions.includes(role)) {
      permissions = permissions.filter(p => p !== role);
      if (permissions.length === 0) permissions = ['todos'];
    } else {
      permissions.push(role);
    }
  }

  cmd.permissions = permissions;
  renderTTSCommands(cachedTTSCommands);
  saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});

  try {
    await fetch(`/api/tts/commands/${encodeURIComponent(commandId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions })
    });
  } catch (e) { }
}

async function handleToggleTTSCommandEnabled(commandId, isChecked) {
  const cmd = cachedTTSCommands.find(c => c.id === commandId);
  if (!cmd) return;

  cmd.enabled = Boolean(isChecked);
  const row = document.getElementById(`row_${commandId}`);
  if (row) {
    if (isChecked) row.classList.remove('disabled');
    else row.classList.add('disabled');
  }
  saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});

  try {
    await fetch(`/api/tts/commands/${encodeURIComponent(commandId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: Boolean(isChecked) })
    });
  } catch (e) { }
}

async function handleUpdateTTSCommandTrigger(commandId, newTrigger) {
  const cleanTrigger = (newTrigger || '').trim();
  if (!cleanTrigger) return;
  const formatted = cleanTrigger.startsWith('!') ? cleanTrigger : `!${cleanTrigger}`;

  const cmd = cachedTTSCommands.find(c => c.id === commandId);
  if (cmd) {
    cmd.command = formatted;
  }
  saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});

  try {
    await fetch(`/api/tts/commands/${encodeURIComponent(commandId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: formatted })
    });
    showToast(`Comando actualizado a "${formatted}"`, 'success');
  } catch (e) { }
}

async function handleDeleteTTSCommand(commandId, voiceName) {
  if (!confirm(`¿Estás seguro de que deseas eliminar el comando de voz para "${voiceName || 'esta voz'}"?`)) {
    return;
  }

  cachedTTSCommands = cachedTTSCommands.filter(c => c.id !== commandId);
  renderTTSCommands(cachedTTSCommands);
  saveToAllSupabaseScopes('tts_commands', cachedTTSCommands).catch(() => {});

  try {
    await fetch(`/api/tts/commands/${encodeURIComponent(commandId)}`, {
      method: 'DELETE'
    });
    showToast(`Comando de voz eliminado`, 'info');
  } catch (e) { }
}

// ================= TTS QUEUE & PLAYBACK CONTROLS =================
let cachedTTSQueue = { current: null, queue: [] };

async function loadTTSQueue(showFeedback = false) {
  const container = document.getElementById('ttsQueueContainer');
  const badge = document.getElementById('ttsQueueCountBadge');
  if (!container) return;

  try {
    const res = await fetch('/api/tts/queue');
    if (res.ok) {
      const data = await res.json();
      cachedTTSQueue.queue = Array.isArray(data.queue) ? data.queue : [];
      renderTTSQueue(cachedTTSQueue);
      if (showFeedback) showToast('📋 Cola de TTS actualizada', 'info');
      return;
    }
  } catch (e) {
    console.warn('Error loading TTS queue:', e);
  }
  renderTTSQueue(cachedTTSQueue);
}

function renderTTSQueue(queueState) {
  const container = document.getElementById('ttsQueueContainer');
  const badge = document.getElementById('ttsQueueCountBadge');
  if (!container) return;

  const list = Array.isArray(queueState?.queue) ? queueState.queue : (Array.isArray(queueState) ? queueState : []);
  if (badge) {
    badge.innerText = `${list.length} ${list.length === 1 ? 'en cola' : 'en cola'}`;
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 20px; background: rgba(17, 21, 34, 0.6); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
        <div style="font-size: 36px; margin-bottom: 10px;">🗣️</div>
        <h4 style="font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px;">No hay mensajes en cola actualmente</h4>
        <p style="color: var(--text-secondary); font-size: 13px; max-width: 440px; margin: 0 auto;">
          Cuando los espectadores envíen mensajes de voz con <code>!tts</code> o comandos como <code>!messi</code>, <code>!auron</code>, <code>!homero</code>, aparecerán listados aquí en orden de llegada.
        </p>
      </div>
    `;
    return;
  }

  const currentItem = list[0];
  const pendingItems = list.slice(1);

  let currentHtml = '';
  if (currentItem) {
    const voiceName = currentItem.voiceName || (VOICE_PROFILES[currentItem.voice]?.name || currentItem.voice || 'TTS');
    currentHtml = `
      <div style="background: linear-gradient(135deg, rgba(145, 70, 255, 0.15), rgba(0, 242, 254, 0.08)); border: 1.5px solid var(--primary-purple); border-radius: 12px; padding: 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="background: var(--primary-purple); color: #fff; font-size: 11px; font-weight: 800; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.5px;">
              🔊 Sonando Ahora
            </span>
            <strong style="font-size: 15px; color: #fff;">@${escapeHtml(currentItem.user || 'Espectador')}</strong>
            <span style="font-size: 12px; color: var(--cyan-accent); background: rgba(0,242,254,0.1); padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(0,242,254,0.2);">
              🎙️ ${escapeHtml(voiceName)}
            </span>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" onclick="handleTtsSkip()" title="Saltar al siguiente">
              <i class="fas fa-forward"></i> Saltar
            </button>
            <button class="btn btn-danger btn-sm" onclick="handleTtsStop()" title="Detener reproducción">
              <i class="fas fa-stop"></i> Detener
            </button>
          </div>
        </div>
        <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 12px 14px; font-size: 14px; color: #f1f5f9; line-height: 1.5; font-style: italic;">
          "${escapeHtml(currentItem.text || '')}"
        </div>
      </div>
    `;
  }

  let pendingHtml = '';
  if (pendingItems.length > 0) {
    pendingHtml = `
      <div class="card" style="padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); margin-top: 14px;">
        <div style="padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.02); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;">
            📋 Próximos en Espera (${pendingItems.length})
          </span>
          <button class="btn btn-secondary btn-sm" style="font-size: 11.5px; padding: 3px 10px;" onclick="handleTtsClear()">
            <i class="fas fa-trash-alt"></i> Limpiar Espera
          </button>
        </div>
        <div style="display: flex; flex-direction: column;">
          ${pendingItems.map((item, idx) => {
            const vName = item.voiceName || (VOICE_PROFILES[item.voice]?.name || item.voice || 'TTS');
            return `
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid rgba(255,255,255,0.04); gap: 14px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                  <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); width: 22px;">#${idx + 2}</span>
                  <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
                      <strong style="color: #fff; font-size: 13px;">@${escapeHtml(item.user || 'Espectador')}</strong>
                      <span style="font-size: 11px; color: #a3e635; background: rgba(163,230,53,0.1); padding: 1px 6px; border-radius: 4px;">${escapeHtml(vName)}</span>
                    </div>
                    <div style="font-size: 12.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${escapeHtml(item.text || '')}
                    </div>
                  </div>
                </div>
                <button class="btn-delete-cmd" style="padding: 6px 10px;" title="Eliminar de la cola" onclick="handleTtsRemoveItem('${item.id}')">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = currentHtml + pendingHtml;
}

async function handleTtsStop() {
  try {
    await fetch('/api/tts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' })
    });
    broadcastEvent('tts_control', { action: 'stop' });
    showToast('⏹️ TTS detenido', 'info');
  } catch (e) {
    broadcastEvent('tts_control', { action: 'stop' });
    showToast('⏹️ TTS detenido', 'info');
  }
}

async function handleTtsSkip() {
  try {
    await fetch('/api/tts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' })
    });
    broadcastEvent('tts_control', { action: 'skip' });
    showToast('⏭️ Mensaje TTS saltado', 'info');
    loadTTSQueue();
  } catch (e) {
    if (cachedTTSQueue.queue.length > 0) cachedTTSQueue.queue.shift();
    renderTTSQueue(cachedTTSQueue);
    broadcastEvent('tts_control', { action: 'skip' });
    showToast('⏭️ Mensaje TTS saltado', 'info');
  }
}

async function handleTtsReset() {
  try {
    await fetch('/api/tts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' })
    });
    broadcastEvent('tts_control', { action: 'reset' });
    cachedTTSQueue.queue = [];
    renderTTSQueue(cachedTTSQueue);
    showToast('🔄 Cola de TTS reiniciada y reproductor restablecido', 'success');
  } catch (e) {
    cachedTTSQueue.queue = [];
    renderTTSQueue(cachedTTSQueue);
    broadcastEvent('tts_control', { action: 'reset' });
    showToast('🔄 Cola de TTS reiniciada', 'success');
  }
}

async function handleTtsClear() {
  try {
    await fetch('/api/tts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' })
    });
    broadcastEvent('tts_control', { action: 'clear' });
    cachedTTSQueue.queue = [];
    renderTTSQueue(cachedTTSQueue);
    showToast('🗑️ Cola de TTS vaciada', 'success');
  } catch (e) {
    cachedTTSQueue.queue = [];
    renderTTSQueue(cachedTTSQueue);
    broadcastEvent('tts_control', { action: 'clear' });
    showToast('🗑️ Cola de TTS vaciada', 'success');
  }
}

async function handleTtsRemoveItem(id) {
  if (!id) return;
  try {
    await fetch('/api/tts/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id })
    });
    broadcastEvent('tts_control', { action: 'item_removed', id });
    cachedTTSQueue.queue = cachedTTSQueue.queue.filter(i => i.id !== id);
    renderTTSQueue(cachedTTSQueue);
    showToast('Mensaje eliminado de la cola', 'info');
  } catch (e) {
    cachedTTSQueue.queue = cachedTTSQueue.queue.filter(i => i.id !== id);
    renderTTSQueue(cachedTTSQueue);
    broadcastEvent('tts_control', { action: 'item_removed', id });
  }
}

// ================= CUSTOM GOALS MANAGER (OBS WIDGETS) =================
let currentGoalsList = [];

function renderGoals(goals) {
  const container = document.getElementById('goalsListContainer');
  if (!container) return;

  if (Array.isArray(goals)) {
    currentGoalsList = goals;
  } else {
    try {
      currentGoalsList = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
    } catch(e) {
      currentGoalsList = [];
    }
  }

  container.innerHTML = '';

  if (!currentGoalsList || currentGoalsList.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 36px 20px; background: rgba(15, 20, 32, 0.6); border: 2px dashed rgba(145, 70, 255, 0.3); border-radius: 14px;">
        <div style="font-size: 38px; margin-bottom: 10px;">🎯</div>
        <h4 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 6px;">No tienes metas personalizadas activas</h4>
        <p style="font-size: 13px; color: var(--text-secondary); max-width: 480px; margin: 0 auto 16px;">
          Crea tus propias metas para subs, seguidores, bits, donaciones o eventos especiales. Cada una tendrá su propio enlace independiente para OBS Studio.
        </p>
        <button class="btn btn-primary btn-sm" onclick="toggleGoalForm(true)">
          + Crear Mi Primera Meta
        </button>
      </div>
    `;
    return;
  }

  const token = (document.getElementById('cfgWidgetTokenDisplay')?.value || localStorage.getItem('orbibot_widget_token') || '').trim();
  const rawChannel = (appConfig?.twitch?.channel || document.getElementById('cfgTwitchChannel')?.value || '').trim();
  const channel = rawChannel.toLowerCase().replace(/^#/, '');
  const baseUrl = window.location.origin + window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '');

  const TYPE_LABELS = {
    subs: { label: 'Suscripciones', emoji: '⭐', color: '#9146ff' },
    followers: { label: 'Seguidores', emoji: '👤', color: '#00f2fe' },
    bits: { label: 'Bits / Cheers', emoji: '💎', color: '#f5a623' },
    donations: { label: 'Donaciones', emoji: '☕', color: '#10b981' },
    custom: { label: 'Personalizada', emoji: '🎯', color: '#ec4899' }
  };

  currentGoalsList.forEach(g => {
    const goalId = g.id;
    const title = g.title || 'Meta del Stream';
    const type = g.type || 'custom';
    const typeInfo = TYPE_LABELS[type] || TYPE_LABELS.custom;
    const current = Number(g.current) || 0;
    const target = Number(g.target) || 100;
    const pct = Math.min(100, Math.max(0, Math.round((current / target) * 100)));
    const color1 = g.color || '#9146ff';
    const color2 = g.color2 || '#00f2fe';

    const goalUrl = `${baseUrl}/overlays/goals.html?goalId=${encodeURIComponent(goalId)}${token ? '&token=' + encodeURIComponent(token) : ''}${channel ? '&channel=' + encodeURIComponent(channel) : ''}`;
    const inputId = `urlGoal_${goalId}`;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'background: rgba(18, 24, 38, 0.85); border: 1px solid rgba(145, 70, 255, 0.25); border-radius: 14px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    card.innerHTML = `
      <div>
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
              <span style="font-size: 18px;">${typeInfo.emoji}</span>
              <h4 style="font-size: 15px; font-weight: 700; color: #fff; margin: 0;">${escapeHtml(title)}</h4>
            </div>
            <span style="display: inline-block; font-size: 11px; font-weight: 700; color: ${typeInfo.color}; background: ${typeInfo.color}18; border: 1px solid ${typeInfo.color}40; padding: 2px 8px; border-radius: 6px;">
              ${typeInfo.label}
            </span>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 16px; font-weight: 800; color: #fff;">
              ${current} <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">/ ${target}</span>
            </div>
            <div style="font-size: 12px; font-weight: 700; color: var(--cyan-accent);">${pct}%</div>
          </div>
        </div>

        <!-- Barra de Progreso Neón Visual -->
        <div style="background: rgba(0, 0, 0, 0.5); border-radius: 10px; height: 16px; padding: 2px; border: 1px solid rgba(255, 255, 255, 0.1); margin-bottom: 14px; overflow: hidden; position: relative;">
          <div style="height: 100%; width: ${pct}%; background: linear-gradient(90deg, ${color1}, ${color2}); border-radius: 8px; box-shadow: 0 0 12px ${color1}80; transition: width 0.4s ease;"></div>
        </div>

        <!-- Controles Rápidos de Progreso -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; background: rgba(0,0,0,0.25); padding: 8px 10px; border-radius: 8px; margin-bottom: 14px;">
          <span style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Progreso:</span>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-secondary btn-sm" onclick="adjustGoalProgress('${goalId}', -1)" style="padding: 2px 8px; font-size: 11px;" title="Restar 1">-1</button>
            <button class="btn btn-secondary btn-sm" onclick="adjustGoalProgress('${goalId}', 1)" style="padding: 2px 8px; font-size: 11px;" title="Sumar 1">+1</button>
            <button class="btn btn-secondary btn-sm" onclick="adjustGoalProgress('${goalId}', 5)" style="padding: 2px 8px; font-size: 11px;" title="Sumar 5">+5</button>
            <button class="btn btn-secondary btn-sm" onclick="resetGoalProgress('${goalId}')" style="padding: 2px 8px; font-size: 11px; color: var(--red-danger);" title="Reiniciar a 0">🔄 0</button>
          </div>
        </div>

        <!-- Enlace Exclusivo de OBS -->
        <div style="margin-bottom: 12px;">
          <label style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; font-weight: 600;">Enlace Navegador para OBS Studio:</label>
          <div style="display: flex; gap: 6px;">
            <input type="password" id="${inputId}" value="${goalUrl}" readonly class="form-control" style="font-family: monospace; font-size: 11px; padding: 6px 10px; background: rgba(0,0,0,0.4); border-color: rgba(145, 70, 255, 0.3);">
            <button class="btn btn-secondary btn-sm" onclick="toggleGoalUrlVisibility('${inputId}', this)" title="Mostrar u ocultar" style="padding: 4px 8px; font-size: 12px;">👁️</button>
            <button class="btn btn-primary btn-sm" onclick="copyGoalWidgetUrl('${inputId}')" style="padding: 4px 10px; font-size: 11px; white-space: nowrap;">Copiar</button>
          </div>
        </div>
      </div>

      <!-- Acciones de Edición / Borrado -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
        <a href="${goalUrl}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px;">Vista Previa ↗</a>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-secondary btn-sm" onclick="editGoalForm('${goalId}')" style="font-size: 11px; padding: 4px 10px;">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="deleteGoalUI('${goalId}')" style="font-size: 11px; padding: 4px 8px;" title="Eliminar Meta">🗑️</button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function toggleGoalUrlVisibility(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    if (btn) btn.innerText = '🙈';
  } else {
    el.type = 'password';
    if (btn) btn.innerText = '👁️';
  }
}

function copyGoalWidgetUrl(inputId) {
  const el = document.getElementById(inputId);
  if (el) {
    navigator.clipboard.writeText(el.value).then(() => {
      showToast('🎯 ¡Enlace privado de la Meta copiado para OBS!', 'success');
    }).catch(() => {
      showToast('¡Copiado!', 'success');
    });
  }
}

function toggleGoalForm(show) {
  const card = document.getElementById('goalFormCard');
  if (!card) return;
  if (show) {
    document.getElementById('editGoalId').value = '';
    document.getElementById('goalFormTitle').innerHTML = '<span>🎯</span> <span>Crear Nueva Meta Personalizada</span>';
    document.getElementById('newGoalTitle').value = '';
    document.getElementById('newGoalType').value = 'custom';
    document.getElementById('newGoalCurrent').value = 0;
    document.getElementById('newGoalTarget').value = 50;
    document.getElementById('newGoalColor').value = '#9146ff';
    document.getElementById('newGoalColorHex').value = '#9146ff';
    document.getElementById('newGoalColor2').value = '#00f2fe';
    document.getElementById('newGoalColor2Hex').value = '#00f2fe';
    card.style.display = 'block';
    document.getElementById('newGoalTitle').focus();
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    card.style.display = 'none';
  }
}

async function saveGoalFormUI() {
  const editId = document.getElementById('editGoalId')?.value.trim();
  const title = document.getElementById('newGoalTitle')?.value.trim();
  const type = document.getElementById('newGoalType')?.value || 'custom';
  const current = Math.max(0, parseInt(document.getElementById('newGoalCurrent')?.value, 10) || 0);
  const target = Math.max(1, parseInt(document.getElementById('newGoalTarget')?.value, 10) || 1);
  const color = document.getElementById('newGoalColor')?.value || '#9146ff';
  const color2 = document.getElementById('newGoalColor2')?.value || '#00f2fe';

  if (!title) {
    showToast('Por favor escribe un título para la meta.', 'error');
    document.getElementById('newGoalTitle')?.focus();
    return;
  }

  let goals = [];
  try {
    goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
  } catch(e) {
    goals = [];
  }
  if (!Array.isArray(goals)) goals = [];

  let savedGoal = null;
  if (editId) {
    const idx = goals.findIndex(g => g.id === editId);
    if (idx !== -1) {
      goals[idx] = {
        ...goals[idx],
        title,
        type,
        current,
        target,
        color,
        color2,
        enabled: true,
        updatedAt: new Date().toISOString()
      };
      savedGoal = goals[idx];
    }
  }

  if (!savedGoal) {
    savedGoal = {
      id: 'goal_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      title,
      type,
      current,
      target,
      color,
      color2,
      enabled: true,
      createdAt: new Date().toISOString()
    };
    goals.push(savedGoal);
  }

  await syncGoalsToStorageAndCloud(goals);
  broadcastEvent('goal_update', { goalId: savedGoal.id, type: savedGoal.type, goal: savedGoal });
  broadcastEvent('goals_updated', goals);

  renderGoals(goals);
  toggleGoalForm(false);
  showToast(`🎯 Meta "${title}" guardada correctamente`, 'success');
}

function editGoalForm(goalId) {
  let goals = [];
  try {
    goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
  } catch(e) {}
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;

  document.getElementById('editGoalId').value = goal.id;
  document.getElementById('goalFormTitle').innerHTML = `<span>✏️</span> <span>Editar Meta (${escapeHtml(goal.title)})</span>`;
  document.getElementById('newGoalTitle').value = goal.title || '';
  document.getElementById('newGoalType').value = goal.type || 'custom';
  document.getElementById('newGoalCurrent').value = goal.current !== undefined ? goal.current : 0;
  document.getElementById('newGoalTarget').value = goal.target || 100;

  const c1 = goal.color || '#9146ff';
  const c2 = goal.color2 || '#00f2fe';
  document.getElementById('newGoalColor').value = c1;
  document.getElementById('newGoalColorHex').value = c1;
  document.getElementById('newGoalColor2').value = c2;
  document.getElementById('newGoalColor2Hex').value = c2;

  const card = document.getElementById('goalFormCard');
  if (card) {
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function adjustGoalProgress(goalId, delta) {
  let goals = [];
  try {
    goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
  } catch(e) {}
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;

  goal.current = Math.max(0, (Number(goal.current) || 0) + Number(delta));
  goal.updatedAt = new Date().toISOString();

  await syncGoalsToStorageAndCloud(goals);
  broadcastEvent('goal_update', { goalId: goal.id, type: goal.type, goal });
  renderGoals(goals);
  showToast(`🎯 Progreso de "${goal.title}": ${goal.current} / ${goal.target}`, 'info');
}

async function resetGoalProgress(goalId) {
  let goals = [];
  try {
    goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
  } catch(e) {}
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return;

  goal.current = 0;
  goal.updatedAt = new Date().toISOString();

  await syncGoalsToStorageAndCloud(goals);
  broadcastEvent('goal_update', { goalId: goal.id, type: goal.type, goal });
  renderGoals(goals);
  showToast(`🔄 Meta "${goal.title}" reiniciada a 0`, 'info');
}

async function deleteGoalUI(goalId) {
  let goals = [];
  try {
    goals = JSON.parse(localStorage.getItem('orbibot_goals') || '[]');
  } catch(e) {}
  const goal = goals.find(g => g.id === goalId);
  const title = goal?.title || 'Meta';

  goals = goals.filter(g => g.id !== goalId);

  await syncGoalsToStorageAndCloud(goals);
  try {
    await fetch('/api/goals/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: goalId })
    });
  } catch(e) {}

  broadcastEvent('goals_updated', goals);
  renderGoals(goals);
  showToast(`🗑️ Meta "${title}" eliminada`, 'info');
}

async function syncGoalsToStorageAndCloud(goals) {
  const cleanGoals = Array.isArray(goals) ? goals : [];
  localStorage.setItem('orbibot_goals', JSON.stringify(cleanGoals));

  if (appConfig) {
    appConfig.goals = cleanGoals;
  }

  // 1. Backend API Sync
  try {
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanGoals)
    });
  } catch(e) {}

  // 2. Direct Multi-Scope Supabase Cloud Sync
  await saveToAllSupabaseScopes('goals', cleanGoals);
}

// ================= COMMANDS =================
function renderCommands(commands) {
  const tbody = document.getElementById('commandsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!commands || commands.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px 16px; color: var(--text-secondary);">
          <div style="font-size: 32px; margin-bottom: 8px;">💬</div>
          <div style="font-weight: 700; color: #ffffff; font-size: 14px; margin-bottom: 4px;">No tienes comandos personalizados creados</div>
          <div style="font-size: 12.5px; color: #94a3b8;">Usa el formulario para añadir tus comandos de chat (ej: <code>!discord</code>, <code>!redes</code>, <code>!reglas</code>).</div>
        </td>
      </tr>
    `;
    return;
  }

  commands.forEach(cmd => {
    const tr = document.createElement('tr');
    const isZero = cmd.cooldown === 0 || cmd.cooldown === '0';
    const cooldownBadge = isZero
      ? `<span class="btn btn-sm" style="font-size:11px; background: rgba(0, 242, 254, 0.2); color: var(--cyan-accent); border: 1px solid var(--cyan-accent);">Sin Cooldown (0s)</span>`
      : `<span class="btn btn-secondary btn-sm" style="font-size:11px;">${cmd.cooldown !== undefined ? cmd.cooldown : 10}s</span>`;

    tr.innerHTML = `
      <td><strong style="color: #ffffff; font-size: 14px;">${escapeHtml(cmd.name)}</strong></td>
      <td style="color: #cbd5e1; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(cmd.response)}</td>
      <td>${cooldownBadge}</td>
      <td style="display: flex; gap: 6px;">
        <button class="btn btn-secondary btn-sm" onclick="editCommand('${cmd.id}')" title="Editar comando">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCommand('${cmd.id}')" title="Eliminar">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleNoCooldown(checkbox) {
  const cooldownInput = document.getElementById('newCmdCooldown');
  if (checkbox && cooldownInput) {
    if (checkbox.checked) {
      cooldownInput.value = 0;
      cooldownInput.disabled = true;
    } else {
      if (Number(cooldownInput.value) <= 0) cooldownInput.value = 10;
      cooldownInput.disabled = false;
    }
  }
}

async function editCommand(cmdId) {
  try {
    const commands = await fetch('/api/commands').then(r => r.json());
    const cmd = commands.find(c => c.id === cmdId);
    if (!cmd) return;

    document.getElementById('editCmdId').value = cmd.id;
    document.getElementById('newCmdName').value = cmd.name;
    document.getElementById('newCmdResponse').value = cmd.response;
    const isZero = cmd.cooldown === 0 || cmd.cooldown === '0';
    document.getElementById('newCmdNoCooldown').checked = isZero;
    document.getElementById('newCmdCooldown').value = isZero ? 0 : (cmd.cooldown !== undefined ? cmd.cooldown : 10);
    document.getElementById('newCmdCooldown').disabled = isZero;
    document.getElementById('newCmdUserLevel').value = cmd.userLevel || 'all';

    document.getElementById('cmdFormTitle').innerText = `✏️ Editar Comando (${cmd.name})`;
    document.getElementById('btnSaveNewCommand').innerText = '💾 Actualizar Comando';
    document.getElementById('btnCancelEditCmd').style.display = 'inline-block';

    document.getElementById('newCmdName').focus();
    showToast(`Editando comando ${cmd.name}`, 'info');
  } catch (e) { }
}

function cancelEditCommand() {
  document.getElementById('editCmdId').value = '';
  document.getElementById('newCmdName').value = '';
  document.getElementById('newCmdResponse').value = '';
  document.getElementById('newCmdNoCooldown').checked = false;
  document.getElementById('newCmdCooldown').value = 10;
  document.getElementById('newCmdCooldown').disabled = false;
  document.getElementById('newCmdUserLevel').value = 'all';

  document.getElementById('cmdFormTitle').innerText = '➕ Crear / Editar Comando';
  document.getElementById('btnSaveNewCommand').innerText = 'Guardar Comando';
  document.getElementById('btnCancelEditCmd').style.display = 'none';
}

async function deleteCommand(cmdId) {
  let commands = [];
  try {
    commands = await fetch('/api/commands').then(r => r.json());
  } catch(e) { }
  if (!Array.isArray(commands)) {
    commands = JSON.parse(localStorage.getItem('orbibot_commands') || '[]');
  }
  const filtered = commands.filter(c => c.id !== cmdId);
  try {
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filtered)
    });
    const data = await res.json();
    commands = data.commands || filtered;
  } catch(e) {
    commands = filtered;
  }

  localStorage.setItem('orbibot_commands', JSON.stringify(commands));
  await saveToAllSupabaseScopes('commands', commands);

  renderCommands(commands);
  showToast('Comando eliminado', 'info');
}

// ================= REWARDS (PUNTOS DE CANAL) & SOUNDS =================
function renderRewards(rewards) {
  const tbody = document.getElementById('rewardsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  let list = Array.isArray(rewards) ? rewards : [];
  const seen = new Set();
  const deduped = [];
  for (const r of list) {
    const k = (r.rewardName || r.name || r.id || '').trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      deduped.push(r);
    }
  }

  if (deduped.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 32px 16px; color: var(--text-secondary);">
          <div style="font-size: 32px; margin-bottom: 8px;">🎁</div>
          <div style="font-weight: 700; color: #ffffff; font-size: 14px; margin-bottom: 4px;">No hay recompensas vinculadas todavía</div>
          <div style="font-size: 12.5px; color: #94a3b8;">Haz clic en <strong>+ Nueva Recompensa</strong> o <strong>🔄 Sincronizar de Twitch</strong> para vincular tus puntos de canal.</div>
        </td>
      </tr>
    `;
    return;
  }

  deduped.forEach(r => {
    const tr = document.createElement('tr');
    let actionBadge = `<span class="btn btn-secondary btn-sm">${r.action}</span>`;
    if (r.action === 'tts') {
      const allVoices = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, cachedVoiceLibrary || []);
      const matchedV = r.voiceId ? allVoices.find(v => v.id === r.voiceId) : null;
      const vName = matchedV ? matchedV.name : (r.voiceId || 'Voz por defecto');
      const msgPreview = r.customMessage ? `<div style="font-size: 11.5px; color: #94a3b8; margin-top: 4px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.customMessage)}">💬 "${escapeHtml(r.customMessage)}"</div>` : '';
      actionBadge = `<div><span class="btn btn-primary btn-sm" style="font-weight: 600;">🗣️ Voz TTS (${escapeHtml(vName)})</span>${msgPreview}</div>`;
    }
    if (r.action === 'song_request') actionBadge = `<span class="btn btn-accent btn-sm" style="font-weight: 600;">🎶 Canción (VIP)</span>`;
    if (r.action === 'sound') {
      const soundName = r.soundUrl ? (r.soundUrl.startsWith('data:') ? 'Audio Personalizado' : r.soundUrl.split('/').pop()) : 'Default';
      actionBadge = `<span class="btn btn-sm" style="background:#f5a623; color:#000; font-weight: 700;">🔊 Sonido (${escapeHtml(soundName)})</span>`;
    }

    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: rgba(145, 70, 255, 0.25); border: 1.5px solid rgba(145, 70, 255, 0.6); color: #c084fc; font-size: 15px; flex-shrink: 0;">🏷️</span>
          <span style="font-weight: 700; font-size: 14.5px; color: #ffffff; letter-spacing: 0.2px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${escapeHtml(r.rewardName)}</span>
        </div>
      </td>
      <td>${actionBadge}</td>
      <td>
        <button class="btn btn-accent btn-sm" onclick="testReward('${r.id}')" title="Probar en vivo">⚡ Probar</button>
      </td>
      <td style="display: flex; gap: 6px;">
        <button class="btn btn-secondary btn-sm" onclick="editReward('${r.id}')" title="Editar">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteReward('${r.id}')" title="Eliminar">🗑️</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ================= REWARDS (TWITCH CHANNEL POINTS) DROPDOWN & LOGIC =================
let cachedTwitchHelixRewards = [];

function populateTwitchRewardsDropdown(twRewards) {
  cachedTwitchHelixRewards = Array.isArray(twRewards) ? twRewards : [];
  const select = document.getElementById('rewardQuickSelect');
  const datalist = document.getElementById('twitchRewardsDatalist');

  if (datalist) {
    datalist.innerHTML = '';
    cachedTwitchHelixRewards.forEach(tr => {
      const opt = document.createElement('option');
      opt.value = tr.title;
      datalist.appendChild(opt);
    });
  }

  if (select) {
    select.innerHTML = '';
    
    if (cachedTwitchHelixRewards.length === 0) {
      select.innerHTML = `
        <option value="">✨ -- No hay recompensas sincronizadas (Haz clic en Sincronizar) --</option>
        <option value="__custom__">✏️ Escribir nombre manualmente...</option>
      `;
    } else {
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.innerText = `✨ -- Selecciona una recompensa (${cachedTwitchHelixRewards.length} encontradas) --`;
      select.appendChild(defaultOpt);

      cachedTwitchHelixRewards.forEach(tr => {
        const opt = document.createElement('option');
        opt.value = tr.title;
        const costStr = tr.cost !== undefined ? ` [${Number(tr.cost).toLocaleString()} pts]` : '';
        opt.innerText = `🎁 ${tr.title}${costStr}`;
        select.appendChild(opt);
      });

      const customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.innerText = '✏️ Escribir otro nombre manualmente...';
      select.appendChild(customOpt);
    }
  }
}

function onRewardQuickSelectChange(val) {
  const input = document.getElementById('rewardNameInput');
  if (!input) return;

  if (val === '__custom__') {
    input.value = '';
    input.focus();
    delete input.dataset.rewardId;
  } else if (val) {
    input.value = val;
    const match = cachedTwitchHelixRewards.find(r => r.title === val);
    if (match) {
      input.dataset.rewardId = match.id;
    } else {
      delete input.dataset.rewardId;
    }
  }
}

function setupRewardAutocomplete() {
  const input = document.getElementById('rewardNameInput');
  const dropdown = document.getElementById('rewardSuggestionsDropdown');
  const select = document.getElementById('rewardQuickSelect');
  if (!input || !dropdown) return;

  const showSuggestions = (filterText = '') => {
    if (!cachedTwitchHelixRewards || cachedTwitchHelixRewards.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    const query = filterText.toLowerCase().trim();
    const filtered = query
      ? cachedTwitchHelixRewards.filter(r => r.title.toLowerCase().includes(query))
      : cachedTwitchHelixRewards;

    if (filtered.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.innerHTML = '';
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.className = 'reward-suggestion-item';
      div.style.cssText = 'padding: 10px 14px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s;';
      div.onmouseover = () => { div.style.background = 'rgba(145, 70, 255, 0.25)'; };
      div.onmouseout = () => { div.style.background = 'transparent'; };
      
      const costBadge = item.cost !== undefined ? `<span style="font-size: 11px; font-weight: 700; color: #a855f7; background: rgba(168, 85, 247, 0.15); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.3);">${Number(item.cost).toLocaleString()} pts</span>` : '';

      div.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🎁</span>
          <span style="font-weight: 600; color: #ffffff; font-size: 13.5px;">${escapeHtml(item.title)}</span>
        </div>
        ${costBadge}
      `;

      div.addEventListener('click', () => {
        input.value = item.title;
        input.dataset.rewardId = item.id;
        if (select) {
          select.value = item.title;
        }
        dropdown.style.display = 'none';
      });

      dropdown.appendChild(div);
    });

    dropdown.style.display = 'block';
  };

  input.addEventListener('input', (e) => {
    showSuggestions(e.target.value);
    if (select) {
      const match = Array.from(select.options).find(o => o.value.toLowerCase() === e.target.value.toLowerCase());
      if (match) {
        select.value = match.value;
      } else {
        select.value = '__custom__';
      }
    }
  });

  input.addEventListener('focus', () => {
    if (cachedTwitchHelixRewards.length > 0 && !input.value.trim()) {
      showSuggestions('');
    }
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

async function syncTwitchRewardsUI() {
  showToast('Obteniendo recompensas de tu canal de Twitch...', 'info');
  try {
    let twRewards = [];
    const config = appConfig || JSON.parse(localStorage.getItem('orbibot_config') || '{}');
    const twitchCfg = config.twitch || {};

    if (!twitchCfg.oauthToken) {
      showToast('⚠️ Primero vincula tu cuenta de Twitch en el Panel General.', 'warn');
      return;
    }

    const cleanToken = twitchCfg.oauthToken.replace(/^oauth:/i, '').trim();
    let userId = twitchCfg.userId;
    let clientId = twitchCfg.clientId || 'yw1vr664ichms8an2x5lhji58v7ozk';

    // 1. Intentar obtener a través del backend
    try {
      const res = await fetch('/api/rewards/twitch');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.rewards)) {
          twRewards = data.rewards;
        }
      } else if (res.status === 403) {
        showToast('ℹ️ Tu canal de Twitch debe tener estado de Afiliado o Partner para usar Puntos de Canal.', 'warn');
        return;
      }
    } catch (e) { }

    // 2. Si no hubo backend o estamos en frontend directo, consultar Twitch Helix
    if (twRewards.length === 0 && cleanToken) {
      if (!userId) {
        try {
          const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
            headers: { 'Authorization': `OAuth ${cleanToken}` }
          });
          if (valRes.ok) {
            const valData = await valRes.json();
            userId = valData.user_id;
            clientId = valData.client_id || clientId;
            twitchCfg.userId = userId;
            twitchCfg.clientId = clientId;
            localStorage.setItem('orbibot_twitch_auth', JSON.stringify(twitchCfg));
          }
        } catch (e) { }
      }

      if (userId) {
        try {
          const helixRes = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${userId}`, {
            headers: {
              'Client-Id': clientId,
              'Authorization': `Bearer ${cleanToken}`
            }
          });
          if (helixRes.ok) {
            const helixData = await helixRes.json();
            twRewards = helixData.data || [];
          } else if (helixRes.status === 403) {
            showToast('ℹ️ Tu canal debe ser Afiliado o Partner de Twitch para consultar Puntos de Canal.', 'warn');
            return;
          }
        } catch (e) { }
      }
    }

    populateTwitchRewardsDropdown(twRewards);

    if (twRewards.length > 0) {
      // Sincronizar automáticamente IDs de las recompensas ya configuradas
      let localRewards = [];
      try {
        localRewards = await fetch('/api/rewards').then(r => r.json()).catch(() => []);
      } catch (e) { }
      if (!Array.isArray(localRewards) || localRewards.length === 0) {
        localRewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
      }

      let updated = false;
      localRewards.forEach(r => {
        const match = twRewards.find(tr => tr.title.trim().toLowerCase() === r.rewardName.trim().toLowerCase());
        if (match && r.rewardId !== match.id) {
          r.rewardId = match.id;
          updated = true;
        }
      });

      if (updated) {
        try {
          await fetch('/api/rewards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localRewards)
          });
        } catch (e) { }
        localStorage.setItem('orbibot_rewards', JSON.stringify(localRewards));
        renderRewards(localRewards);
      }

      showToast(`¡${twRewards.length} recompensas de Twitch encontradas y listas para seleccionar!`, 'success');
    } else {
      showToast('No se encontraron recompensas personalizadas creadas en tu Twitch Creator Dashboard.', 'warn');
    }
  } catch (err) {
    showToast(`Error al sincronizar: ${err.message}`, 'error');
  }
}

function populateRewardVoicesSelect(currentSelected = '') {
  const select = document.getElementById('rewardVoiceSelect');
  if (!select) return;

  const voices = mergeVoiceCatalogs(DEFAULT_VOICE_CATALOG, cachedVoiceLibrary || []);
  const aiVoices = voices.filter(v => v.isAI || (v.tags && v.tags.includes('ia')));
  const stdVoices = voices.filter(v => !v.isAI && (!v.tags || !v.tags.includes('ia')));

  select.innerHTML = '<option value="">✨ -- Voz predeterminada del bot --</option>';

  if (aiVoices.length > 0) {
    const optgroupAI = document.createElement('optgroup');
    optgroupAI.label = '⭐ Voces de IA Famosas y Streamers';
    aiVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.innerText = `🤖 ${v.name} (${v.lang || 'es'})`;
      optgroupAI.appendChild(opt);
    });
    select.appendChild(optgroupAI);
  }

  if (stdVoices.length > 0) {
    const optgroupStd = document.createElement('optgroup');
    optgroupStd.label = '🌐 Voces Estándar y Multilingües';
    stdVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.innerText = `🗣️ ${v.name} (${v.lang || 'es'})`;
      optgroupStd.appendChild(opt);
    });
    select.appendChild(optgroupStd);
  }

  if (currentSelected) {
    select.value = currentSelected;
  }
}

function previewRewardTTS() {
  const select = document.getElementById('rewardVoiceSelect');
  const msgInput = document.getElementById('rewardCustomMessageInput');
  const nameInput = document.getElementById('rewardNameInput');
  const voiceId = select?.value || (appConfig?.tts?.voice) || 'es_mx_mia';
  const rawMsg = (msgInput?.value || '').trim() || `¡{user} ha canjeado ${nameInput?.value || 'esta recompensa'}!`;

  const sampleText = rawMsg
    .replace(/\{user\}|\{usuario\}|\{name\}/gi, 'Espectador')
    .replace(/\{message\}|\{mensaje\}|\{input\}|\{texto\}/gi, 'un gran saludo streamer')
    .replace(/\{reward\}|\{recompensa\}/gi, nameInput?.value || 'Recompensa')
    .trim();

  showToast(`🔊 Probando voz de IA: "${voiceId}"...`, 'info');
  const audioUrl = getTTSAudioUrl(sampleText, voiceId);
  const audio = new Audio(audioUrl);
  audio.volume = Number(document.getElementById('cfgTtsVolume')?.value || 90) / 100;
  audio.play().catch(() => {
    playTTSAudioLocal(sampleText, voiceId, audio.volume);
  });
}
window.previewRewardTTS = previewRewardTTS;

function onRewardCustomMessageInput(val) {
  const hasCustomMsg = Boolean((val || '').trim().length > 0);
  const actionSel = document.getElementById('rewardActionSelect');
  const lockBadge = document.getElementById('rewardActionLockBadge');
  const soundGroup = document.getElementById('rewardSoundGroup');
  const ttsGroup = document.getElementById('rewardTtsGroup');

  if (hasCustomMsg) {
    if (actionSel) {
      actionSel.value = 'tts';
      actionSel.disabled = true;
      actionSel.style.opacity = '0.75';
      actionSel.style.cursor = 'not-allowed';
    }
    if (lockBadge) lockBadge.style.display = 'inline-block';
    if (soundGroup) soundGroup.style.display = 'none';
    if (ttsGroup) ttsGroup.style.display = 'block';
  } else {
    if (actionSel) {
      actionSel.disabled = false;
      actionSel.style.opacity = '1';
      actionSel.style.cursor = 'pointer';
    }
    if (lockBadge) lockBadge.style.display = 'none';
  }
}
window.onRewardCustomMessageInput = onRewardCustomMessageInput;

function toggleRewardForm(show) {
  const form = document.getElementById('rewardFormCard');
  if (!form) return;
  if (show === undefined) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  } else {
    form.style.display = show ? 'block' : 'none';
  }
  if (form.style.display === 'block') {
    loadSounds();
    setupRewardAutocomplete();
    syncTwitchRewardsUI();
    populateRewardVoicesSelect();
    const currentMsg = document.getElementById('rewardCustomMessageInput')?.value || '';
    onRewardCustomMessageInput(currentMsg);
    if (!currentMsg.trim()) {
      const currentAction = document.getElementById('rewardActionSelect')?.value || 'tts';
      handleRewardActionChange(currentAction);
    }
  }
}

function handleRewardActionChange(action) {
  const soundGroup = document.getElementById('rewardSoundGroup');
  const ttsGroup = document.getElementById('rewardTtsGroup');
  if (soundGroup) {
    soundGroup.style.display = action === 'sound' ? 'block' : 'none';
  }
  if (ttsGroup) {
    ttsGroup.style.display = action === 'tts' ? 'block' : 'none';
    if (action === 'tts') {
      populateRewardVoicesSelect();
    }
  }
}

async function loadSounds() {
  try {
    // 1. Obtener sonidos personalizados guardados localmente del usuario activo
    let localSounds = [];
    try {
      localSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
    } catch (e) { }
    if (!Array.isArray(localSounds)) localSounds = [];

    // 2. Sonidos predeterminados del sistema disponibles para todos los usuarios
    const soundMap = new Map();
    const systemDefaults = [
      { name: 'Campana Alerta', url: './assets/sounds/campana_alerta.wav', isDefault: true },
      { name: 'Notificación Puntos', url: './assets/sounds/notificacion_puntos.wav', isDefault: true },
      { name: 'Airhorn', url: './assets/sounds/airhorn.mp3', isDefault: true }
    ];
    systemDefaults.forEach(s => soundMap.set(s.name.toLowerCase(), s));

    // 3. Sonidos personalizados ÚNICAMENTE del usuario que tiene la sesión activa
    localSounds.forEach(s => {
      if (s && s.name) {
        const key = s.name.toLowerCase();
        soundMap.set(key, {
          name: s.name,
          url: s.url || s.dataUrl || s.data || `./assets/sounds/custom/${s.name}`,
          isDefault: false
        });
      }
    });

    const sounds = Array.from(soundMap.values());

    const container = document.getElementById('soundListContainer');
    const select = document.getElementById('rewardSoundSelect');
    const alertSoundSelect = document.getElementById('wc-alert-soundSelect');

    // Poblar selector de recompensas de Puntos de Canal
    if (select) {
      const currentSelected = select.value;
      select.innerHTML = '';
      const placeholderOpt = document.createElement('option');
      placeholderOpt.value = '';
      placeholderOpt.innerText = `✨ -- Seleccionar sonido (${sounds.length} disponibles) --`;
      select.appendChild(placeholderOpt);

      sounds.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.url;
        opt.innerText = s.isDefault ? `🔔 ${s.name} (Predeterminado)` : `🔊 ${s.name}`;
        select.appendChild(opt);
      });

      if (currentSelected) {
        select.value = currentSelected;
      }
    }

    // Poblar selector de alertas de OBS
    if (alertSoundSelect) {
      const customOpt = alertSoundSelect.querySelector('option[value="custom"]');
      Array.from(alertSoundSelect.querySelectorAll('option.custom-uploaded-sound-opt')).forEach(o => o.remove());

      localSounds.forEach(s => {
        if (s && s.name) {
          const opt = document.createElement('option');
          opt.className = 'custom-uploaded-sound-opt';
          opt.value = s.url || s.dataUrl || `./assets/sounds/custom/${s.name}`;
          opt.innerText = `🎵 ${s.name}`;
          if (customOpt) {
            alertSoundSelect.insertBefore(opt, customOpt);
          } else {
            alertSoundSelect.appendChild(opt);
          }
        }
      });
    }

    // Lista de gestión de "Mis Sonidos Personalizados" (SOLO sonidos propios subidos por el usuario)
    if (container) {
      container.innerHTML = '';
      if (localSounds.length === 0) {
        container.innerHTML = `
          <div style="font-size: 12.5px; color: var(--text-muted); text-align: center; padding: 32px 16px;">
            <div style="font-size: 32px; margin-bottom: 8px;">🎵</div>
            <div style="font-weight: 700; color: #ffffff; font-size: 14px; margin-bottom: 4px;">No has subido sonidos personalizados</div>
            <div style="font-size: 12px; color: #94a3b8;">Haz clic en <strong>📤 Subir Sonido</strong> arriba para añadir tus audios (.mp3, .wav) y asignarlos a tus recompensas de puntos de canal o alertas de OBS.</div>
          </div>
        `;
      } else {
        localSounds.forEach(s => {
          if (!s || !s.name) return;
          const soundUrl = s.url || s.dataUrl || s.data || `./assets/sounds/custom/${s.name}`;
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 14px;';
          item.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
              <span style="font-size: 18px;">🔊</span>
              <span style="font-size: 13.5px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(s.name)}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="previewSound('${soundUrl}', '${escapeHtml(s.name)}')" title="Escuchar sonido">▶️ Escuchar</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCustomSound('${escapeHtml(s.name)}')" title="Eliminar sonido">🗑️</button>
            </div>
          `;
          container.appendChild(item);
        });
      }
    }
  } catch (e) {
    console.warn('Error loading sounds:', e);
  }
}

async function deleteCustomSound(name) {
  if (!name) return;
  if (!confirm(`¿Estás seguro de eliminar el sonido "${name}" de tu cuenta?`)) return;

  try {
    const targetName = String(name).trim().toLowerCase();

    // 1. Filtrar de orbibot_custom_sounds
    let customSounds = [];
    try {
      customSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
    } catch (e) { }
    if (!Array.isArray(customSounds)) customSounds = [];

    customSounds = customSounds.filter(s => {
      if (!s) return false;
      const sName = (s.name || '').trim().toLowerCase();
      const sUrl = (s.url || '').trim().toLowerCase();
      return sName !== targetName && !sUrl.endsWith('/' + targetName) && !sUrl.endsWith(targetName);
    });

    localStorage.setItem('orbibot_custom_sounds', JSON.stringify(customSounds));

    // 2. Limpiar de recompensas de Puntos de Canal si alguna lo estaba usando
    try {
      let rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
      if (Array.isArray(rewards)) {
        let rewardsModified = false;
        rewards.forEach(r => {
          if (r.action === 'sound' && r.soundUrl) {
            const urlLower = String(r.soundUrl).toLowerCase();
            if (urlLower.includes(targetName) || (r.rewardName && targetName.includes(r.rewardName.toLowerCase()))) {
              r.soundUrl = './assets/sounds/campana_alerta.wav';
              rewardsModified = true;
            }
          }
        });
        if (rewardsModified) {
          localStorage.setItem('orbibot_rewards', JSON.stringify(rewards));
          if (typeof renderRewards === 'function') renderRewards(rewards);
          if (typeof saveToAllSupabaseScopes === 'function') {
            await saveToAllSupabaseScopes('channel_points', rewards);
          }
        }
      }
    } catch (e) { }

    // 3. Limpiar de estilos de alertas OBS si alguna lo estaba usando
    try {
      let alertSoundsModified = false;
      if (typeof wcAlertSounds !== 'undefined' && wcAlertSounds) {
        Object.keys(wcAlertSounds).forEach(evt => {
          if (wcAlertSounds[evt] && String(wcAlertSounds[evt]).toLowerCase().includes(targetName)) {
            wcAlertSounds[evt] = './assets/sounds/campana_alerta.wav';
            alertSoundsModified = true;
          }
        });
      }
      if (typeof wcWidgetStyles !== 'undefined' && wcWidgetStyles?.alerts?.sounds) {
        Object.keys(wcWidgetStyles.alerts.sounds).forEach(evt => {
          if (wcWidgetStyles.alerts.sounds[evt] && String(wcWidgetStyles.alerts.sounds[evt]).toLowerCase().includes(targetName)) {
            wcWidgetStyles.alerts.sounds[evt] = './assets/sounds/campana_alerta.wav';
            alertSoundsModified = true;
          }
        });
      }
      if (alertSoundsModified && typeof saveToAllSupabaseScopes === 'function') {
        await saveToAllSupabaseScopes('widgetStyles', wcWidgetStyles);
      }
    } catch (e) { }

    // 4. Guardar lista actualizada en Supabase esperando confirmación
    if (typeof saveToAllSupabaseScopes === 'function') {
      await saveToAllSupabaseScopes('custom_sounds', customSounds);
    }

    // 5. Notificar al backend si estuviera ejecutándose localmente
    try {
      await fetch('/api/sounds/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (e) { }

    showToast(`Sonido "${name}" eliminado correctamente de tu cuenta.`, 'success');
    await loadSounds();
  } catch (e) {
    console.error('Error al eliminar sonido:', e);
    showToast('Error al eliminar sonido: ' + e.message, 'error');
  }
}
window.deleteCustomSound = deleteCustomSound;

function previewSound(url, name) {
  try {
    if (!url && !name) return;

    let customSounds = [];
    try {
      customSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
    } catch (e) { }

    const cleanUrl = url ? String(url).trim() : '';
    const cleanName = name ? String(name).trim().toLowerCase() : (cleanUrl ? cleanUrl.split('/').pop().toLowerCase() : '');

    const found = customSounds.find(s => {
      if (!s) return false;
      const sName = (s.name || '').toLowerCase();
      const sUrl = (s.url || '').toLowerCase();
      return (cleanName && (sName === cleanName || sUrl.endsWith(cleanName))) || (cleanUrl && (sUrl === cleanUrl.toLowerCase() || s.dataUrl === cleanUrl || s.data === cleanUrl));
    });

    const primarySrc = cleanUrl || found?.url || found?.dataUrl || found?.data || './assets/sounds/campana_alerta.wav';
    const fallbackSrc = found?.dataUrl || found?.data;

    const a = new Audio(primarySrc);
    a.play().catch(err => {
      if (fallbackSrc && fallbackSrc !== primarySrc) {
        const fallbackAudio = new Audio(fallbackSrc);
        fallbackAudio.play().catch(() => playSynthesizedAlertChime('sound'));
      } else {
        playSynthesizedAlertChime('sound');
      }
    });
  } catch (e) {
    try { playSynthesizedAlertChime('sound'); } catch (err) { }
  }
}

async function handleSoundFileUpload(input) {
  if (!input || !input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 25 * 1024 * 1024) {
    showToast('El archivo es demasiado grande (máximo 25MB)', 'error');
    return;
  }

  showToast(`Subiendo ${file.name}...`, 'info');
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const dataUrl = e.target.result;
      let finalUrl = dataUrl;
      const cleanName = file.name;

      // 1. Intentar subir al backend /api/sounds/upload
      try {
        const res = await fetch('/api/sounds/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: cleanName,
            data: dataUrl
          })
        });
        const data = await res.json();
        if (data.success && data.url) {
          finalUrl = data.url;
        }
      } catch (err) {
        console.warn('Backend sound upload fallback to dataUrl:', err);
      }

      // 2. Guardar en orbibot_custom_sounds local
      let customSounds = [];
      try {
        customSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
      } catch (err) { }
      if (!Array.isArray(customSounds)) customSounds = [];

      const soundObj = {
        name: cleanName,
        url: finalUrl,
        dataUrl: dataUrl,
        createdAt: Date.now()
      };
      const existingIdx = customSounds.findIndex(s => s.name.toLowerCase() === cleanName.toLowerCase());
      if (existingIdx >= 0) {
        customSounds[existingIdx] = soundObj;
      } else {
        customSounds.push(soundObj);
      }
      localStorage.setItem('orbibot_custom_sounds', JSON.stringify(customSounds));
      await saveToAllSupabaseScopes('custom_sounds', customSounds);

      showToast(`¡Sonido "${cleanName}" subido y guardado con éxito!`, 'success');
      await loadSounds();

      const select = document.getElementById('rewardSoundSelect');
      if (select) {
        select.value = finalUrl;
        if (!select.value && select.options.length > 0) {
          for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === finalUrl || select.options[i].value.includes(cleanName) || select.options[i].innerText.includes(cleanName)) {
              select.selectedIndex = i;
              break;
            }
          }
        }
      }
    } catch (err) {
      showToast(`Error al subir sonido: ${err.message}`, 'error');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

async function saveRewardUI() {
  const inputEl = document.getElementById('rewardNameInput');
  const name = (inputEl?.value || '').trim();
  const customMessage = (document.getElementById('rewardCustomMessageInput')?.value || '').trim() || null;
  const actionSel = document.getElementById('rewardActionSelect');
  const action = customMessage ? 'tts' : (actionSel?.value || 'tts');
  const soundUrl = document.getElementById('rewardSoundSelect')?.value || null;
  const voiceId = document.getElementById('rewardVoiceSelect')?.value || null;
  const editId = document.getElementById('editRewardId').value;

  if (!name) {
    showToast('Ingresa o selecciona el nombre de la recompensa en Twitch', 'warn');
    return;
  }

  if (action === 'sound' && !soundUrl) {
    showToast('⚠️ Debes seleccionar o subir un archivo de sonido personalizado para esta recompensa.', 'warn');
    return;
  }

  const matchedTwitch = cachedTwitchHelixRewards.find(tr => tr.title.trim().toLowerCase() === name.toLowerCase());
  const rewardIdFromHelix = inputEl?.dataset?.rewardId || (matchedTwitch ? matchedTwitch.id : null);

  let rewards = [];
  try {
    rewards = await fetch('/api/rewards').then(r => r.json()).catch(() => []);
  } catch (e) { }
  if (!Array.isArray(rewards) || rewards.length === 0) {
    rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
  }
  if (!Array.isArray(rewards)) rewards = [];

  const newReward = {
    id: editId || `reward-${Date.now()}`,
    rewardId: rewardIdFromHelix,
    rewardName: name,
    action,
    voiceId: action === 'tts' ? voiceId : null,
    customMessage: action === 'tts' ? customMessage : null,
    soundUrl: action === 'sound' ? soundUrl : null,
    enabled: true
  };

  let targetIdx = -1;
  if (editId) {
    targetIdx = rewards.findIndex(r => r.id === editId);
  }
  if (targetIdx === -1) {
    targetIdx = rewards.findIndex(r => (r.rewardName || '').trim().toLowerCase() === name.toLowerCase());
    if (targetIdx >= 0) {
      newReward.id = rewards[targetIdx].id;
    }
  }

  if (targetIdx >= 0) {
    rewards[targetIdx] = newReward;
  } else {
    rewards.push(newReward);
  }

  // Deduplicate before saving
  const seen = new Set();
  const deduped = [];
  for (const r of rewards) {
    const k = (r.rewardName || '').trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      deduped.push(r);
    }
  }

  try {
    await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deduped)
    });
  } catch (e) { }

  localStorage.setItem('orbibot_rewards', JSON.stringify(deduped));
  await saveToAllSupabaseScopes('channel_points', deduped);

  // Si el sonido no estaba en custom_sounds, asegurarse de agregarlo para mantener persistencia
  if (action === 'sound' && soundUrl) {
    let customSounds = [];
    try {
      customSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
    } catch (e) { }
    if (!Array.isArray(customSounds)) customSounds = [];
    const soundExists = customSounds.some(s => s.url === soundUrl);
    if (!soundExists) {
      const soundName = soundUrl.startsWith('data:') ? `Audio - ${name}` : (soundUrl.split('/').pop() || name);
      customSounds.push({ name: soundName, url: soundUrl, createdAt: Date.now() });
      localStorage.setItem('orbibot_custom_sounds', JSON.stringify(customSounds));
      await saveToAllSupabaseScopes('custom_sounds', customSounds);
    }
  }

  renderRewards(deduped);
  toggleRewardForm(false);
  document.getElementById('editRewardId').value = '';
  if (inputEl) {
    inputEl.value = '';
    delete inputEl.dataset.rewardId;
  }
  const quickSel = document.getElementById('rewardQuickSelect');
  if (quickSel) quickSel.value = '';
  const voiceSel = document.getElementById('rewardVoiceSelect');
  if (voiceSel) voiceSel.value = '';
  const customMsgInput = document.getElementById('rewardCustomMessageInput');
  if (customMsgInput) customMsgInput.value = '';
  onRewardCustomMessageInput('');

  showToast(`Recompensa "${name}" guardada`, 'success');
}

async function editReward(rewardId) {
  let rewards = [];
  try {
    rewards = await fetch('/api/rewards').then(r => r.json()).catch(() => []);
  } catch (e) { }
  if (!Array.isArray(rewards) || rewards.length === 0) {
    rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
  }
  const r = rewards.find(item => item.id === rewardId);
  if (!r) return;

  toggleRewardForm(true);

  document.getElementById('editRewardId').value = r.id;
  const inputEl = document.getElementById('rewardNameInput');
  if (inputEl) {
    inputEl.value = r.rewardName;
    if (r.rewardId) inputEl.dataset.rewardId = r.rewardId;
  }

  const quickSel = document.getElementById('rewardQuickSelect');
  if (quickSel) {
    const match = Array.from(quickSel.options).find(o => o.value.trim().toLowerCase() === r.rewardName.trim().toLowerCase());
    if (match) {
      quickSel.value = match.value;
    } else {
      quickSel.value = '__custom__';
    }
  }

  document.getElementById('rewardActionSelect').value = r.action;
  handleRewardActionChange(r.action);

  if (r.action === 'tts') {
    populateRewardVoicesSelect(r.voiceId || r.voice || '');
    const msgInput = document.getElementById('rewardCustomMessageInput');
    if (msgInput) msgInput.value = r.customMessage || '';
    onRewardCustomMessageInput(r.customMessage || '');
  } else {
    const msgInput = document.getElementById('rewardCustomMessageInput');
    if (msgInput) msgInput.value = '';
    onRewardCustomMessageInput('');
  }

  if (r.soundUrl) {
    const soundSel = document.getElementById('rewardSoundSelect');
    if (soundSel) {
      let optFound = Array.from(soundSel.options).some(o => o.value === r.soundUrl);
      if (!optFound) {
        const opt = document.createElement('option');
        opt.value = r.soundUrl;
        const optName = r.soundUrl.startsWith('data:') ? `🔊 Audio guardado (${r.rewardName})` : `🔊 ${r.soundUrl.split('/').pop()}`;
        opt.innerText = optName;
        soundSel.appendChild(opt);
      }
      soundSel.value = r.soundUrl;
    }
  }
}

async function deleteReward(rewardId) {
  let rewards = [];
  try {
    rewards = await fetch('/api/rewards').then(r => r.json()).catch(() => []);
  } catch (e) { }
  if (!Array.isArray(rewards) || rewards.length === 0) {
    rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
  }
  if (!Array.isArray(rewards)) rewards = [];

  const filtered = rewards.filter(r => r.id !== rewardId && r.rewardName !== rewardId);

  const seen = new Set();
  const deduped = [];
  for (const r of filtered) {
    const k = (r.rewardName || '').trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      deduped.push(r);
    }
  }

  try {
    await fetch('/api/rewards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deduped)
    });
  } catch (e) { }

  localStorage.setItem('orbibot_rewards', JSON.stringify(deduped));
  await saveToAllSupabaseScopes('channel_points', deduped);

  renderRewards(deduped);
  showToast('Recompensa eliminada', 'success');
}

async function testReward(rewardId) {
  let rewards = [];
  try {
    rewards = await fetch('/api/rewards').then(r => r.json()).catch(() => []);
  } catch (e) { }
  if (!Array.isArray(rewards) || rewards.length === 0) {
    rewards = JSON.parse(localStorage.getItem('orbibot_rewards') || '[]');
  }
  const r = rewards.find(item => item.id === rewardId);
  if (!r) return;

  showToast(`Probando canje: ${r.rewardName}...`, 'info');

  const currentCfg = (typeof appConfig !== 'undefined' && appConfig) ? appConfig : {};
  const activeUser = currentCfg.streamerUser || currentCfg.twitch?.channel || 'Streamer';
  const ttsCfg = currentCfg.tts || {};

  if (r.action === 'tts') {
    const rawTemplate = (r.customMessage || '').trim() || '¡{user} ha canjeado {recompensa}!';
    const testText = rawTemplate
      .replace(/\{user\}|\{usuario\}|\{name\}/gi, 'EspectadorVIP')
      .replace(/\{message\}|\{mensaje\}|\{input\}|\{texto\}/gi, '¡Muchas gracias por el stream!')
      .replace(/\{reward\}|\{recompensa\}/gi, r.rewardName || 'Recompensa')
      .trim();

    const selectedVoice = r.voiceId || r.voice || ttsCfg.voice || 'es_mx_mia';

    // 1. Enviar al backend vía API
    let sentToBackend = false;
    try {
      const res = await fetch('/api/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: testText,
          user: 'EspectadorVIP',
          voice: selectedVoice,
          room: activeUser,
          channel: activeUser
        })
      });
      if (res.ok) sentToBackend = true;
    } catch (e) { }

    // 2. Broadcast local para widgets en navegador solo si el backend no respondió
    if (!sentToBackend) {
      const audioUrl = getTTSAudioUrl(testText, selectedVoice);
      broadcastEvent('tts', {
        id: 'tts_reward_' + Date.now(),
        user: 'EspectadorVIP',
        text: testText,
        voice: selectedVoice,
        volume: Number(ttsCfg.volume !== undefined ? ttsCfg.volume : 90) / 100,
        rate: Number(ttsCfg.rate || 1.0),
        pitch: Number(ttsCfg.pitch || 1.0),
        audioUrl: audioUrl,
        source: 'channel_points'
      });
    }

    showToast(`🗣️ Reproduciendo TTS con voz "${selectedVoice}" en OBS`, 'success');
  } else if (r.action === 'song_request') {
    await fetch('/api/sr/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Daft Punk One More Time', requester: 'VisorVIP' })
    }).catch(() => { });
    showToast('Canción añadida con prioridad VIP a la cola', 'success');
  } else if (r.action === 'sound') {
    broadcastEvent('alert', {
      type: 'sound',
      user: 'VisorDePrueba',
      reward: r.rewardName,
      soundUrl: r.soundUrl || './assets/sounds/airhorn.mp3'
    });
    previewSound(r.soundUrl || './assets/sounds/airhorn.mp3');
  }
}

async function testTtsRewardLive() {
  const currentCfg = (typeof appConfig !== 'undefined' && appConfig) ? appConfig : {};
  const activeUser = currentCfg.streamerUser || currentCfg.twitch?.channel || 'Streamer';
  const ttsCfg = currentCfg.tts || {};
  const voice = ttsCfg.voice || 'es_mx_mia';
  const testText = '¡Prueba de voz en OBS! El sistema de Puntos de Canal y TTS está funcionando correctamente.';

  showToast('🗣️ Enviando prueba de voz TTS a OBS...', 'info');

  let sentToBackend = false;
  try {
    const res = await fetch('/api/tts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        user: activeUser,
        voice: voice,
        room: activeUser,
        channel: activeUser
      })
    });
    if (res.ok) sentToBackend = true;
  } catch (e) { }

  if (!sentToBackend) {
    const audioUrl = getTTSAudioUrl(testText, voice);
    broadcastEvent('tts', {
      id: 'tts_test_' + Date.now(),
      user: activeUser,
      text: testText,
      voice: voice,
      volume: Number(ttsCfg.volume !== undefined ? ttsCfg.volume : 90) / 100,
      rate: Number(ttsCfg.rate || 1.0),
      pitch: Number(ttsCfg.pitch || 1.0),
      audioUrl: audioUrl,
      source: 'test'
    });
  }
  showToast('✅ Prueba de TTS enviada a OBS', 'success');
}
window.testTtsRewardLive = testTtsRewardLive;

async function testAlertRewardLive() {
  const currentCfg = (typeof appConfig !== 'undefined' && appConfig) ? appConfig : {};
  const activeUser = currentCfg.streamerUser || currentCfg.twitch?.channel || 'Streamer';

  showToast('🔔 Enviando alerta de prueba a OBS...', 'info');
  try {
    await fetch('/api/alert/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'channel_points',
        user: 'EspectadorVIP',
        reward: 'Hidrátate',
        message: '¡Tómate un vaso de agua!',
        room: activeUser,
        channel: activeUser
      })
    });
  } catch (e) { }

  broadcastEvent('alert', {
    type: 'channel_points',
    user: 'EspectadorVIP',
    reward: 'Hidrátate',
    message: '¡Tómate un vaso de agua!'
  });
  showToast('✅ Alerta de prueba enviada a OBS', 'success');
}
window.testAlertRewardLive = testAlertRewardLive;


// ================= AUTO-SAVE SYSTEM =================
let autoSaveTimer = null;
let toastAutoSaveDebounce = null;

function setAutoSaveStatus(status) {
  const dot = document.getElementById('autoSaveDot');
  const text = document.getElementById('autoSaveText');
  const indicator = document.getElementById('autoSaveIndicator');
  if (!dot || !text) return;

  if (status === 'saving') {
    dot.style.background = '#f59e0b';
    dot.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.8)';
    text.innerText = 'Guardando...';
    if (indicator) indicator.style.borderColor = 'rgba(245, 158, 11, 0.4)';
  } else if (status === 'saved') {
    dot.style.background = '#10b981';
    dot.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.8)';
    text.innerText = 'Cambios guardados';
    if (indicator) indicator.style.borderColor = 'rgba(16, 185, 129, 0.3)';

    setTimeout(() => {
      if (text && text.innerText === 'Cambios guardados') {
        text.innerText = 'Autoguardado activo';
        if (indicator) indicator.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      }
    }, 2500);
  } else if (status === 'error') {
    dot.style.background = '#ef4444';
    dot.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.8)';
    text.innerText = 'Error al guardar';
    if (indicator) indicator.style.borderColor = 'rgba(239, 68, 68, 0.4)';
  }
}

function triggerAutoSave(delay = 500, notify = true) {
  setAutoSaveStatus('saving');
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    await saveAllConfig(notify);
  }, delay);
}

function setupAutoSaveListeners() {
  const configInputIds = [
    'cfgTwitchChannel', 'cfgTwitchBotUser', 'cfgTwitchToken', 'cfgTwitchClientId',
    'cfgSrPrefix', 'cfgSrUserLevel', 'cfgSrMaxDuration', 'cfgSrMaxPerUser', 'cfgSrEnabled',
    'cfgTtsEnabled', 'cfgTtsVoice', 'cfgTtsVolume', 'cfgTtsRate', 'cfgTtsPitch',
    'cfgTtsMaxLength', 'cfgTtsBannedWords', 'cfgTtsAllowCommand', 'cfgTtsCommand', 'cfgTtsMinBits'
  ];

  configInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'cfgTtsVoice') {
      el.addEventListener('change', (e) => {
        const v = e.target.value;
        localStorage.setItem('orbibot_active_tts_voice', v);
        if (appConfig?.tts) appConfig.tts.voice = v;
        saveAllConfig(true);
      });
      return;
    }
    if (el.type === 'checkbox') {
      el.addEventListener('change', () => triggerAutoSave(100, true));
    } else if (el.tagName === 'SELECT') {
      el.addEventListener('change', () => triggerAutoSave(100, true));
    } else if (el.type === 'range') {
      el.addEventListener('input', () => triggerAutoSave(400, true));
      el.addEventListener('change', () => triggerAutoSave(100, true));
    } else {
      el.addEventListener('input', () => triggerAutoSave(600, true));
      el.addEventListener('change', () => triggerAutoSave(100, true));
    }
  });
}

// ================= SAVE CONFIG =================
async function saveAllConfig(showNotification = true) {
  const bannedWords = (document.getElementById('cfgTtsBannedWords')?.value || '')
    .split(',')
    .map(w => w.trim())
    .filter(Boolean);

  // Preservar credenciales existentes de Twitch para evitar que campos no renderizados o vacíos las borren
  const currentTwitchAuth = (() => {
    try { return JSON.parse(localStorage.getItem('orbibot_twitch_auth') || '{}'); } catch (e) { return {}; }
  })();

  const inputChannel = document.getElementById('cfgTwitchChannel')?.value.trim() || '';
  const inputBotUser = document.getElementById('cfgTwitchBotUser')?.value.trim() || '';
  const inputToken = document.getElementById('cfgTwitchToken')?.value.trim() || '';

  const effectiveChannel = inputChannel || appConfig?.twitch?.channel || currentTwitchAuth.channel || '';
  const effectiveBotUser = inputBotUser || appConfig?.twitch?.botUsername || currentTwitchAuth.botUsername || effectiveChannel;
  const effectiveToken = inputToken || appConfig?.twitch?.oauthToken || currentTwitchAuth.oauthToken || '';
  const effectiveClientId = appConfig?.twitch?.clientId || currentTwitchAuth.clientId || 'yw1vr664ichms8an2x5lhji58v7ozk';
  const effectiveDisplayName = appConfig?.twitch?.displayName || currentTwitchAuth.displayName || effectiveChannel;
  const effectiveProfileImage = appConfig?.twitch?.profileImage || currentTwitchAuth.profileImage || '';
  const effectiveUserId = appConfig?.twitch?.userId || currentTwitchAuth.userId || '';
  const effectiveConnected = Boolean(effectiveChannel && (appConfig?.twitch?.connected !== false || currentTwitchAuth.connected !== false));

  const twitchPayload = {
    channel: effectiveChannel,
    botUsername: effectiveBotUser,
    oauthToken: effectiveToken,
    clientId: effectiveClientId,
    displayName: effectiveDisplayName,
    profileImage: effectiveProfileImage,
    userId: effectiveUserId,
    connected: effectiveConnected
  };

  const selectedVoiceEl = document.getElementById('cfgTtsVoice');
  const chosenVoice = selectedVoiceEl?.value || localStorage.getItem('orbibot_active_tts_voice') || 'es_mx_mia';
  localStorage.setItem('orbibot_active_tts_voice', chosenVoice);

  const payload = {
    twitch: twitchPayload,
    songRequest: {
      prefix: document.getElementById('cfgSrPrefix')?.value.trim() || '!sr',
      userLevel: document.getElementById('cfgSrUserLevel')?.value || 'all',
      maxDurationMinutes: Number(document.getElementById('cfgSrMaxDuration')?.value) || 8,
      maxPerUser: Number(document.getElementById('cfgSrMaxPerUser')?.value) || 5,
      enabled: Boolean(document.getElementById('cfgSrEnabled')?.checked)
    },
    tts: {
      enabled: document.getElementById('cfgTtsEnabled') ? Boolean(document.getElementById('cfgTtsEnabled')?.checked) : (appConfig?.tts?.enabled !== false),
      voice: chosenVoice,
      volume: Number(document.getElementById('cfgTtsVolume')?.value ?? (appConfig?.tts?.volume ?? 90)),
      rate: Number(document.getElementById('cfgTtsRate')?.value ?? (appConfig?.tts?.rate ?? 1)),
      pitch: Number(document.getElementById('cfgTtsPitch')?.value ?? (appConfig?.tts?.pitch ?? 1)),
      maxLength: Number(document.getElementById('cfgTtsMaxLength')?.value ?? (appConfig?.tts?.maxLength ?? 250)),
      bannedWords,
      allowChatCommand: document.getElementById('cfgTtsAllowCommand') ? Boolean(document.getElementById('cfgTtsAllowCommand')?.checked) : (appConfig?.tts?.allowChatCommand !== false),
      chatCommand: document.getElementById('cfgTtsCommand')?.value.trim() || appConfig?.tts?.chatCommand || '!tts',
      minBits: Number(document.getElementById('cfgTtsMinBits')?.value ?? (appConfig?.tts?.minBits ?? 50)),
      fishApiKey: document.getElementById('cfgTtsFishApiKey')?.value?.trim() || appConfig?.tts?.fishApiKey || 'sk-fish-rOpXPwPZLXZAk5SPYaeSKBue6QfPM3l4i6Q3VG8ZbGI'
    }
  };

  try {
    let cfg = JSON.parse(localStorage.getItem('orbibot_config') || '{}');
    cfg = { ...cfg, ...payload, twitch: { ...(cfg.twitch || {}), ...twitchPayload } };
    localStorage.setItem('orbibot_config', JSON.stringify(cfg));
    if (effectiveChannel) {
      let twAuth = { ...currentTwitchAuth, ...twitchPayload };
      localStorage.setItem('orbibot_twitch_auth', JSON.stringify(twAuth));
    }
  } catch (e) { }

  if (typeof saveToAllSupabaseScopes === 'function') {
    saveToAllSupabaseScopes('config', payload).catch(() => {});
    saveToAllSupabaseScopes('active_tts_voice', chosenVoice).catch(() => {});
  }

  populateWidgetUrls();
  initDashboardMqtt();

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      appConfig = data.config;
      const statChan = document.getElementById('statChannelName');
      if (statChan) statChan.innerText = payload.twitch.channel ? `#${payload.twitch.channel}` : 'Ninguno';
      setAutoSaveStatus('saved');
      if (showNotification) {
        if (toastAutoSaveDebounce) clearTimeout(toastAutoSaveDebounce);
        toastAutoSaveDebounce = setTimeout(() => {
          showToast('✅ Cambios guardados automáticamente', 'success');
        }, 300);
      }
    }
  } catch (e) {
    setAutoSaveStatus('saved');
    if (showNotification) {
      if (toastAutoSaveDebounce) clearTimeout(toastAutoSaveDebounce);
      toastAutoSaveDebounce = setTimeout(() => {
        showToast('Configuración guardada localmente.', 'info');
      }, 300);
    }
  }
}

// ================= EVENT LISTENERS SETUP =================
function setupEventListeners() {
  // Save global button (si existe)
  const saveBtn = document.getElementById('saveGlobalBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveAllConfig(true));
  }

  // Quick alert test button (si existe)
  const quickAlertBtn = document.getElementById('testAlertQuickBtn');
  if (quickAlertBtn) {
    quickAlertBtn.addEventListener('click', () => {
      triggerTestAlert('follower');
    });
  }

  // Connect / Disconnect Twitch (si existen)
  const btnConnectTwitch = document.getElementById('btnConnectTwitch');
  if (btnConnectTwitch) {
    btnConnectTwitch.addEventListener('click', async () => {
      await saveAllConfig(false);
      showToast('Iniciando conexión con Twitch...', 'info');
      try {
        const res = await fetch('/api/bot/connect', { method: 'POST' });
        const data = await res.json();
        showToast(data.message, data.success ? 'success' : 'warn');
      } catch (e) {
        showToast('Error de conexión', 'error');
      }
    });
  }

  const btnDisconnectTwitch = document.getElementById('btnDisconnectTwitch');
  if (btnDisconnectTwitch) {
    btnDisconnectTwitch.addEventListener('click', () => {
      openLogoutModal();
    });
  }

  // Direct Twitch OAuth Authentication
  let activeAuthPopup = null;

  function getTwitchRedirectUri() {
    const custom = document.getElementById('cfgTwitchRedirectUri')?.value?.trim();
    if (custom) return custom;
    const cleanPath = window.location.pathname.replace(/\/index\.html$/i, '').replace(/\/$/, '');
    return `${window.location.origin}${cleanPath}/`;
  }

  function triggerTwitchOAuthLogin() {
    const customClientId = document.getElementById('cfgTwitchClientId')?.value?.trim();
    const clientId = customClientId || 'yw1vr664ichms8an2x5lhji58v7ozk';
    const redirectUri = getTwitchRedirectUri();
    const scopes = encodeURIComponent('chat:read chat:edit channel:read:redemptions bits:read channel:read:subscriptions');

    const twitchAuthUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scopes}&state=popup&force_verify=true`;

    const width = 560, height = 750;
    const left = Math.max(0, (window.innerWidth - width) / 2 + window.screenX);
    const top = Math.max(0, (window.innerHeight - height) / 2 + window.screenY);

    showToast('Abriendo ventana segura de inicio de sesión con Twitch...', 'info');

    // Clean any prior auth event or error
    localStorage.removeItem('orbibot_twitch_auth_event');
    localStorage.removeItem('orbibot_twitch_auth_error');

    activeAuthPopup = window.open(twitchAuthUrl, 'TwitchOAuthLogin', `width=${width},height=${height},top=${top},left=${left},status=no,menubar=no,toolbar=no,scrollbars=yes`);
    if (!activeAuthPopup || activeAuthPopup.closed || typeof activeAuthPopup.closed === 'undefined') {
      window.location.href = twitchAuthUrl;
      return;
    }

    let pollCount = 0;
    const authPollInterval = setInterval(async () => {
      pollCount++;

      // 1. Check for success
      const rawEvent = localStorage.getItem('orbibot_twitch_auth_event');
      if (rawEvent) {
        clearInterval(authPollInterval);
        localStorage.removeItem('orbibot_twitch_auth_event');
        try {
          if (activeAuthPopup && !activeAuthPopup.closed) activeAuthPopup.close();
        } catch (e) { }
        activeAuthPopup = null;

        try {
          const payload = JSON.parse(rawEvent);
          await handleAuthSuccess(payload);
        } catch (err) {
          console.error('Error handling auth success payload:', err);
        }
        return;
      }

      // 2. Check for error (e.g. redirect_mismatch)
      const rawError = localStorage.getItem('orbibot_twitch_auth_error');
      if (rawError) {
        clearInterval(authPollInterval);
        localStorage.removeItem('orbibot_twitch_auth_error');
        try {
          const errData = JSON.parse(rawError);
          showToast(`⚠️ Twitch: ${errData.desc || errData.error}`, 'error');
        } catch (e) { }
        return;
      }

      if (pollCount > 600) {
        clearInterval(authPollInterval);
      }
    }, 300);
  }

  // Handle successful OAuth event
  async function handleAuthSuccess(payload) {
    if (activeAuthPopup) {
      try { activeAuthPopup.close(); } catch (e) { }
      activeAuthPopup = null;
    }
    try { window.focus(); } catch (e) { }

    let user = payload.user || payload.data?.user || {};
    const token = (payload.token || payload.oauthToken || '').replace(/^oauth:/i, '').trim();
    let displayName = user.display_name || user.login || '';
    let avatarUrl = user.profile_image_url || '';
    let channelName = (user.login || user.channel || (displayName ? displayName.toLowerCase() : '') || '').replace(/^#/, '');
    let userId = user.user_id || user.id || '';
    let clientId = user.client_id || 'yw1vr664ichms8an2x5lhji58v7ozk';

    // If channelName or displayName or userId is missing, validate token directly with Twitch
    if ((!channelName || !displayName || !userId) && token) {
      try {
        const valRes = await fetch('https://id.twitch.tv/oauth2/validate', {
          headers: { 'Authorization': `OAuth ${token}` }
        });
        if (valRes.ok) {
          const valData = await valRes.json();
          userId = valData.user_id || userId;
          clientId = valData.client_id || clientId;
          channelName = valData.login || channelName;
          displayName = displayName || valData.login;
          if (!avatarUrl && userId) {
            try {
              const uRes = await fetch(`https://api.twitch.tv/helix/users?id=${userId}`, {
                headers: { 'Client-Id': clientId, 'Authorization': `Bearer ${token}` }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                if (uData.data?.length > 0) {
                  displayName = uData.data[0].display_name || displayName;
                  avatarUrl = uData.data[0].profile_image_url || avatarUrl;
                }
              }
            } catch (e) { }
          }
        }
      } catch (e) { }
    }

    if (!channelName && displayName) {
      channelName = displayName.toLowerCase();
    }

    const twitchCfg = {
      channel: channelName,
      botUsername: channelName,
      oauthToken: token,
      clientId,
      displayName: displayName || channelName,
      profileImage: avatarUrl || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb60-aee8f1560db5-profile_image-300x300.png',
      userId: userId || '',
      connected: true
    };

    localStorage.setItem('orbibot_twitch_auth', JSON.stringify(twitchCfg));
    try {
      let cfg = JSON.parse(localStorage.getItem('orbibot_config') || '{}');
      cfg.twitch = { ...(cfg.twitch || {}), ...twitchCfg };
      localStorage.setItem('orbibot_config', JSON.stringify(cfg));
    } catch (e) { }

    if (appConfig) {
      appConfig.twitch = { ...(appConfig.twitch || {}), ...twitchCfg };
    } else {
      appConfig = { twitch: twitchCfg };
    }

    // Sincronizar en la nube con Supabase
    if (typeof saveToAllSupabaseScopes === 'function') {
      saveToAllSupabaseScopes('twitch_auth', twitchCfg).catch(() => {});
      saveToAllSupabaseScopes('config', appConfig).catch(() => {});
    }

    showToast(`🎉 ¡Sesión iniciada con éxito! Bienvenido, @${displayName || channelName}`, 'success');

    // Submit token to backend if available and resync from DB
    if (token) {
      try {
        const authRes = await fetch('/api/auth/twitch-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, channel: channelName })
        });
        if (authRes.ok) {
          const authData = await authRes.json();
          if (authData.config) {
            appConfig = authData.config;
          }
        }
      } catch (e) { }
    }

    await loadInitialData();
    bindConfigToUI(appConfig);
    showDashboardView('tab-dashboard');
    populateWidgetUrls();
    initDashboardMqtt();
    if (typeof initWidgetCustomization === 'function') initWidgetCustomization();

    if (channelName && window.tmi) {
      connectInBrowserTwitchBot(twitchCfg);
    }
  }

  // ================= LOGOUT CONFIRMATION MODAL & EXECUTION =================
  const logoutConfirmModal = document.getElementById('logoutConfirmModal');
  const logoutModalBackdrop = document.getElementById('logoutModalBackdrop');
  const btnCancelLogout = document.getElementById('btnCancelLogout');
  const btnConfirmLogout = document.getElementById('btnConfirmLogout');
  const logoutModalUser = document.getElementById('logoutModalUser');
  const logoutModalAvatar = document.getElementById('logoutModalAvatar');
  const logoutModalDisplayName = document.getElementById('logoutModalDisplayName');

  function openLogoutModal() {
    let currentChannel = (appConfig?.twitch?.channel || '').replace(/^#/, '');
    let currentDisplayName = appConfig?.twitch?.displayName || currentChannel || 'Streamer';
    let currentAvatar = appConfig?.twitch?.profileImage || 'https://static-cdn.jtvnw.net/user-default-pictures-uv/75305d54-c7cc-40d1-bb60-aee8f1560db5-profile_image-300x300.png';

    if (!currentChannel) {
      try {
        const local = localStorage.getItem('orbibot_twitch_auth');
        if (local) {
          const p = JSON.parse(local);
          currentChannel = (p.channel || p.login || '').replace(/^#/, '');
          currentDisplayName = p.displayName || currentChannel || 'Streamer';
          currentAvatar = p.profileImage || currentAvatar;
        }
      } catch (e) { }
    }

    if (logoutModalUser) logoutModalUser.innerText = `@${currentChannel || currentDisplayName || 'streamer'}`;
    if (logoutModalDisplayName) logoutModalDisplayName.innerText = currentDisplayName || 'Streamer';
    if (logoutModalAvatar) logoutModalAvatar.src = currentAvatar;

    if (logoutConfirmModal) {
      logoutConfirmModal.style.display = 'flex';
    }
  }

  function closeLogoutModal() {
    if (logoutConfirmModal) {
      logoutConfirmModal.style.display = 'none';
    }
  }

  async function executeLogout() {
    closeLogoutModal();

    try {
      await fetch('/api/bot/disconnect', { method: 'POST' });
    } catch (e) { }

    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { }

    // Clear ALL Twitch credentials & cached settings from localStorage
    localStorage.removeItem('orbibot_twitch_auth');
    localStorage.removeItem('orbibot_twitch_auth_event');
    localStorage.removeItem('orbibot_twitch_auth_error');
    localStorage.removeItem('orbibot_config');
    localStorage.removeItem('orbibot_commands');
    localStorage.removeItem('orbibot_rewards');
    localStorage.removeItem('orbibot_session');

    // Limpiar en la nube con Supabase
    if (typeof saveToAllSupabaseScopes === 'function') {
      saveToAllSupabaseScopes('twitch_auth', null).catch(() => {});
    }

    if (browserTmiClient) {
      try { browserTmiClient.disconnect(); } catch (e) { }
      browserTmiClient = null;
    }

    // Explicitly reset in-memory config state
    appConfig = {
      twitch: {
        channel: '',
        botUsername: '',
        oauthToken: '',
        clientId: 'yw1vr664ichms8an2x5lhji58v7ozk',
        connected: false,
        displayName: '',
        profileImage: '',
        userId: ''
      },
      songRequest: { prefix: '!sr', enabled: true, maxDurationMinutes: 8, maxPerUser: 5, userLevel: 'all', volume: 75, autoplay: true },
      tts: { enabled: true, voice: 'es_001', volume: 90, rate: 1.0, pitch: 1.0, maxLength: 250, bannedWords: [], allowChatCommand: true, chatCommand: '!tts', minBits: 50 },
      goals: {
        subs: { title: 'Meta de Suscriptores', current: 0, target: 50, color: '#9146ff' },
        followers: { title: 'Meta de Seguidores', current: 0, target: 300, color: '#00f2fe' },
        bits: { title: 'Meta de Bits', current: 0, target: 5000, color: '#f5a623' }
      }
    };

    // Reset Top Bar & Header Profile Display
    const topUserPill = document.getElementById('topUserPill');
    const topLoginBtn = document.getElementById('topTwitchLoginBtn');
    const loginHero = document.getElementById('dashboardLoginHero');
    const connectedHero = document.getElementById('dashboardConnectedHero');
    const dashUserAvatar = document.getElementById('dashUserAvatar');
    const dashUserName = document.getElementById('dashUserName');
    const dashUserTag = document.getElementById('dashUserTag');
    const topUserAvatar = document.getElementById('topUserAvatar');
    const topUserName = document.getElementById('topUserName');

    const botStatusDot = document.getElementById('botStatusDot');
    const botStatusText = document.getElementById('botStatusText');
    const twitchBadge = document.getElementById('twitchConnectionBadge');
    const statBotStatus = document.getElementById('statBotStatus');
    const statChannelName = document.getElementById('statChannelName');
    const quickConnectBtn = document.getElementById('quickConnectBtn');

    if (topUserPill) topUserPill.style.display = 'none';
    if (topLoginBtn) topLoginBtn.style.display = 'inline-flex';
    if (loginHero) loginHero.style.display = 'block';
    if (connectedHero) connectedHero.style.display = 'none';

    if (topUserAvatar) topUserAvatar.src = '';
    if (topUserName) topUserName.innerText = '@streamer';
    if (dashUserAvatar) dashUserAvatar.src = '';
    if (dashUserName) dashUserName.innerText = 'Streamer';
    if (dashUserTag) dashUserTag.innerText = '@streamer';

    if (botStatusDot) botStatusDot.className = 'status-dot disconnected';
    if (botStatusText) botStatusText.innerText = 'Desconectado';
    if (twitchBadge) {
      twitchBadge.className = 'btn btn-sm btn-danger';
      twitchBadge.innerText = '🔴 Desconectado';
    }
    if (statBotStatus) {
      statBotStatus.innerText = 'Inactivo';
      statBotStatus.style.color = 'var(--red-danger)';
    }
    if (statChannelName) statChannelName.innerText = 'Ninguno';
    if (quickConnectBtn) {
      quickConnectBtn.innerText = 'Iniciar Sesión';
      quickConnectBtn.className = 'btn btn-primary btn-sm';
    }

    const chanInput = document.getElementById('cfgTwitchChannel');
    const botInput = document.getElementById('cfgTwitchBotUser');
    const tokenInput = document.getElementById('cfgTwitchToken');
    if (chanInput) chanInput.value = '';
    if (botInput) botInput.value = '';
    if (tokenInput) tokenInput.value = '';

    // Clear chat list
    const chatList = document.getElementById('chatMessagesList');
    if (chatList) {
      chatList.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px 20px; font-size: 13px;">Conecta tu canal de Twitch para ver los mensajes del chat en tiempo real.</div>';
    }

    bindConfigToUI(appConfig);
    renderCommands([]);
    renderRewards([]);
    populateWidgetUrls();
    initDashboardMqtt();
    updatePlatformLinkingUI();

    showToast('🔒 Has cerrado sesión de Twitch correctamente.', 'info');
    switchTab('tab-dashboard');
  }

  function disconnectTwitchAccount() {
    openLogoutModal();
  }

  // Modal Buttons
  if (btnCancelLogout) btnCancelLogout.addEventListener('click', closeLogoutModal);
  if (logoutModalBackdrop) logoutModalBackdrop.addEventListener('click', closeLogoutModal);
  if (btnConfirmLogout) btnConfirmLogout.addEventListener('click', executeLogout);

  // Twitch Login Buttons
  const topLoginBtn = document.getElementById('topTwitchLoginBtn');
  if (topLoginBtn) topLoginBtn.addEventListener('click', triggerTwitchOAuthLogin);

  const heroLoginBtn = document.getElementById('heroTwitchLoginBtn');
  if (heroLoginBtn) heroLoginBtn.addEventListener('click', triggerTwitchOAuthLogin);

  // Twitch Logout Buttons
  const topLogoutBtn = document.getElementById('topLogoutBtn');
  if (topLogoutBtn) topLogoutBtn.addEventListener('click', openLogoutModal);

  const dashLogoutBtn = document.getElementById('dashLogoutBtn');
  if (dashLogoutBtn) dashLogoutBtn.addEventListener('click', openLogoutModal);

  // Dashboard quick actions
  const dashGotoObsBtn = document.getElementById('dashGotoObsBtn');
  if (dashGotoObsBtn) dashGotoObsBtn.addEventListener('click', () => switchTab('tab-overlays'));

  const dashGotoSrBtn = document.getElementById('dashGotoSrBtn');
  if (dashGotoSrBtn) dashGotoSrBtn.addEventListener('click', () => switchTab('tab-sr'));

  const dashGotoTtsBtn = document.getElementById('dashGotoTtsBtn');
  if (dashGotoTtsBtn) dashGotoTtsBtn.addEventListener('click', () => switchTab('tab-tts'));

  // Listen for OAuth callback message from popup if opener works
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'TWITCH_AUTH_SUCCESS') {
      await handleAuthSuccess(event.data);
    }
    if (event.data && event.data.type === 'KICK_AUTH_SUCCESS') {
      await handleKickAuthSuccess(event.data);
    }
  });

  // Sidebar Quick Connect Button
  const quickConnectBtn = document.getElementById('quickConnectBtn');
  if (quickConnectBtn) {
    quickConnectBtn.addEventListener('click', async () => {
      const isConnected = (appConfig?.twitch?.connected || Boolean(localStorage.getItem('orbibot_twitch_auth'))) && (appConfig?.twitch?.channel || localStorage.getItem('orbibot_twitch_auth'));
      if (isConnected) {
        openLogoutModal();
      } else {
        triggerTwitchOAuthLogin();
      }
    });
  }

  // Song Request Controls
  const btnSrPausePlay = document.getElementById('btnSrPausePlay');
  if (btnSrPausePlay) btnSrPausePlay.addEventListener('click', togglePausePlaySongRequest);

  const btnSrSkip = document.getElementById('btnSrSkip');
  if (btnSrSkip) btnSrSkip.addEventListener('click', skipCurrentSong);

  document.getElementById('btnSrClear').addEventListener('click', async () => {
    if (confirm('¿Seguro que deseas vaciar toda la cola de canciones?')) {
      const myRoom = getActiveStreamerRoom();
      try {
        const res = await fetch('/api/sr/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel: myRoom })
        });
        if (res.ok) {
          const data = await res.json();
          showToast(`Cola vaciada (${data.count} canciones eliminadas)`);
          return;
        }
      } catch (e) { }
      const state = getLocalSrState();
      const count = (state.queue || []).length;
      state.queue = [];
      saveLocalSrState(state);
      updateSongRequestUI(state);
      broadcastEvent('sr_update', { action: 'queue_clear', data: { count }, state });
      showToast(`Cola vaciada (${count} canciones eliminadas)`);
    }
  });

  document.getElementById('btnSrAddManual').addEventListener('click', async () => {
    const input = document.getElementById('srManualInput');
    const query = input.value.trim();
    if (!query) return;

    const myRoom = getActiveStreamerRoom();
    showToast('Buscando y añadiendo canción...', 'info');
    let added = false;
    try {
      const res = await fetch('/api/sr/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, requester: 'Streamer', channel: myRoom })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          showToast(data.message, 'success');
          input.value = '';
          added = true;
        } else {
          showToast(data.message, 'warn');
          return;
        }
      }
    } catch (e) { }

    if (!added) {
      handleClientSongRequest(query, 'Streamer', false);
      input.value = '';
    }
  });

  // TTS Test
  const btnTestTtsPlay = document.getElementById('btnTestTtsPlay');
  if (btnTestTtsPlay) {
    btnTestTtsPlay.addEventListener('click', triggerTestTTS);
  }

  // Save or Update Command
  document.getElementById('btnSaveNewCommand').addEventListener('click', async () => {
    const name = document.getElementById('newCmdName').value.trim();
    const response = document.getElementById('newCmdResponse').value.trim();
    const noCooldown = document.getElementById('newCmdNoCooldown')?.checked;
    const cooldownVal = Number(document.getElementById('newCmdCooldown').value);
    const cooldown = noCooldown ? 0 : (isNaN(cooldownVal) ? 10 : Math.max(0, cooldownVal));
    const userLevel = document.getElementById('newCmdUserLevel').value;
    const editId = document.getElementById('editCmdId')?.value;

    if (!name || !response) {
      showToast('Debes ingresar el nombre del comando y su respuesta', 'warn');
      return;
    }

    const formattedName = name.startsWith('!') ? name : `!${name}`;
    const commands = await fetch('/api/commands').then(r => r.json());

    const targetIdx = editId
      ? commands.findIndex(c => c.id === editId)
      : commands.findIndex(c => c.name.toLowerCase() === formattedName.toLowerCase());

    const newCmd = {
      id: targetIdx >= 0 ? commands[targetIdx].id : `cmd-${Date.now()}`,
      name: formattedName,
      response,
      cooldown,
      userLevel,
      enabled: true
    };

    if (targetIdx >= 0) {
      commands[targetIdx] = newCmd;
    } else {
      commands.push(newCmd);
    }

    let finalCommands = commands;
    try {
      const res = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commands)
      });
      const data = await res.json();
      if (data.commands) finalCommands = data.commands;
    } catch (e) { }

    localStorage.setItem('orbibot_commands', JSON.stringify(finalCommands));
    await saveToAllSupabaseScopes('commands', finalCommands);

    renderCommands(finalCommands);
    showToast(`Comando ${formattedName} guardado con éxito`, 'success');
    cancelEditCommand();
  });

  // Load custom sounds on startup
  loadSounds();
}

// ================= WIDGET CUSTOMIZATION SYSTEM =================
let wcCurrentWidget = 'alerts';
let wcCurrentMode = 'visual';
let wcActiveAlertEvent = 'follower';
let wcWidgetStyles = {};
let wcAlertImages = {
  follower: 'https://i.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
  sub: 'https://i.giphy.com/media/IwAZ6dvvvaNN6/giphy.gif',
  bits: 'https://i.giphy.com/media/LdOyjZ7io5MFUvcKs2/giphy.gif',
  raid: 'https://i.giphy.com/media/blSTtZehjAZ8I/giphy.gif',
  channel_points: 'https://i.giphy.com/media/111ebonMs90YLu/giphy.gif'
};

let wcAlertSounds = {
  follower: './assets/sounds/campana_alerta.wav',
  sub: './assets/sounds/campana_alerta.wav',
  bits: './assets/sounds/notificacion_puntos.wav',
  raid: './assets/sounds/airhorn.mp3',
  channel_points: './assets/sounds/notificacion_puntos.wav'
};

const WC_WIDGET_NAMES = {
  alerts: 'Alert Box',
  nowplaying: 'Now Playing',
  goals: 'Goal Bar',
  chat: 'Chat Overlay'
};

const WC_EVENT_NAMES = {
  follower: 'Seguidor',
  sub: 'Suscripción',
  bits: 'Donación de Bits',
  raid: 'Raid Entrante',
  channel_points: 'Puntos de Canal'
};

const WC_EVENT_PREVIEWS = {
  follower: { badge: 'NUEVO SEGUIDOR', title: '¡StreamerFan123!', msg: 'ahora sigue el canal' },
  sub: { badge: '¡NUEVA SUSCRIPCIÓN!', title: '¡SubVIP_Gamer!', msg: 'se suscribió al canal (Nivel 1)' },
  bits: { badge: 'DONACIÓN DE BITS', title: '¡GamerPro99!', msg: 'envió 500 Bits "¡Gran stream!"' },
  raid: { badge: 'RAID ENTRANTE', title: '¡CapitánRaid!', msg: 'llegó con 45 espectadores' },
  channel_points: { badge: 'PUNTOS DE CANAL', title: '¡ViewerActivo!', msg: 'canjeó "Mensaje Destacado"' }
};

const WC_DEFAULT_VALUES = {
  alerts: { fontFamily: "'Outfit', sans-serif", bgColor: '#0b0e14', bgOpacity: 88, titleColor: '#ffffff', messageColor: '#cbd5e1', accentColor: '#9146ff', titleSize: 32, messageSize: 20, borderRadius: 24, imageSize: 120, customCSS: '', customJS: '' },
  nowplaying: { fontFamily: "'Outfit', sans-serif", bgColor: '#0f121a', bgOpacity: 90, titleColor: '#ffffff', requesterColor: '#9146ff', titleSize: 16, borderRadius: 18, thumbSize: 64, customCSS: '', customJS: '' },
  goals: { fontFamily: "'Outfit', sans-serif", barColor: '#9146ff', barColor2: '#00f2fe', bgColor: '#0e121c', bgOpacity: 92, barHeight: 18, fontSize: 15, borderRadius: 18, customCSS: '', customJS: '' },
  chat: { fontFamily: "'Outfit', sans-serif", bubbleBg: '#0f141e', bgOpacity: 85, usernameColor: '#9146ff', textColor: '#f1f5f9', fontSize: 14, borderRadius: 14, borderLeftWidth: 4, borderLeftColor: '#9146ff', customCSS: '', customJS: '' }
};

const WC_PRESET_GIFS = {
  follower: [
    { name: "Pikachu Saludo", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWk1YW0yZXpxM3c2NHJreGQxbDduMWVvb3hpZGl2dHVqMm1pMG1jYyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/artj92V8o75VPL7AeQ/giphy.gif" },
    { name: "Gatito Feliz", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMjRqa2p6N2Z2c2R0b2s5OXF1bXk4bHhqa3p2Z3BhMGYwb283ZDNyOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/MDJ9IbxxvDUQM/giphy.gif" },
    { name: "Kirby Baile", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2RtcW9hNnl6OXh0eGg5Z3pxMXdpdW9vODFwcm5tM3g1Y3l4OXVsayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/5gUnOrltPvZzW/giphy.gif" },
    { name: "Sonic Bienvenida", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmN0d2psNWtwZmRzMGJrdmszM2R2MXd2YWRnOTlvOWV5eHlzMndkayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/111ebonMs90YLu/giphy.gif" }
  ],
  sub: [
    { name: "Fiesta Confetti", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOHF4bWpna2JpcXpiZWhqZXE1aXF3MHp4eGpoMXE1bmRhNDVvNXppZSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/IwAZ6dvvvaNN6/giphy.gif" },
    { name: "Minion Festejo", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaGtpNjA5bTZodjVjdzV6c25lZmt1bGVpNWtseHNld2Qxd2c1NmF1NSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o7TKSjRrfIPjeiVyM/giphy.gif" },
    { name: "Daft Punk Dance", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNWw4djNudDhtYmpxZ2c1M3dzbmJmbmd3eHlzb21mNzhsaXpvczJjOCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l3vRlT2k2L35Cnn5C/giphy.gif" },
    { name: "Goku Super Saiyan", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmJpcnd4OGM4NXBxaHZqMnZ0aHlxbW50NHl3aXp6Y2NsdG56eTZzMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/97HXn1oGkn37G/giphy.gif" }
  ],
  bits: [
    { name: "Lluvia de Dinero", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExeGJ3eG5obHRwZjcxNHNlNW56dzd2dXB1NmJhcWlnM3c5enIydTFoYSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/LdOyjZ7io5MFUvcKs2/giphy.gif" },
    { name: "Cofre del Tesoro", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaTJveXprZHdrZzB0MnlxbGtsMDkyaW5pYWt4eGJ5b3hzdG56bmpsdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26FPJGjhefSJuaRhu/giphy.gif" },
    { name: "Diamantes Neón", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExazlraXBtdWdwZXp5M2VvdGphYndjZnphZ3l4eGR4cXd2ZThsYjVveSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l0ExhcMymLxqLRM08/giphy.gif" },
    { name: "Mario Monedas", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOXV0OXhjc3M4eG92aW55azc3NGhrcDJzcnRhYW5ub3oxbXFoaGg5ZiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/12PA1zBdFbKFaY/giphy.gif" }
  ],
  raid: [
    { name: "Ejército Vikingo", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2Z0dTh1Z3E0cW51ZnRtdnExNmRwbTN4eWxnd2ZtN213MWg5bmk0eCZlcD12MV9naWZzX3NlYXJjaCZjdD1n/blSTtZehjAZ8I/giphy.gif" },
    { name: "Avengers Hype", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdDF1aWFidmtyaGJlMmpldWtpM2FjcW80a2xobzNxbXRucnBmdzNveiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/l41lI4bYmcsPJX9Go/giphy.gif" },
    { name: "Fuegos Artificiales", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnd6aTh0dHVxOGdtaXAzbndubnhrbnhxY2Q2b3ZtdnZob2lhaWdhciZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26tPplGWjN0xLybiU/giphy.gif" }
  ],
  channel_points: [
    { name: "Estrella Mágica", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOW11aWRqZG56YWNka2R3N3N6M2cydDV0OW15bmw0NWJ1ZW51bnd4eiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/111ebonMs90YLu/giphy.gif" },
    { name: "PogChamp", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdnQ1d211YWFscTFjOXNxc3dxM3lyMTRldzZvbDVjMTd6d3lqN2o1dSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/SLFp6ucA5uZEC8Q7b9/giphy.gif" },
    { name: "Gato Bailarín", url: "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExMmZ1MmhyazBpdWExN3Zma3lna21idW51M3lseG1kNHJ3NDF1ZnJ5NiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/jpbnoe3UIa8TU8LM13/giphy.gif" }
  ]
};

function selectCustomizeWidget(widgetKey) {
  wcCurrentWidget = widgetKey;

  // Update selector cards
  document.querySelectorAll('.wc-widget-selector').forEach(el => {
    el.classList.toggle('active', el.dataset.widget === widgetKey);
  });

  // Show/hide control groups
  document.querySelectorAll('.wc-controls-group').forEach(el => el.style.display = 'none');
  const activeGroup = document.getElementById(`wcControls-${widgetKey}`);
  if (activeGroup) activeGroup.style.display = '';

  // Show/hide previews
  document.querySelectorAll('.wc-preview-widget').forEach(el => el.style.display = 'none');
  const activePv = document.getElementById(`wcPreview-${widgetKey}`);
  if (activePv) activePv.style.display = (widgetKey === 'alerts') ? 'flex' : '';

  // Update titles
  const name = WC_WIDGET_NAMES[widgetKey] || widgetKey;
  const visualTitle = document.getElementById('wcVisualTitle');
  const codeTitle = document.getElementById('wcCodeTitle');
  if (visualTitle) visualTitle.innerText = `🎛️ Editor Visual — ${name}`;
  if (codeTitle) codeTitle.innerText = `💻 Editor de Código — ${name}`;

  // Load saved values into controls
  loadWidgetControlValues(widgetKey);

  // Load code editor content
  const styles = wcWidgetStyles[widgetKey] || {};
  const cssEl = document.getElementById('wcCustomCSS');
  const jsEl = document.getElementById('wcCustomJS');
  if (cssEl) cssEl.value = styles.customCSS || '';
  if (jsEl) jsEl.value = styles.customJS || '';
}

function switchCustomizeMode(mode) {
  wcCurrentMode = mode;
  document.querySelectorAll('.wc-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  const visual = document.getElementById('wcVisualEditor');
  const code = document.getElementById('wcCodeEditor');
  if (mode === 'visual') {
    if (visual) visual.style.display = '';
    if (code) code.style.display = 'none';
  } else {
    if (visual) visual.style.display = 'none';
    if (code) code.style.display = '';
  }
}

function selectAlertEvent(eventKey) {
  wcActiveAlertEvent = eventKey;

  // Update event pill buttons
  document.querySelectorAll('.wc-event-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.event === eventKey);
  });

  // Update media and sound header titles
  const mediaTitle = document.getElementById('wcAlertMediaTitle');
  if (mediaTitle) {
    mediaTitle.innerText = `🖼️ Imagen / GIF de Alerta (${WC_EVENT_NAMES[eventKey] || eventKey})`;
  }

  const soundTitle = document.getElementById('wcAlertSoundTitle');
  if (soundTitle) {
    soundTitle.innerText = `🔊 Sonido de Alerta (${WC_EVENT_NAMES[eventKey] || eventKey})`;
  }

  // Load current image URL into input
  const urlInput = document.getElementById('wc-alert-imageUrl');
  const currentImg = wcAlertImages[eventKey] || WC_DEFAULT_ALERT_IMAGES[eventKey] || '';
  if (urlInput) urlInput.value = currentImg;

  // Populate GIF Gallery grid
  renderGifGallery(eventKey);

  // Load sound select
  const currentSound = wcAlertSounds[eventKey] || './assets/sounds/campana_alerta.wav';
  const soundSelect = document.getElementById('wc-alert-soundSelect');
  const customSoundRow = document.getElementById('wcAlertCustomSoundRow');
  const customSoundInput = document.getElementById('wc-alert-soundUrl');

  if (soundSelect) {
    let matchedOption = Array.from(soundSelect.options).find(o => o.value === currentSound);
    if (matchedOption) {
      soundSelect.value = currentSound;
      if (customSoundRow) customSoundRow.style.display = 'none';
    } else if (currentSound && currentSound !== 'custom') {
      const customOpt = soundSelect.querySelector('option[value="custom"]');
      const newOpt = document.createElement('option');
      newOpt.className = 'custom-uploaded-sound-opt';
      newOpt.value = currentSound;
      const cleanName = currentSound.startsWith('data:') ? 'Audio Personalizado' : (currentSound.split('/').pop() || 'Audio Personalizado');
      newOpt.innerText = `🎵 ${cleanName}`;
      if (customOpt) {
        soundSelect.insertBefore(newOpt, customOpt);
      } else {
        soundSelect.appendChild(newOpt);
      }
      soundSelect.value = currentSound;
      if (customSoundRow) customSoundRow.style.display = 'none';
    } else {
      soundSelect.value = 'custom';
      if (customSoundRow) customSoundRow.style.display = 'block';
      if (customSoundInput) customSoundInput.value = currentSound;
    }
  }

  // Update live preview card content
  const pvInfo = WC_EVENT_PREVIEWS[eventKey] || { badge: eventKey.toUpperCase(), title: '¡Usuario!', msg: 'ha interactuado' };
  const badgeEl = document.getElementById('wcPvAlertBadge');
  const titleEl = document.getElementById('wcPvAlertTitle');
  const msgEl = document.getElementById('wcPvAlertMsg');
  const imgEl = document.getElementById('wcPvAlertImg');

  if (badgeEl) badgeEl.innerText = pvInfo.badge;
  if (titleEl) titleEl.innerText = pvInfo.title;
  if (msgEl) msgEl.innerText = pvInfo.msg;
  if (imgEl) imgEl.src = currentImg;
}

function renderGifGallery(eventKey) {
  const grid = document.getElementById('wcGifGalleryGrid');
  if (!grid) return;

  const gifs = WC_PRESET_GIFS[eventKey] || WC_PRESET_GIFS.follower;
  grid.innerHTML = gifs.map(g => `
    <div class="wc-gif-card" onclick="selectGalleryGif('${g.url}', '${g.name}')" title="${g.name}">
      <img src="${g.url}" alt="${g.name}" loading="lazy">
      <div class="wc-gif-title">${g.name}</div>
    </div>
  `).join('');
}

function toggleGifGallery() {
  const drawer = document.getElementById('wcGifGalleryDrawer');
  if (!drawer) return;
  const isShown = drawer.style.display !== 'none';
  drawer.style.display = isShown ? 'none' : 'block';
  if (!isShown) renderGifGallery(wcActiveAlertEvent);
}

let widgetStylesAutoSaveTimer = null;
function triggerAutoSaveWidgetStyles(delay = 600) {
  setAutoSaveStatus('saving');
  if (widgetStylesAutoSaveTimer) clearTimeout(widgetStylesAutoSaveTimer);
  widgetStylesAutoSaveTimer = setTimeout(() => {
    saveWidgetStyles();
  }, delay);
}

function selectGalleryGif(url, name) {
  wcAlertImages[wcActiveAlertEvent] = url;
  const urlInput = document.getElementById('wc-alert-imageUrl');
  if (urlInput) urlInput.value = url;

  const imgEl = document.getElementById('wcPvAlertImg');
  if (imgEl) imgEl.src = url;

  saveWidgetStyles();
  showToast(`GIF "${name}" guardado para ${WC_EVENT_NAMES[wcActiveAlertEvent]}`, 'info');
}

function handleAlertUrlInput(url) {
  const cleanUrl = url.trim();
  wcAlertImages[wcActiveAlertEvent] = cleanUrl;
  const imgEl = document.getElementById('wcPvAlertImg');
  if (imgEl && cleanUrl) imgEl.src = cleanUrl;
  triggerAutoSaveWidgetStyles();
}

function handleAlertFileUpload(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if (file.size > 25 * 1024 * 1024) {
      showToast('El archivo de imagen es demasiado grande (máximo 25MB)', 'error');
      return;
    }

    showToast(`Subiendo imagen "${file.name}"...`, 'info');
    const reader = new FileReader();
    reader.onload = async function (e) {
      const dataUrl = e.target.result;
      let finalUrl = dataUrl;

      // 1. Subir al servidor backend /api/images/upload
      try {
        const res = await fetch('/api/images/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data: dataUrl })
        });
        const data = await res.json();
        if (data.success && data.url) {
          finalUrl = data.url;
        }
      } catch (err) {
        console.warn('Backend image upload fallback to DataURL:', err);
      }

      // 2. Guardar en orbibot_custom_images local
      try {
        let customImages = JSON.parse(localStorage.getItem('orbibot_custom_images') || '[]');
        if (!Array.isArray(customImages)) customImages = [];
        const imgObj = { name: file.name, url: finalUrl, dataUrl: dataUrl, createdAt: Date.now() };
        const idx = customImages.findIndex(im => im.name.toLowerCase() === file.name.toLowerCase());
        if (idx >= 0) customImages[idx] = imgObj;
        else customImages.push(imgObj);
        localStorage.setItem('orbibot_custom_images', JSON.stringify(customImages));
        if (typeof saveToAllSupabaseScopes === 'function') {
          saveToAllSupabaseScopes('custom_images', customImages).catch(() => {});
        }
      } catch (e) { }

      wcAlertImages[wcActiveAlertEvent] = finalUrl;
      const urlInput = document.getElementById('wc-alert-imageUrl');
      if (urlInput) urlInput.value = finalUrl;
      const imgEl = document.getElementById('wcPvAlertImg');
      if (imgEl) imgEl.src = finalUrl;

      // Guardar inmediatamente
      await saveWidgetStyles();
      showToast(`✅ Imagen "${file.name}" guardada para ${WC_EVENT_NAMES[wcActiveAlertEvent]}`, 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
  }
}

// Sound Management
function handleAlertSoundSelect(val) {
  const customRow = document.getElementById('wcAlertCustomSoundRow');
  if (val === 'custom') {
    if (customRow) customRow.style.display = 'block';
  } else {
    if (customRow) customRow.style.display = 'none';
    wcAlertSounds[wcActiveAlertEvent] = val;
    playActiveAlertSound();
    saveWidgetStyles();
  }
}

function handleAlertSoundUrlInput(url) {
  wcAlertSounds[wcActiveAlertEvent] = url.trim();
  triggerAutoSaveWidgetStyles();
}

function handleAlertSoundUpload(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    if (file.size > 25 * 1024 * 1024) {
      showToast('El archivo de audio es demasiado grande (máximo 25MB)', 'error');
      return;
    }

    showToast(`Subiendo audio "${file.name}"...`, 'info');
    const reader = new FileReader();
    reader.onload = async function (e) {
      const dataUrl = e.target.result;
      let finalUrl = dataUrl;

      // 1. Subir al backend /api/sounds/upload
      try {
        const res = await fetch('/api/sounds/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, data: dataUrl })
        });
        const data = await res.json();
        if (data.success && data.url) {
          finalUrl = data.url;
        }
      } catch (err) {
        console.warn('Backend sound upload fallback to DataURL:', err);
      }

      // 2. Guardar en orbibot_custom_sounds local y en la nube
      try {
        let customSounds = JSON.parse(localStorage.getItem('orbibot_custom_sounds') || '[]');
        if (!Array.isArray(customSounds)) customSounds = [];
        const soundObj = { name: file.name, url: finalUrl, dataUrl: dataUrl, createdAt: Date.now() };
        const idx = customSounds.findIndex(s => s.name.toLowerCase() === file.name.toLowerCase());
        if (idx >= 0) customSounds[idx] = soundObj;
        else customSounds.push(soundObj);
        localStorage.setItem('orbibot_custom_sounds', JSON.stringify(customSounds));

        if (typeof saveToAllSupabaseScopes === 'function') {
          saveToAllSupabaseScopes('custom_sounds', customSounds).catch(() => {});
        }
      } catch (e) { }

      wcAlertSounds[wcActiveAlertEvent] = finalUrl;
      addSoundOption(finalUrl, file.name);
      playActiveAlertSound();

      // Guardar inmediatamente
      await saveWidgetStyles();
      await loadSounds();
      showToast(`✅ Audio "${file.name}" guardado para ${WC_EVENT_NAMES[wcActiveAlertEvent]}`, 'success');
    };
    reader.readAsDataURL(file);
    input.value = '';
  }
}

function addSoundOption(url, name) {
  const sel = document.getElementById('wc-alert-soundSelect');
  if (!sel) return;
  const opt = document.createElement('option');
  opt.value = url;
  opt.innerText = `🎵 ${name}`;
  sel.insertBefore(opt, sel.lastElementChild);
  sel.value = url;
}

function playActiveAlertSound() {
  const sound = wcAlertSounds[wcActiveAlertEvent] || './assets/sounds/campana_alerta.wav';
  if (sound === 'synthesizer') {
    playSynthesizedAlertChime(wcActiveAlertEvent);
    return;
  }
  previewSound(sound, WC_EVENT_NAMES[wcActiveAlertEvent] || 'Alerta');
}

function playSynthesizedAlertChime(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    let freqs = [523.25, 659.25, 783.99, 1046.50];
    if (type === 'bits') freqs = [587.33, 739.99, 880.00, 1174.66];
    if (type === 'sub') freqs = [440.00, 554.37, 659.25, 880.00];
    if (type === 'raid') freqs = [493.88, 659.25, 987.77, 1318.51];
    osc.frequency.setValueAtTime(freqs[0], now);
    osc.frequency.exponentialRampToValueAtTime(freqs[3], now + 0.35);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.6);
  } catch (e) { }
}

function previewAlertAnimation() {
  const card = document.getElementById('wcPvAlertCard');
  if (!card) return;

  playActiveAlertSound();

  // Trigger bounce / pulse animation
  card.style.transform = 'scale(0.85)';
  card.style.opacity = '0';
  setTimeout(() => {
    card.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    card.style.transform = 'scale(1.05)';
    card.style.opacity = '1';
    setTimeout(() => {
      card.style.transform = 'scale(1)';
    }, 400);
  }, 100);
}

function triggerActiveAlertTest() {
  const eventKey = wcActiveAlertEvent || 'follower';
  triggerTestAlert(eventKey);
}

function loadWidgetControlValues(widgetKey) {
  const styles = wcWidgetStyles[widgetKey] || WC_DEFAULT_VALUES[widgetKey] || {};
  const defaults = WC_DEFAULT_VALUES[widgetKey] || {};
  const merged = { ...defaults, ...styles };

  // For each input and select in the widget's control group, set value
  const group = document.getElementById(`wcControls-${widgetKey}`);
  if (!group) return;

  group.querySelectorAll('input, select').forEach(input => {
    const prop = input.dataset.prop;
    if (!prop) return;
    const val = merged[prop];
    if (val !== undefined) {
      input.value = val;
    }
    // Update range display value
    if (input.type === 'range') {
      const valEl = document.getElementById(`${input.id}-val`);
      if (valEl) {
        const unit = prop.includes('Opacity') ? '%' : 'px';
        valEl.innerText = `${input.value}${unit}`;
      }
    }
  });

  // If alerts, also select current alert event
  if (widgetKey === 'alerts') {
    selectAlertEvent(wcActiveAlertEvent || 'follower');
  }

  // Apply to preview
  updateWidgetPreview(widgetKey, merged);
}

function getWidgetValues(widgetKey) {
  const group = document.getElementById(`wcControls-${widgetKey}`);
  if (!group) return {};
  const values = {};
  group.querySelectorAll('input, select').forEach(input => {
    const prop = input.dataset.prop;
    if (!prop) return;
    if (input.type === 'color' || input.tagName === 'SELECT') {
      values[prop] = input.value;
    } else {
      values[prop] = Number(input.value);
    }
  });
  // Include code editor values
  values.customCSS = document.getElementById('wcCustomCSS')?.value || '';
  values.customJS = document.getElementById('wcCustomJS')?.value || '';
  return values;
}

function updateWidgetPreview(widgetKey, vals) {
  const font = vals.fontFamily || "'Outfit', sans-serif";

  if (widgetKey === 'alerts') {
    const card = document.getElementById('wcPvAlertCard');
    const badge = document.getElementById('wcPvAlertBadge');
    const title = document.getElementById('wcPvAlertTitle');
    const msg = document.getElementById('wcPvAlertMsg');
    const img = document.getElementById('wcPvAlertImg');

    if (card) {
      card.style.fontFamily = font;
      const r = Math.round(parseInt(vals.bgColor?.slice(1, 3) || '0b', 16));
      const g = Math.round(parseInt(vals.bgColor?.slice(3, 5) || '0e', 16));
      const b = Math.round(parseInt(vals.bgColor?.slice(5, 7) || '14', 16));
      card.style.background = `rgba(${r},${g},${b},${(vals.bgOpacity || 88) / 100})`;
      card.style.borderRadius = `${vals.borderRadius || 24}px`;
      card.style.borderColor = vals.accentColor || '#9146ff';
      card.style.boxShadow = `0 10px 40px rgba(0,0,0,0.6), 0 0 35px ${vals.accentColor || '#9146ff'}50`;
    }
    if (badge) {
      badge.style.fontFamily = font;
      badge.style.background = `linear-gradient(135deg, ${vals.accentColor || '#9146ff'}, #00f2fe)`;
    }
    if (title) {
      title.style.fontFamily = font;
      title.style.color = vals.titleColor || '#fff';
      title.style.fontSize = `${vals.titleSize || 32}px`;
    }
    if (msg) {
      msg.style.fontFamily = font;
      msg.style.color = vals.messageColor || '#cbd5e1';
      msg.style.fontSize = `${vals.messageSize || 20}px`;
    }
    if (img) {
      img.style.maxHeight = `${vals.imageSize || 120}px`;
    }

  } else if (widgetKey === 'nowplaying') {
    const card = document.getElementById('wcPvNpCard');
    const title = document.getElementById('wcPvNpTitle');
    const thumb = document.getElementById('wcPvNpThumb');
    const req = document.getElementById('wcPvNpRequester');
    if (card) {
      card.style.fontFamily = font;
      const r = parseInt(vals.bgColor?.slice(1, 3) || '0f', 16);
      const g = parseInt(vals.bgColor?.slice(3, 5) || '12', 16);
      const b = parseInt(vals.bgColor?.slice(5, 7) || '1a', 16);
      card.style.background = `rgba(${r},${g},${b},${(vals.bgOpacity || 90) / 100})`;
      card.style.borderRadius = `${vals.borderRadius || 18}px`;
    }
    if (title) {
      title.style.fontFamily = font;
      title.style.color = vals.titleColor || '#fff';
      title.style.fontSize = `${vals.titleSize || 16}px`;
    }
    if (thumb) {
      thumb.style.width = `${vals.thumbSize || 64}px`;
      thumb.style.height = `${vals.thumbSize || 64}px`;
    }
    if (req) {
      req.style.fontFamily = font;
      const s = req.querySelector('strong');
      if (s) s.style.color = vals.requesterColor || '#9146ff';
    }

  } else if (widgetKey === 'goals') {
    const card = document.getElementById('wcPvGoalCard');
    const titleEl = document.getElementById('wcPvGoalTitle');
    const barBg = card?.querySelector('.wc-pv-goal-bar-bg');
    const fill = document.getElementById('wcPvGoalFill');
    if (card) {
      card.style.fontFamily = font;
      const r = parseInt(vals.bgColor?.slice(1, 3) || '0e', 16);
      const g = parseInt(vals.bgColor?.slice(3, 5) || '12', 16);
      const b = parseInt(vals.bgColor?.slice(5, 7) || '1c', 16);
      card.style.background = `rgba(${r},${g},${b},${(vals.bgOpacity || 92) / 100})`;
      card.style.borderRadius = `${vals.borderRadius || 18}px`;
    }
    if (titleEl) {
      titleEl.style.fontFamily = font;
      titleEl.style.fontSize = `${vals.fontSize || 15}px`;
    }
    if (barBg) barBg.style.height = `${vals.barHeight || 18}px`;
    if (fill) fill.style.background = `linear-gradient(90deg, ${vals.barColor || '#9146ff'}, ${vals.barColor2 || '#00f2fe'})`;

  } else if (widgetKey === 'chat') {
    const bubbles = document.querySelectorAll('.wc-pv-chat-bubble');
    const texts = document.querySelectorAll('.wc-pv-chat-text');
    const users = document.querySelectorAll('.wc-pv-chat-user');

    bubbles.forEach(b => {
      b.style.fontFamily = font;
      const r = parseInt(vals.bubbleBg?.slice(1, 3) || '0f', 16);
      const g = parseInt(vals.bubbleBg?.slice(3, 5) || '14', 16);
      const bb = parseInt(vals.bubbleBg?.slice(5, 7) || '1e', 16);
      b.style.background = `rgba(${r},${g},${bb},${(vals.bgOpacity || 85) / 100})`;
      b.style.borderRadius = `${vals.borderRadius || 14}px`;
      b.style.borderLeftWidth = `${vals.borderLeftWidth || 4}px`;
      b.style.borderLeftColor = vals.borderLeftColor || '#9146ff';
    });
    users.forEach(u => {
      u.style.fontFamily = font;
      u.style.color = vals.usernameColor || '#9146ff';
    });
    texts.forEach(t => {
      t.style.fontFamily = font;
      t.style.color = vals.textColor || '#f1f5f9';
      t.style.fontSize = `${vals.fontSize || 14}px`;
    });
  }
}

function generateWidgetCSS(widgetKey, vals) {
  const font = vals.fontFamily || "'Outfit', sans-serif";

  if (widgetKey === 'alerts') {
    const r = parseInt(vals.bgColor?.slice(1, 3) || '0b', 16);
    const g = parseInt(vals.bgColor?.slice(3, 5) || '0e', 16);
    const b = parseInt(vals.bgColor?.slice(5, 7) || '14', 16);
    return `/* OrbiBot Custom Styles - Alert Box */
.alert-card {
  font-family: ${font} !important;
  background: rgba(${r},${g},${b},${(vals.bgOpacity || 88) / 100}) !important;
  border-radius: ${vals.borderRadius || 24}px !important;
  border-color: ${vals.accentColor || '#9146ff'} !important;
  box-shadow: 0 10px 40px rgba(0,0,0,0.6), 0 0 35px ${vals.accentColor || '#9146ff'}50 !important;
}
.alert-title {
  font-family: ${font} !important;
  color: ${vals.titleColor || '#ffffff'} !important;
  font-size: ${vals.titleSize || 32}px !important;
}
.alert-message {
  font-family: ${font} !important;
  color: ${vals.messageColor || '#cbd5e1'} !important;
  font-size: ${vals.messageSize || 20}px !important;
}
.alert-badge {
  font-family: ${font} !important;
  background: linear-gradient(135deg, ${vals.accentColor || '#9146ff'}, #00f2fe) !important;
}
.alert-media {
  max-height: ${vals.imageSize || 120}px !important;
}
`;
  } else if (widgetKey === 'nowplaying') {
    const r = parseInt(vals.bgColor?.slice(1, 3) || '0f', 16);
    const g = parseInt(vals.bgColor?.slice(3, 5) || '12', 16);
    const b = parseInt(vals.bgColor?.slice(5, 7) || '1a', 16);
    return `/* OrbiBot Custom Styles - Now Playing */
.np-card {
  font-family: ${font} !important;
  background: rgba(${r},${g},${b},${(vals.bgOpacity || 90) / 100}) !important;
  border-radius: ${vals.borderRadius || 18}px !important;
}
.np-title {
  font-family: ${font} !important;
  color: ${vals.titleColor || '#ffffff'} !important;
  font-size: ${vals.titleSize || 16}px !important;
}
.np-requester {
  font-family: ${font} !important;
}
.np-requester strong {
  color: ${vals.requesterColor || '#9146ff'} !important;
}
.np-thumb-wrapper {
  width: ${vals.thumbSize || 64}px !important;
  height: ${vals.thumbSize || 64}px !important;
}
`;
  } else if (widgetKey === 'goals') {
    const r = parseInt(vals.bgColor?.slice(1, 3) || '0e', 16);
    const g = parseInt(vals.bgColor?.slice(3, 5) || '12', 16);
    const b = parseInt(vals.bgColor?.slice(5, 7) || '1c', 16);
    return `/* OrbiBot Custom Styles - Goal Bar */
.goal-card {
  font-family: ${font} !important;
  background: rgba(${r},${g},${b},${(vals.bgOpacity || 92) / 100}) !important;
  border-radius: ${vals.borderRadius || 18}px !important;
}
.goal-title {
  font-family: ${font} !important;
  font-size: ${vals.fontSize || 15}px !important;
}
.goal-bar-bg {
  height: ${vals.barHeight || 18}px !important;
}
.goal-bar-fill {
  background: linear-gradient(90deg, ${vals.barColor || '#9146ff'}, ${vals.barColor2 || '#00f2fe'}) !important;
}
`;
  } else if (widgetKey === 'chat') {
    const r = parseInt(vals.bubbleBg?.slice(1, 3) || '0f', 16);
    const g = parseInt(vals.bubbleBg?.slice(3, 5) || '14', 16);
    const b = parseInt(vals.bubbleBg?.slice(5, 7) || '1e', 16);
    return `/* OrbiBot Custom Styles - Chat Overlay */
.chat-bubble {
  font-family: ${font} !important;
  background: rgba(${r},${g},${b},${(vals.bgOpacity || 85) / 100}) !important;
  border-radius: ${vals.borderRadius || 14}px !important;
  border-left-width: ${vals.borderLeftWidth || 4}px !important;
  border-left-color: ${vals.borderLeftColor || '#9146ff'} !important;
}
.chat-bubble .username {
  font-family: ${font} !important;
  color: ${vals.usernameColor || '#9146ff'} !important;
}
.chat-bubble .text {
  font-family: ${font} !important;
  color: ${vals.textColor || '#f1f5f9'} !important;
  font-size: ${vals.fontSize || 14}px !important;
}
`;
  }
  return '';
}

async function saveWidgetStyles() {
  setAutoSaveStatus('saving');

  // Collect current widget values
  const vals = getWidgetValues(wcCurrentWidget);
  // Generate CSS from visual controls
  const generatedCSS = generateWidgetCSS(wcCurrentWidget, vals);

  // Merge custom CSS from code editor with generated CSS
  const userCSS = vals.customCSS || '';
  const finalCSS = userCSS ? `${generatedCSS}\n/* --- CSS Personalizado del Usuario --- */\n${userCSS}` : generatedCSS;

  // Save to widgetStyles
  wcWidgetStyles[wcCurrentWidget] = {
    ...vals,
    generatedCSS: generatedCSS,
    finalCSS: finalCSS
  };

  // If alerts widget, also attach custom images and sounds
  if (wcCurrentWidget === 'alerts') {
    wcWidgetStyles.alerts.images = wcAlertImages;
    wcWidgetStyles.alerts.sounds = wcAlertSounds;
  }

  // Save to config
  const payload = { widgetStyles: wcWidgetStyles };

  try {
    // Save to localStorage
    let cfg = JSON.parse(localStorage.getItem('orbibot_config') || '{}');
    cfg.widgetStyles = wcWidgetStyles;
    localStorage.setItem('orbibot_config', JSON.stringify(cfg));

    // Save to backend config (Syncs to Supabase)
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      appConfig = data.config;
    }

    // Also update /api/alerts (Syncs to Supabase under key='alerts')
    let updatedAlerts = null;
    if (wcCurrentWidget === 'alerts') {
      try {
        const currentAlertsRes = await fetch('/api/alerts');
        const currentAlerts = await currentAlertsRes.json();
        updatedAlerts = { ...currentAlerts };

        Object.keys(wcAlertImages).forEach(evKey => {
          if (!updatedAlerts[evKey]) updatedAlerts[evKey] = {};
          updatedAlerts[evKey].image = wcAlertImages[evKey];
        });

        Object.keys(wcAlertSounds).forEach(evKey => {
          if (!updatedAlerts[evKey]) updatedAlerts[evKey] = {};
          updatedAlerts[evKey].sound = wcAlertSounds[evKey];
        });

        await fetch('/api/alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedAlerts)
        });

        localStorage.setItem('orbibot_alerts', JSON.stringify(updatedAlerts));
      } catch (e) { }
    }

    // Direct Multi-Scope Supabase Cloud Sync
    await saveToAllSupabaseScopes('widgetStyles', wcWidgetStyles);
    await saveToAllSupabaseScopes('config', appConfig || cfg);
    if (updatedAlerts) {
      await saveToAllSupabaseScopes('alerts', updatedAlerts);
    }

    setAutoSaveStatus('saved');
    showToast(`✅ Configuración y multimedia de "${WC_WIDGET_NAMES[wcCurrentWidget]}" guardados`, 'success');
  } catch (e) {
    setAutoSaveStatus('saved');
    showToast('Estilos guardados', 'info');
  }
}

function resetWidgetStyles() {
  const defaults = WC_DEFAULT_VALUES[wcCurrentWidget];
  if (!defaults) return;

  wcWidgetStyles[wcCurrentWidget] = { ...defaults };

  if (wcCurrentWidget === 'alerts') {
    wcAlertImages = { ...WC_DEFAULT_ALERT_IMAGES };
    wcAlertSounds = {
      follower: './assets/sounds/campana_alerta.wav',
      sub: './assets/sounds/campana_alerta.wav',
      bits: './assets/sounds/notificacion_puntos.wav',
      raid: './assets/sounds/airhorn.mp3',
      channel_points: './assets/sounds/notificacion_puntos.wav'
    };
  }

  // Reset code editor
  const cssEl = document.getElementById('wcCustomCSS');
  const jsEl = document.getElementById('wcCustomJS');
  if (cssEl) cssEl.value = '';
  if (jsEl) jsEl.value = '';

  loadWidgetControlValues(wcCurrentWidget);
  showToast(`🔄 Estilos de "${WC_WIDGET_NAMES[wcCurrentWidget]}" restablecidos`, 'info');
}

function initWidgetCustomization() {
  // 1. Load saved widget styles from appConfig
  if (appConfig && appConfig.widgetStyles) {
    wcWidgetStyles = appConfig.widgetStyles;
    if (wcWidgetStyles.alerts) {
      if (wcWidgetStyles.alerts.images) {
        wcAlertImages = { ...wcAlertImages, ...wcWidgetStyles.alerts.images };
      }
      if (wcWidgetStyles.alerts.sounds) {
        wcAlertSounds = { ...wcAlertSounds, ...wcWidgetStyles.alerts.sounds };
      }
    }
  }

  // 2. Load alerts from localStorage if present
  try {
    const localAlerts = JSON.parse(localStorage.getItem('orbibot_alerts') || '{}');
    if (localAlerts && typeof localAlerts === 'object') {
      Object.keys(localAlerts).forEach(k => {
        if (localAlerts[k]?.image) wcAlertImages[k] = localAlerts[k].image;
        if (localAlerts[k]?.sound) wcAlertSounds[k] = localAlerts[k].sound;
      });
    }
  } catch (e) { }

  // 3. Also fetch saved alert images and sounds from /api/alerts if backend is available
  const isStaticHosting = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
  if (!isStaticHosting) {
    fetch('/api/alerts')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(k => {
            if (data[k]) {
              if (data[k].image) wcAlertImages[k] = data[k].image;
              if (data[k].sound) wcAlertSounds[k] = data[k].sound;
            }
          });
          if (wcCurrentWidget === 'alerts') {
            selectAlertEvent(wcActiveAlertEvent || 'follower');
          }
        }
      })
      .catch(() => { });
  }

  // Setup visual controls event listeners for live preview
  document.querySelectorAll('.wc-controls-group input, .wc-controls-group select').forEach(input => {
    const handler = () => {
      const vals = getWidgetValues(wcCurrentWidget);
      updateWidgetPreview(wcCurrentWidget, vals);

      // Update range display value
      if (input.type === 'range') {
        const valEl = document.getElementById(`${input.id}-val`);
        if (valEl) {
          const prop = input.dataset.prop || '';
          const unit = prop.includes('Opacity') ? '%' : 'px';
          valEl.innerText = `${input.value}${unit}`;
        }
      }
    };
    input.addEventListener('input', handler);
    input.addEventListener('change', handler);
  });

  // Load initial widget
  selectCustomizeWidget('alerts');
}

// Initialize widget customization & reward autocomplete when initial data is loaded
const _origLoadInitialData = loadInitialData;
loadInitialData = async function () {
  await _origLoadInitialData();
  initWidgetCustomization();
  if (typeof setupRewardAutocomplete === 'function') {
    setupRewardAutocomplete();
  }
};

// ================= ADMINISTRACIÓN GENERAL & MODO ASISTENCIA =================
const KNOWN_SUPERADMINS = [
  'francisco.jm.aguilar@gmail.com',
  'bersek',
  'bersek___',
  'bersek3'
];
let isUserSuperAdmin = false;
let adminStreamersCache = [];
let adminTargetStreamerId = null;
let adminOriginalConfig = null;
let adminOriginalCommands = null;
let adminOriginalRewards = null;
let adminOriginalTTS = null;
let adminOriginalGoals = null;
let adminOriginalSongRequest = null;

// 1. checkAdminStatus()
async function checkAdminStatus() {
  const isLocalHost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const session = getUserSession();
  const cleanEmail = (session?.email || '').trim().toLowerCase();
  const cleanUsername = (session?.username || '').trim().toLowerCase();
  const twitchChan = (appConfig?.twitch?.channel || '').toLowerCase().replace(/^#/, '').trim();
  const kickChan = (appConfig?.kick?.channel || appConfig?.kick?.username || '').toLowerCase().replace(/^@/, '').trim();

  // 1. Verificación inmediata de Superadministradores conocidos por correo, usuario o canal
  if (
    (cleanEmail && (KNOWN_SUPERADMINS.includes(cleanEmail) || cleanEmail.includes('francisco.jm.aguilar'))) ||
    (cleanUsername && KNOWN_SUPERADMINS.includes(cleanUsername)) ||
    (twitchChan && KNOWN_SUPERADMINS.includes(twitchChan)) ||
    (kickChan && KNOWN_SUPERADMINS.includes(kickChan))
  ) {
    isUserSuperAdmin = true;
    updateAdminUIElements(true);
    return;
  }

  // 2. Consulta al backend vía API
  try {
    const res = await fetch('/api/admin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail || twitchChan || kickChan || 'admin', userId: session?.id || 'admin' })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.isAdmin) {
        isUserSuperAdmin = true;
        updateAdminUIElements(true);
        return;
      }
    }
  } catch (e) { }

  // 3. Consulta directa a Supabase (Fallback para GitHub Pages y Supabase Auth)
  if (supabaseClient) {
    try {
      if (cleanEmail) {
        const { data, error } = await supabaseClient
          .from('orbibot_admins')
          .select('*')
          .eq('email', cleanEmail)
          .maybeSingle();
        if (!error && data && data.role === 'superadmin') {
          isUserSuperAdmin = true;
          updateAdminUIElements(true);
          return;
        }
      }

      // Consulta por ID o canal
      const searchId = session?.id || twitchChan || kickChan;
      if (searchId) {
        const { data } = await supabaseClient
          .from('orbibot_admins')
          .select('*')
          .eq('email', searchId)
          .maybeSingle();
        if (data && data.role === 'superadmin') {
          isUserSuperAdmin = true;
          updateAdminUIElements(true);
          return;
        }
      }
    } catch (e) { }
  }

  // 4. Si se está ejecutando localmente en la máquina del creador (localhost)
  if (isLocalHost) {
    isUserSuperAdmin = true;
    updateAdminUIElements(true);
    return;
  }

  isUserSuperAdmin = false;
  updateAdminUIElements(false);
}

// 2. updateAdminUIElements()
function updateAdminUIElements(isAdmin) {
  const adminNavItem = document.getElementById('navItemAdmin') || document.getElementById('adminNavItem');
  const adminSection = document.getElementById('tab-admin');
  const superAdminBadge = document.getElementById('adminSuperBadge') || document.getElementById('superAdminBadge');

  if (adminNavItem) {
    adminNavItem.style.display = isAdmin ? 'flex' : 'none';
  }
  if (superAdminBadge) {
    superAdminBadge.style.display = isAdmin ? 'inline-flex' : 'none';
  }
  if (!isAdmin && adminSection && adminSection.classList.contains('active')) {
    switchTab('tab-dashboard');
  }

  if (isAdmin) {
    loadStreamersSupportList();
    loadAdminsList();
  }
}

// 3. loadStreamersSupportList()
async function loadStreamersSupportList() {
  const container = document.getElementById('adminStreamersListContainer');
  if (!container) return;
  if (!isUserSuperAdmin) return;
  const session = getUserSession();
  const userEmail = session?.email || 'francisco.jm.aguilar@gmail.com';
  const userId = session?.id || 'admin';

  container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Cargando lista de streamers registrados...</div>';

  // 1. Consulta al backend vía API
  try {
    const res = await fetch(`/api/admin/streamers?email=${encodeURIComponent(userEmail)}&userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.streamers) && data.streamers.length > 0) {
        adminStreamersCache = data.streamers;
        renderAdminStreamersList(adminStreamersCache);
        return;
      }
    }
  } catch (e) { }

  // 2. Fallback directo a Supabase orbibot_settings con unificación inteligente (GitHub Pages)
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('orbibot_settings')
        .select('*');

      if (!error && data && data.length > 0) {
        const rawMap = new Map();

        data.forEach(row => {
          const sId = row.streamer_id;
          if (!sId || sId === 'system' || sId === 'global' || sId === 'default') return;

          if (!rawMap.has(sId)) {
            rawMap.set(sId, {
              id: sId,
              tokens: new Set(),
              emails: new Set(sId.includes('@') ? [sId.toLowerCase()] : []),
              twitches: new Set(!sId.includes('@') && !sId.includes('-') ? [sId.toLowerCase()] : []),
              kicks: new Set(),
              displayNames: new Set(),
              updatedAt: new Date(0).toISOString()
            });
          }

          const st = rawMap.get(sId);
          let val = row.value;
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch(e) {}
          }

          if (row.updated_at && new Date(row.updated_at) > new Date(st.updatedAt)) {
            st.updatedAt = row.updated_at;
          }

          if (row.key === 'widget_token' && typeof val === 'string') {
            st.tokens.add(val);
          }
          if (val?.widgetToken || val?.security?.widgetToken) {
            st.tokens.add(val.widgetToken || val.security.widgetToken);
          }

          if (row.key === 'twitch_auth' && val) {
            const ch = val.channel || val.login || val.displayName;
            if (ch) {
              st.twitches.add(ch.toLowerCase());
              if (val.displayName) st.displayNames.add(val.displayName);
            }
          }
          if (row.key === 'config' && val) {
            if (val.twitch?.channel) {
              st.twitches.add(val.twitch.channel.toLowerCase());
              if (val.twitch.displayName) st.displayNames.add(val.twitch.displayName);
            }
            if (val.kick?.channel || val.kick?.username) {
              st.kicks.add((val.kick.channel || val.kick.username).toLowerCase());
            }
          }
          if (row.key === 'kick_auth' && val) {
            const ch = val.channel || val.username;
            if (ch) st.kicks.add(ch.toLowerCase());
          }
        });

        const unifiedGroups = [];
        const visitedIds = new Set();

        for (const [id, st] of rawMap.entries()) {
          if (visitedIds.has(id)) continue;

          const cluster = [st];
          visitedIds.add(id);

          let expanded = true;
          while (expanded) {
            expanded = false;
            for (const [otherId, otherSt] of rawMap.entries()) {
              if (visitedIds.has(otherId)) continue;

              // Comprobación ESTRICTA con strings no vacíos y válidos
              const sharesToken = Array.from(otherSt.tokens).some(t => t && t.length > 5 && cluster.some(c => c.tokens.has(t)));
              const sharesEmail = Array.from(otherSt.emails).some(e => e && e.includes('@') && cluster.some(c => c.emails.has(e)));
              const sharesTwitch = Array.from(otherSt.twitches).some(tw => tw && tw.length > 1 && cluster.some(c => c.twitches.has(tw)));
              const sharesKick = Array.from(otherSt.kicks).some(k => k && k.length > 1 && cluster.some(c => c.kicks.has(k)));

              if (sharesToken || sharesEmail || sharesTwitch || sharesKick) {
                cluster.push(otherSt);
                visitedIds.add(otherId);
                expanded = true;
              }
            }
          }

          const combinedTokens = new Set();
          const combinedEmails = new Set();
          const combinedTwitches = new Set();
          const combinedKicks = new Set();
          const combinedNames = new Set();
          const relatedIds = [];
          let latestUpdate = new Date(0).toISOString();

          cluster.forEach(c => {
            relatedIds.push(c.id);
            c.tokens.forEach(t => { if (t && t.trim()) combinedTokens.add(t.trim()); });
            c.emails.forEach(e => { if (e && e.includes('@')) combinedEmails.add(e.trim().toLowerCase()); });
            c.twitches.forEach(t => { if (t && t.trim()) combinedTwitches.add(t.trim().toLowerCase()); });
            c.kicks.forEach(k => { if (k && k.trim()) combinedKicks.add(k.trim().toLowerCase()); });
            c.displayNames.forEach(n => { if (n && n.trim()) combinedNames.add(n.trim()); });
            if (new Date(c.updatedAt) > new Date(latestUpdate)) latestUpdate = c.updatedAt;
          });

          const twitchList = Array.from(combinedTwitches);
          const kickList = Array.from(combinedKicks);
          const emailList = Array.from(combinedEmails);
          const namesList = Array.from(combinedNames);

          const primaryTwitch = twitchList[0] || '';
          const primaryKick = kickList[0] || '';
          const primaryEmail = emailList[0] || '';

          const primaryId = primaryTwitch || primaryKick || primaryEmail || relatedIds.find(rid => !rid.includes('-')) || relatedIds[0];
          const displayName = namesList[0] || primaryTwitch || primaryKick || (primaryEmail ? primaryEmail.split('@')[0] : primaryId);

          const channels = [];
          twitchList.forEach(t => channels.push(`twitch: ${t}`));
          kickList.forEach(k => channels.push(`kick: ${k}`));

          unifiedGroups.push({
            streamerId: primaryId,
            displayName: displayName,
            email: primaryEmail,
            twitchChannel: primaryTwitch,
            kickChannel: primaryKick,
            channels: channels,
            widgetToken: Array.from(combinedTokens)[0] || '',
            updatedAt: latestUpdate,
            relatedIds: relatedIds
          });
        }

        adminStreamersCache = unifiedGroups.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        renderAdminStreamersList(adminStreamersCache);
        return;
      }
    } catch (e) { }
  }

  container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">No se encontraron streamers registrados aún o no hay conexión con la base de datos.</div>';
}

// 4. renderAdminStreamersList()
function renderAdminStreamersList(streamers) {
  const container = document.getElementById('adminStreamersListContainer');
  const countBadge = document.getElementById('adminStreamersCountBadge');
  const totalStat = document.getElementById('adminStatTotalStreamers');
  const twitchStat = document.getElementById('adminStatTwitchCount');
  const kickStat = document.getElementById('adminStatKickCount');

  if (!container) return;
  if (!Array.isArray(streamers)) streamers = [];

  if (countBadge) countBadge.textContent = `${streamers.length} streamer${streamers.length === 1 ? '' : 's'}`;
  if (totalStat) totalStat.textContent = streamers.length;

  let twitchCount = 0;
  let kickCount = 0;
  streamers.forEach(s => {
    const hasTwitch = s.twitchChannel || (Array.isArray(s.channels) && s.channels.some(c => c.startsWith('twitch:')));
    const hasKick = s.kickChannel || (Array.isArray(s.channels) && s.channels.some(c => c.startsWith('kick:')));
    if (hasTwitch) twitchCount++;
    if (hasKick) kickCount++;
  });
  if (twitchStat) twitchStat.textContent = twitchCount;
  if (kickStat) kickStat.textContent = kickCount;

  if (streamers.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">👥</div>
        <div style="font-weight: 700; color: var(--text-secondary);">No se encontraron streamers en la base de datos</div>
        <div style="font-size: 12px; margin-top: 4px;">Cuando los streamers se registren o vinculen canales aparecerán listados aquí.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="overflow-x: auto;">
      <table class="custom-table" style="width: 100%;">
        <thead>
          <tr>
            <th>Streamer / ID</th>
            <th>Canales Vinculados</th>
            <th>Última Actividad</th>
            <th style="text-align: right;">Acciones de Soporte</th>
          </tr>
        </thead>
        <tbody>
          ${streamers.map(s => {
            const displayName = s.displayName || s.streamerId || 'Usuario';
            const twitch = s.twitchChannel || (Array.isArray(s.channels) && s.channels.find(c => c.startsWith('twitch:'))?.split(':')[1]?.trim()) || '';
            const kick = s.kickChannel || (Array.isArray(s.channels) && s.channels.find(c => c.startsWith('kick:'))?.split(':')[1]?.trim()) || '';
            const email = s.email || (s.streamerId && s.streamerId.includes('@') ? s.streamerId : '');

            const badges = [];
            if (twitch) {
              badges.push(`<span style="display: inline-flex; align-items: center; gap: 5px; background: rgba(145, 70, 255, 0.18); border: 1px solid rgba(145, 70, 255, 0.45); color: #c4b5fd; padding: 3px 9px; border-radius: 6px; font-weight: 700; font-size: 12px;"><i class="fab fa-twitch" style="color:#a78bfa;"></i> @${escapeHtml(twitch)}</span>`);
            }
            if (kick) {
              badges.push(`<span style="display: inline-flex; align-items: center; gap: 5px; background: rgba(83, 252, 24, 0.15); border: 1px solid rgba(83, 252, 24, 0.45); color: #86efac; padding: 3px 9px; border-radius: 6px; font-weight: 700; font-size: 12px;"><i class="fas fa-bolt" style="color:#53fc18;"></i> @${escapeHtml(kick)}</span>`);
            }
            if (email && email !== twitch && email !== kick) {
              badges.push(`<span style="display: inline-flex; align-items: center; gap: 5px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.14); color: #94a3b8; padding: 3px 8px; border-radius: 6px; font-size: 11px;"><i class="fas fa-envelope"></i> ${escapeHtml(email)}</span>`);
            }

            const channelsStr = badges.length > 0 ? badges.join(' ') : '<span style="color: #64748b; font-size: 12px;">Sin canales vinculados</span>';
            const dateStr = s.updatedAt && s.updatedAt !== new Date(0).toISOString() ? new Date(s.updatedAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'Reciente';

            return `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, rgba(145,70,255,0.3), rgba(0,242,254,0.3)); border: 1px solid rgba(145,70,255,0.45); display: flex; align-items: center; justify-content: center; font-weight: 800; color: #fff; font-size: 13px;">
                      ${(displayName[0] || 'U').toUpperCase()}
                    </div>
                    <div>
                      <div style="font-weight: 700; color: #fff; font-size: 13.5px;">${escapeHtml(displayName)}</div>
                      <div style="font-size: 11px; color: #94a3b8; font-family: monospace;">ID: ${escapeHtml(s.streamerId)}</div>
                    </div>
                  </div>
                </td>
                <td>${channelsStr}</td>
                <td style="font-size: 12px; color: #94a3b8;">${dateStr}</td>
                <td style="text-align: right;">
                  <button class="btn btn-sm" onclick="enterStreamerSupportMode('${escapeHtml(s.streamerId)}', '${escapeHtml(displayName)}')" style="background: linear-gradient(135deg, #7c3aed, #db2777); color: #fff; border: none; font-weight: 700; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 2px 8px rgba(124,58,237,0.35);">
                    <i class="fas fa-tools"></i> Asistir / Ver Config
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// 4.1 filterAdminStreamersList(query)
function filterAdminStreamersList(query) {
  if (!query || !query.trim()) {
    renderAdminStreamersList(adminStreamersCache);
    return;
  }
  const q = query.trim().toLowerCase();
  const filtered = adminStreamersCache.filter(s => {
    return (s.streamerId && s.streamerId.toLowerCase().includes(q)) ||
           (s.displayName && s.displayName.toLowerCase().includes(q)) ||
           (s.email && s.email.toLowerCase().includes(q)) ||
           (s.twitchChannel && s.twitchChannel.toLowerCase().includes(q)) ||
           (s.kickChannel && s.kickChannel.toLowerCase().includes(q)) ||
           (s.channels && s.channels.some(c => c.toLowerCase().includes(q)));
  });
  renderAdminStreamersList(filtered);
}

// 5. enterStreamerSupportMode()
async function enterStreamerSupportMode(streamerId, displayName) {
  const session = getUserSession();
  if (!session || !isUserSuperAdmin) {
    showToast('Acceso denegado. Se requieren permisos de Super Administrador.', 'error');
    return;
  }

  showToast(`🛡️ Cargando entorno completo de @${displayName || streamerId}...`, 'info');

  let targetCfg = null;
  let targetCmds = [];
  let targetRws = [];
  let targetGls = [];
  let targetTts = [];
  let targetToken = null;
  let targetSongRequest = null;
  let targetTwitchAuth = null;
  let targetKickAuth = null;

  // 1. Consulta al backend vía API
  try {
    const res = await fetch(`/api/admin/streamer/${encodeURIComponent(streamerId)}?email=${encodeURIComponent(session?.email || '')}&userId=${encodeURIComponent(session?.id || '')}`);
    if (res.ok) {
      const resData = await res.json();
      const sData = resData.data || resData;
      if (resData.success && (sData.config || sData.streamerId || sData.commands || sData.channel_points)) {
        targetCfg = sData.config;
        targetCmds = sData.commands || [];
        targetRws = sData.rewards || sData.channel_points || [];
        targetGls = sData.goals || [];
        targetTts = sData.ttsCommands || sData.tts_commands || [];
        targetToken = sData.widget_token || sData.widgetToken || null;
        targetSongRequest = sData.songRequest || sData.sr_state || null;
        targetTwitchAuth = sData.twitch_auth || null;
        targetKickAuth = sData.kick_auth || null;
      }
    }
  } catch (e) { }

  // 2. Fallback directo a Supabase orbibot_settings con búsqueda de cuentas relacionadas
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('orbibot_settings')
        .select('*');

      if (!error && data && data.length > 0) {
        // Encontrar token o email de la cuenta si existe
        let discoveredToken = targetToken;
        data.forEach(item => {
          if (item.streamer_id === streamerId) {
            let val = item.value;
            if (typeof val === 'string') {
              try { val = JSON.parse(val); } catch(e) {}
            }
            if (item.key === 'widget_token' && typeof val === 'string') discoveredToken = val;
            if (val?.widgetToken) discoveredToken = val.widgetToken;
            if (val?.security?.widgetToken) discoveredToken = val.security.widgetToken;
          }
        });

        data.forEach(item => {
          let val = item.value;
          if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch(e) {}
          }

          const itemToken = item.key === 'widget_token' ? val : (val?.widgetToken || val?.security?.widgetToken);
          const isDirectMatch = item.streamer_id === streamerId;
          const isTokenMatch = discoveredToken && itemToken && itemToken === discoveredToken;

          if (isDirectMatch || isTokenMatch) {
            if (item.key === 'config' && val) targetCfg = targetCfg ? { ...val, ...targetCfg } : val;
            if (item.key === 'commands' && Array.isArray(val) && val.length > 0) targetCmds = val;
            if (item.key === 'channel_points' && Array.isArray(val) && val.length > 0) targetRws = val;
            if (item.key === 'goals' && Array.isArray(val) && val.length > 0) targetGls = val;
            if (item.key === 'tts_commands' && Array.isArray(val) && val.length > 0) targetTts = val;
            if (item.key === 'widget_token' && val) targetToken = val;
            if (item.key === 'sr_state' && val) targetSongRequest = val;
            if (item.key === 'twitch_auth' && val) targetTwitchAuth = val;
            if (item.key === 'kick_auth' && val) targetKickAuth = val;
          }
        });
      }
    } catch (e) { }
  }

  // Si no había configuración previa, inicializar plantilla limpia para este streamer
  if (!targetCfg) {
    targetCfg = getFreshDefaultConfig();
  }

  // Enriquecer configuración con Twitch / Kick si se encontraron credenciales vinculadas
  if (!targetCfg.twitch) targetCfg.twitch = {};
  if (targetTwitchAuth) {
    targetCfg.twitch.channel = targetTwitchAuth.channel || targetTwitchAuth.login || targetCfg.twitch.channel || streamerId;
    targetCfg.twitch.displayName = targetTwitchAuth.displayName || targetCfg.twitch.displayName || displayName || streamerId;
    targetCfg.twitch.userId = targetTwitchAuth.userId || targetCfg.twitch.userId || '';
    targetCfg.twitch.oauthToken = targetTwitchAuth.oauthToken || targetCfg.twitch.oauthToken || '';
    targetCfg.twitch.clientId = targetTwitchAuth.clientId || targetCfg.twitch.clientId || '';
    targetCfg.twitch.connected = true;
  } else if (!targetCfg.twitch.channel && !streamerId.includes('@')) {
    targetCfg.twitch.channel = streamerId;
    targetCfg.twitch.displayName = displayName || streamerId;
    targetCfg.twitch.connected = true;
  }

  if (targetKickAuth) {
    if (!targetCfg.kick) targetCfg.kick = {};
    targetCfg.kick.channel = targetKickAuth.channel || targetKickAuth.username || targetCfg.kick.channel || '';
    targetCfg.kick.username = targetKickAuth.username || targetCfg.kick.username || '';
    targetCfg.kick.connected = true;
  }

  // Respaldar estado original del Superadmin
  if (!adminOriginalConfig) {
    adminOriginalConfig = JSON.parse(JSON.stringify(appConfig || {}));
    adminOriginalCommands = (typeof cachedCommands !== 'undefined') ? JSON.parse(JSON.stringify(cachedCommands)) : [];
    adminOriginalRewards = (typeof cachedRewards !== 'undefined') ? JSON.parse(JSON.stringify(cachedRewards)) : [];
    adminOriginalTTS = (typeof cachedTTSCommands !== 'undefined') ? JSON.parse(JSON.stringify(cachedTTSCommands)) : [];
    adminOriginalGoals = (typeof appConfig?.goals !== 'undefined') ? JSON.parse(JSON.stringify(appConfig.goals)) : [];
    adminOriginalSongRequest = (typeof currentSrState !== 'undefined' && currentSrState) ? JSON.parse(JSON.stringify(currentSrState)) : null;
  }

  // Activar contexto del streamer asistido
  adminTargetStreamerId = streamerId;
  appConfig = targetCfg;

  if (!appConfig.security) appConfig.security = {};
  if (targetToken) {
    appConfig.security.widgetToken = targetToken;
  } else if (!appConfig.security.widgetToken) {
    appConfig.security.widgetToken = 'sec_' + streamerId.toLowerCase().replace(/[^a-z0-9_]/g, '') + '_tkn';
  }

  // Actualizar banner de asistencia
  const banner = document.getElementById('adminSupportModeBanner');
  const nameEl = document.getElementById('adminTargetStreamerName');
  if (banner) banner.style.display = 'flex';
  if (nameEl) nameEl.textContent = displayName ? `@${displayName} (${streamerId})` : `@${streamerId}`;

  // Renderizar componentes y listas con datos del streamer
  cachedCommands = Array.isArray(targetCmds) ? targetCmds : [];
  if (typeof renderCommands === 'function') renderCommands(cachedCommands);

  cachedRewards = Array.isArray(targetRws) ? targetRws : [];
  if (typeof renderRewards === 'function') renderRewards(cachedRewards);

  const effectiveGoals = Array.isArray(targetGls) ? targetGls : (appConfig?.goals || []);
  if (typeof renderGoals === 'function') renderGoals(effectiveGoals);

  cachedTTSCommands = Array.isArray(targetTts) && targetTts.length > 0 ? targetTts : DEFAULT_TTS_COMMANDS;
  if (typeof renderTTSCommands === 'function') renderTTSCommands(cachedTTSCommands);

  if (targetSongRequest && typeof updateSongRequestUI === 'function') {
    updateSongRequestUI(targetSongRequest, false);
  } else {
    try {
      fetch(`/api/sr/state?channel=${encodeURIComponent(streamerId)}`)
        .then(r => r.json())
        .then(srData => {
          if (srData && typeof updateSongRequestUI === 'function') updateSongRequestUI(srData, false);
        })
        .catch(() => {});
    } catch (e) { }
  }

  bindConfigToUI(appConfig);
  updatePlatformLinkingUI();
  updateWidgetUrls();
  if (typeof initWidgetCustomization === 'function') initWidgetCustomization();

  switchTab('tab-dashboard');
  showToast(`✅ Modo Asistencia Activo para @${displayName || streamerId}. Viendo el panel y widgets exactamente como el streamer.`, 'success');
}

// 6. saveAdminSupportChanges()
async function saveAdminSupportChanges() {
  if (!adminTargetStreamerId) {
    showToast('No estás en modo asistencia activo.', 'warn');
    return;
  }
  const session = getUserSession();
  if (!session || !isUserSuperAdmin) return;

  showToast('💾 Guardando cambios para el streamer...', 'info');

  const payload = {
    email: session.email,
    userId: session.id,
    config: appConfig,
    commands: (typeof cachedCommands !== 'undefined') ? cachedCommands : [],
    rewards: (typeof cachedRewards !== 'undefined') ? cachedRewards : [],
    goals: (typeof appConfig?.goals !== 'undefined') ? appConfig.goals : [],
    ttsCommands: (typeof cachedTTSCommands !== 'undefined') ? cachedTTSCommands : [],
    widget_token: appConfig?.security?.widgetToken || getEffectiveWidgetToken(),
    sr_state: (typeof currentSrState !== 'undefined') ? currentSrState : null
  };

  try {
    const res = await fetch(`/api/admin/streamer/${encodeURIComponent(adminTargetStreamerId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast('🎉 ¡Configuración del streamer actualizada y guardada con éxito en la base de datos!', 'success');
        return;
      }
    }
  } catch (e) { }

  // Fallback directo a Supabase orbibot_settings (GitHub Pages)
  if (supabaseClient) {
    try {
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'config', value: payload.config });
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'commands', value: payload.commands });
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'channel_points', value: payload.rewards });
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'goals', value: payload.goals });
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'tts_commands', value: payload.ttsCommands });
      await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'widget_token', value: payload.widget_token });
      if (payload.sr_state) {
        await supabaseClient.from('orbibot_settings').upsert({ streamer_id: adminTargetStreamerId, key: 'sr_state', value: payload.sr_state });
      }

      showToast('🎉 ¡Configuración guardada directamente en Supabase para el streamer!', 'success');
      return;
    } catch (e) { }
  }

  showToast('Error al guardar cambios para el streamer en el servidor.', 'error');
}

// 7. exitAdminSupportMode()
function exitAdminSupportMode() {
  if (!adminTargetStreamerId) return;

  if (adminOriginalConfig) {
    appConfig = adminOriginalConfig;
    adminOriginalConfig = null;
  }
  if (adminOriginalCommands !== null) {
    cachedCommands = adminOriginalCommands;
    if (typeof renderCommands === 'function') renderCommands(cachedCommands);
    adminOriginalCommands = null;
  }
  if (typeof adminOriginalRewards !== 'undefined' && adminOriginalRewards) {
    cachedRewards = adminOriginalRewards;
    if (typeof renderRewards === 'function') renderRewards(cachedRewards);
    adminOriginalRewards = null;
  }
  if (typeof adminOriginalTTS !== 'undefined' && adminOriginalTTS) {
    cachedTTSCommands = adminOriginalTTS;
    if (typeof renderTTSCommands === 'function') renderTTSCommands(cachedTTSCommands);
    adminOriginalTTS = null;
  }

  adminTargetStreamerId = null;

  const banner = document.getElementById('adminSupportModeBanner');
  if (banner) banner.style.display = 'none';

  switchTab('tab-admin');
  showToast('Has salido del Modo Asistencia. Volviste a tu panel de Administrador.', 'info');
}

// 8. handleAdminManualStreamerSupport()
function handleAdminManualStreamerSupport() {
  const input = document.getElementById('adminStreamerSearchInput');
  const targetId = input ? input.value.trim() : '';
  if (!targetId) {
    showToast('Escribe el ID o usuario del streamer que deseas asistir.', 'warn');
    if (input) input.focus();
    return;
  }
  enterStreamerSupportMode(targetId, targetId);
}

// 9. Gestor de Administradores (loadAdminsList, handleAddNewAdmin, handleRemoveAdmin)
async function loadAdminsList() {
  const container = document.getElementById('adminListContainer');
  if (!container) return;
  if (!isUserSuperAdmin) return;
  const session = getUserSession();
  const userEmail = session?.email || 'francisco.jm.aguilar@gmail.com';
  const userId = session?.id || 'admin';

  try {
    const res = await fetch('/api/admin/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, userId: userId })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.admins)) {
        renderAdminsList(data.admins);
        return;
      }
    }
  } catch (e) { }

  // Supabase fallback (orbibot_settings key="admins")
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('orbibot_settings')
        .select('value')
        .eq('streamer_id', 'global')
        .eq('key', 'admins')
        .maybeSingle();

      if (!error && data && Array.isArray(data.value)) {
        renderAdminsList(data.value);
        return;
      }
    } catch (e) { }
  }

  // Known fallback list
  renderAdminsList(KNOWN_SUPERADMINS.map(email => ({ email, role: 'superadmin', notes: 'Administrador Principal' })));
}

function renderAdminsList(admins) {
  const container = document.getElementById('adminListContainer');
  if (!container) return;
  if (!Array.isArray(admins) || admins.length === 0) {
    container.innerHTML = `
      <div style="font-size: 13px; color: #94a3b8; padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px;">
        No hay administradores adicionales configurados en base de datos.
      </div>
    `;
    return;
  }

  container.innerHTML = admins.map(a => {
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: #facc15; font-size: 16px;">🛡️</span>
          <div>
            <strong style="color: #fff; font-size: 13px;">${escapeHtml(a.email || a.user_id || 'Admin')}</strong>
            <span style="font-size: 11.5px; color: #94a3b8; margin-left: 8px;">(${escapeHtml(a.notes || a.role || 'Superadmin')})</span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="handleRemoveAdmin('${escapeHtml(a.email || a.user_id)}')" style="padding: 4px 10px; font-size: 11px;">
          <i class="fas fa-trash-alt"></i> Quitar
        </button>
      </div>
    `;
  }).join('');
}

async function handleAddNewAdmin() {
  const emailInput = document.getElementById('adminNewEmailInput');
  const notesInput = document.getElementById('adminNewNotesInput');
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const notes = notesInput ? notesInput.value.trim() : 'Soporte';

  if (!email || !email.includes('@')) {
    showToast('Ingresa un correo electrónico válido para el nuevo administrador.', 'warn');
    if (emailInput) emailInput.focus();
    return;
  }

  const session = getUserSession();
  if (!session || !isUserSuperAdmin) return;

  const newAdminObj = { email, role: 'superadmin', notes, created_at: new Date().toISOString() };

  try {
    const res = await fetch('/api/admin/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: session.email, userId: session.id, newEmail: email, role: 'superadmin', notes })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Administrador ${email} añadido correctamente.`, 'success');
        if (emailInput) emailInput.value = '';
        if (notesInput) notesInput.value = '';
        loadAdminsList();
        return;
      }
    }
  } catch (e) { }

  // Supabase fallback (orbibot_settings)
  if (supabaseClient) {
    try {
      const { data: cur } = await supabaseClient
        .from('orbibot_settings')
        .select('value')
        .eq('streamer_id', 'global')
        .eq('key', 'admins')
        .maybeSingle();

      let currentList = (cur && Array.isArray(cur.value)) ? cur.value : [];
      if (!currentList.some(a => a.email?.toLowerCase() === email)) {
        currentList.push(newAdminObj);
      }
      await supabaseClient.from('orbibot_settings').upsert({
        streamer_id: 'global',
        key: 'admins',
        value: currentList
      });

      showToast(`✅ Administrador ${email} guardado en Supabase.`, 'success');
      if (emailInput) emailInput.value = '';
      if (notesInput) notesInput.value = '';
      loadAdminsList();
      return;
    } catch (e) { }
  }

  showToast('Error al añadir administrador.', 'error');
}

async function handleRemoveAdmin(adminEmail) {
  if (!adminEmail) return;
  const cleanTarget = adminEmail.trim().toLowerCase();
  if (!confirm(`¿Estás seguro de revocar permisos de administrador a ${cleanTarget}?`)) return;

  const session = getUserSession();
  if (!session || !isUserSuperAdmin) return;

  try {
    const res = await fetch('/api/admin/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: session.email, userId: session.id, targetEmail: cleanTarget })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast(`Admin ${cleanTarget} revocado.`, 'info');
        loadAdminsList();
        return;
      }
    }
  } catch (e) { }

  // Supabase fallback
  if (supabaseClient) {
    try {
      const { data: cur } = await supabaseClient
        .from('orbibot_settings')
        .select('value')
        .eq('streamer_id', 'global')
        .eq('key', 'admins')
        .maybeSingle();

      let currentList = (cur && Array.isArray(cur.value)) ? cur.value : [];
      currentList = currentList.filter(a => a.email?.toLowerCase() !== cleanTarget);
      await supabaseClient.from('orbibot_settings').upsert({
        streamer_id: 'global',
        key: 'admins',
        value: currentList
      });

      showToast(`Admin ${cleanTarget} revocado en Supabase.`, 'info');
      loadAdminsList();
      return;
    } catch (e) { }
  }

  showToast('Error al revocar administrador.', 'error');
}

// 10. Master Chat TTS Toggle
function handleTtsGlobalChatToggle(enabled) {
  if (!appConfig) appConfig = {};
  if (!appConfig.tts) appConfig.tts = {};

  appConfig.tts.enabled = Boolean(enabled);
  appConfig.tts.allowChatCommand = Boolean(enabled);

  // Sincronizar checkboxes y etiquetas en UI
  const masterBadge = document.getElementById('ttsMasterStatusBadge');
  const masterLabel = document.getElementById('ttsMasterToggleLabel');
  const masterCheck = document.getElementById('toggleTtsMasterChat');
  const cfgAllow = document.getElementById('cfgTtsAllowCommand');
  const cfgEnabled = document.getElementById('cfgTtsEnabled');

  if (masterCheck) masterCheck.checked = enabled;
  if (cfgAllow) cfgAllow.checked = enabled;
  if (cfgEnabled) cfgEnabled.checked = enabled;

  if (masterBadge) {
    if (enabled) {
      masterBadge.textContent = 'ACTIVO EN CHAT';
      masterBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      masterBadge.style.color = '#10b981';
      masterBadge.style.border = '1px solid rgba(16, 185, 129, 0.4)';
    } else {
      masterBadge.textContent = 'DESACTIVADO EN CHAT';
      masterBadge.style.background = 'rgba(239, 68, 68, 0.2)';
      masterBadge.style.color = '#ef4444';
      masterBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    }
  }

  if (masterLabel) {
    masterLabel.textContent = enabled ? 'TTS Habilitado' : 'TTS Silenciado';
  }

  // Guardar en almacenamiento local y nube
  try {
    localStorage.setItem('orbibot_config', JSON.stringify(appConfig));
  } catch (e) { }

  if (typeof saveToAllSupabaseScopes === 'function') {
    saveToAllSupabaseScopes('config', appConfig).catch(() => {});
  }

  broadcastEvent('config_updated', appConfig);
  showToast(enabled ? '🎙️ TTS activado para el chat (!tts, !messi, etc.)' : '🔇 TTS desactivado en general para el chat', enabled ? 'success' : 'warn');
}

// Export admin and TTS master functions to window
window.checkAdminStatus = checkAdminStatus;
window.loadStreamersSupportList = loadStreamersSupportList;
window.loadAdminStreamersList = loadStreamersSupportList;
window.renderAdminStreamersList = renderAdminStreamersList;
window.filterAdminStreamersList = filterAdminStreamersList;
window.enterStreamerSupportMode = enterStreamerSupportMode;
window.saveAdminSupportChanges = saveAdminSupportChanges;
window.exitAdminSupportMode = exitAdminSupportMode;
window.handleAdminManualStreamerSupport = handleAdminManualStreamerSupport;
window.loadAdminsList = loadAdminsList;
window.renderAdminsList = renderAdminsList;
window.handleAddNewAdmin = handleAddNewAdmin;
window.handleRemoveAdmin = handleRemoveAdmin;
window.handleTtsGlobalChatToggle = handleTtsGlobalChatToggle;

// Alias de compatibilidad
function loadAdminStreamersList(force) {
  return loadStreamersSupportList();
}




