(() => {
  const container = document.querySelector('.hero-art');
  const config = window.STARCAMP_HERO_VIDEO;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!container || !config?.src?.trim() || reduceMotion || navigator.connection?.saveData) return;

  const projectHost = 'fjjnmksglgepvxvhxpoc.supabase.co';
  function trustedUrl(value) {
    if (!value?.trim()) return null;
    try {
      const url = new URL(value, window.location.href);
      const sameSite = url.origin === window.location.origin;
      const projectStorage = url.protocol === 'https:' && url.hostname === projectHost;
      return sameSite || projectStorage ? url.href : null;
    } catch {
      return null;
    }
  }

  const source = trustedUrl(config.src);
  if (!source) return;

  const video = document.createElement('video');
  video.className = 'hero-video';
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.controls = false;
  video.disablePictureInPicture = true;
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');

  const poster = trustedUrl(config.poster);
  if (poster) video.poster = poster;

  video.addEventListener('playing', () => {
    container.classList.add('is-video-ready');
    if (config.label?.trim()) container.setAttribute('aria-label', config.label.trim());
    const caption = container.querySelector('.art-coordinate');
    if (caption && config.caption?.trim()) caption.textContent = config.caption.trim();
  }, { once: true });

  video.addEventListener('error', () => {
    container.classList.remove('is-video-ready');
    video.remove();
  }, { once: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) video.pause();
    else video.play().catch(() => {});
  });

  container.prepend(video);
  video.src = source;
  video.play().catch(() => {});
})();
