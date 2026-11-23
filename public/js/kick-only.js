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
    removeBlockedEntries();
    new MutationObserver(removeBlockedEntries).observe(document.body, { childList: true, subtree: true });
    window.signInWithGoogle = startKickLogin;
    window.openAuthModal = startKickLogin;
  });
  window.triggerTwitchOAuthLogin = () => {};
})();
