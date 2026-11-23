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
    removeBlockedEntries();
    new MutationObserver(removeBlockedEntries).observe(document.body, { childList: true, subtree: true });
    window.signInWithGoogle = startKickLogin;
    window.openAuthModal = startKickLogin;
  });
  window.triggerTwitchOAuthLogin = () => {};
})();
