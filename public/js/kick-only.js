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
    removeBlockedEntries();
    new MutationObserver(removeBlockedEntries).observe(document.body, { childList: true, subtree: true });
  });
  window.triggerTwitchOAuthLogin = () => {};
  window.signInWithGoogle = () => {};
})();
