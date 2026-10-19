// The demo clip costs nothing until it is needed: preload="none" and a poster image keep it out of the
// first page load, and it only downloads and plays while it is on screen. With reduced motion the poster stays.
(() => {
  if (!('IntersectionObserver' in window)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const arabic = document.documentElement.lang === 'ar';
  const labels = arabic
    ? { pause: 'إيقاف العرض مؤقتًا', play: 'تشغيل العرض' }
    : { pause: 'Pause the demo', play: 'Play the demo' };

  // Every clip on the page (the tour under the hero and the release video) works the same way.
  const setUp = (figure) => {
    const video = figure.querySelector('.demo-video');
    const toggle = figure.querySelector('.demo-toggle');
    if (!video || !toggle) return;
    let pausedByUser = false;

    const show = (playing) => {
      toggle.classList.toggle('paused', !playing);
      toggle.setAttribute('aria-label', playing ? labels.pause : labels.play);
    };
    const play = () => {
      const started = video.play();
      if (started && started.catch) started.catch(() => show(false));
    };

    video.addEventListener('play', () => show(true));
    video.addEventListener('pause', () => show(false));
    toggle.hidden = false;
    show(false);
    toggle.addEventListener('click', () => {
      pausedByUser = !video.paused;
      if (pausedByUser) video.pause();
      else play();
    });

    new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !pausedByUser) play();
          else if (!entry.isIntersecting && !video.paused) video.pause();
        }
      },
      { threshold: 0.25 }
    ).observe(video);
  };

  // Wait for the page itself to finish loading, so no clip competes with it.
  const watch = () => document.querySelectorAll('.demo-shot').forEach(setUp);
  if (document.readyState === 'complete') watch();
  else window.addEventListener('load', watch, { once: true });
})();
