(() => {
  const blocked = /twitch|google/i;
  const removeBlockedEntries = () => {
    document.querySelectorAll('button,a,[role="button"],option').forEach((node) => {
      const signal = `${node.id} ${node.className} ${node.getAttribute('onclick') || ''} ${node.textContent || ''}`;
      if (blocked.test(signal)) node.remove();
    });
    document.title = 'OrbyxBot — Kick';
  };
  document.addEventListener('DOMContentLoaded', () => {
    const refreshKickPanel = async () => {
      const saved = localStorage.getItem('orbibot_kick_auth');
      let kick = null;
      try { kick = saved ? JSON.parse(saved) : null; } catch (_) {}
      const channel = (kick?.channel || kick?.username || '').replace(/^@/, '');
      const connectedView = document.getElementById('dashKickConnectedView');
      const disconnectedView = document.getElementById('dashKickDisconnectedView');
      const name = document.getElementById('dashKickChannelName');
      const avatar = document.getElementById('dashKickAvatar');
      const statusText = document.getElementById('dashKickStatusText');
      const badge = document.getElementById('dashKickStatusBadge');
      if (channel) {
        if (connectedView) connectedView.style.display = 'flex';
        if (disconnectedView) disconnectedView.style.display = 'none';
        if (name) name.textContent = `@${channel}`;
        if (avatar && kick?.profile_picture) { avatar.src = kick.profile_picture; avatar.style.display = 'block'; }
      }
      try {
        const response = await fetch('/api/status');
        const state = await response.json();
        const live = state.kickBot?.status === 'connected';
        const chatNotice = document.getElementById('chatStatusNotice');
        if (statusText) statusText.textContent = live ? `Chat en vivo: @${channel}` : (channel ? 'Reconectando al chat…' : 'Inicia sesión con Kick');
        if (badge) { badge.textContent = live ? '● Conectado' : '● Conectando'; badge.style.color = live ? '#53fc18' : '#facc15'; }
        if (chatNotice) chatNotice.textContent = live ? `● En vivo en Kick @${channel}` : 'Conectando con el chat de Kick…';
      } catch (_) {}
    };
    // Keep OAuth in this tab. A popup returning through 127.0.0.1 cannot
    // share localStorage with a dashboard opened as localhost.
    window.triggerKickOAuthLogin = () => window.location.assign('/api/auth/kick/login');
    const originalKickSuccess = window.handleKickAuthSuccess;
    if (typeof originalKickSuccess === 'function') {
      window.handleKickAuthSuccess = async (payload) => {
        await originalKickSuccess(payload);
        window.showDashboardView?.('tab-dashboard');
        window.switchTab?.('tab-dashboard');
      };
    }
    const startKickLogin = () => {
      if (typeof window.triggerKickOAuthLogin === 'function') {
        window.triggerKickOAuthLogin();
      } else {
        window.location.assign('/api/auth/kick/login');
      }
    };
    const landingActions = document.querySelector('.landing-platform-buttons');
    if (landingActions) {
      landingActions.replaceChildren();
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-platform';
      button.style.cssText = 'background:#53fc18;color:#071009;border-color:#53fc18;font-weight:800;';
      button.textContent = 'Iniciar sesión con Kick';
      button.addEventListener('click', startKickLogin);
      landingActions.append(button);
    }
    const heroPlatform = document.querySelector('.hero-title-gradient');
    if (heroPlatform) heroPlatform.textContent = 'de Kick';
    document.querySelector('.platform-linking-container h3 span:last-child')?.replaceChildren('Canal de Kick');
    const linkingDescription = document.querySelector('.platform-linking-container p');
    if (linkingDescription) linkingDescription.textContent = 'Tu cuenta de Kick controla el chat, alertas, TTS y widgets de OBS.';
    const multiChatText = document.getElementById('multiChatText');
    if (multiChatText) multiChatText.textContent = 'Chat de Kick activo';
    const chatTitle = document.querySelector('#liveChatMessages')?.closest('.card')?.querySelector('.card-title');
    if (chatTitle) chatTitle.textContent = '💬 Chat de Kick en vivo';
    const chatPlaceholder = document.querySelector('#liveChatMessages .chat-msg-row em');
    if (chatPlaceholder) chatPlaceholder.textContent = 'Inicia sesión con Kick para recibir mensajes en tiempo real.';
    document.querySelector('#authModal')?.remove();
    const savedKick = localStorage.getItem('orbibot_kick_auth');
    if (savedKick) {
      try {
        const kick = JSON.parse(savedKick);
        const channel = (kick.channel || kick.username || '').toLowerCase();
        if (channel && !localStorage.getItem('orbibot_user_session')) {
          window.setUserSession?.({
            id: `kick:${kick.userId || channel}`,
            email: `kick:${channel}`,
            username: kick.username || channel,
            avatar: kick.profile_picture || '',
            provider: 'kick',
            loggedInAt: Date.now()
          });
        }
      } catch (_) {}
      window.showDashboardView?.('tab-dashboard');
      window.switchTab?.('tab-dashboard');
    }
    refreshKickPanel();
    setInterval(refreshKickPanel, 8000);
    removeBlockedEntries();
    new MutationObserver(removeBlockedEntries).observe(document.body, { childList: true, subtree: true });
    window.signInWithGoogle = startKickLogin;
    window.openAuthModal = startKickLogin;
  });
  window.triggerTwitchOAuthLogin = () => {};
})();
