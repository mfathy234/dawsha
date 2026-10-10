(() => {
  const g = window.gsap;
  const html = document.documentElement;
  if (!g || !window.ScrollTrigger || !window.Lenis) { html.classList.remove('js'); return; }
  g.registerPlugin(ScrollTrigger, DrawSVGPlugin);
  const $ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = 'expo.out';
  const CLEAR = 'transform,opacity,willChange';
  const dd = (el) => (parseFloat(el.style.getPropertyValue('--dd')) || 0) / 1000;

  g.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
    window.__m = 1;
    const nav = $('.nav')[0];
    const idle = [];
    const at = (trigger, onEnter, start = 'top 88%') =>
      ScrollTrigger.create({ trigger, start, once: true, onEnter });

    const lenis = new Lenis({ autoRaf: false });
    const tick = (t) => lenis.raf(t * 1000);
    g.ticker.add(tick);
    g.ticker.lagSmoothing(0);
    lenis.on('scroll', ScrollTrigger.update);
    const onClick = (e) => {
      const a = e.target.closest('a[href^="#"]');
      const el = a && a.hash.length > 1 && document.getElementById(a.hash.slice(1));
      if (!el || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      lenis.scrollTo(el.getBoundingClientRect().top + window.scrollY - 72);
      history.pushState(null, '', a.hash);
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    };
    document.addEventListener('click', onClick);

    ScrollTrigger.create({ trigger: '.hero', start: 'bottom 61px', end: '+=999999', toggleClass: { targets: nav, className: 'scrolled' } });
    nav.classList.add('nav-fx');

    const reveal = (els, o = {}) => {
      els = g.utils.toArray(els);
      g.set(els, { opacity: 0, y: o.y ?? 16 });
      at(o.trigger || els[0], () => g.to(els, { opacity: 1, y: 0, duration: o.dur ?? 0.7, ease: E, stagger: o.stagger || 0, delay: o.delay || 0, clearProps: CLEAR }));
    };

    $('.logo').forEach((logo, k) => {
      g.from(logo, { opacity: 0, scale: 0.8, duration: 0.55, ease: 'back.out(1.4)', delay: 0.1 + k * 0.05, clearProps: CLEAR });
    });
    const copy = $('.hero-copy > :not(.hero-logo)');
    g.set(copy, { opacity: 0, y: 16 });
    g.to(copy, { opacity: 1, y: 0, duration: 0.5, ease: E, stagger: 0.07, delay: 0.3, clearProps: CLEAR });
    g.set('.hero-shot', { opacity: 0, y: 20, scale: 0.98 });
    at('.hero-shot', () => g.to('.hero-shot', { opacity: 1, y: 0, scale: 1, duration: 0.8, ease: E, delay: 0.5, clearProps: CLEAR }), 'top 92%');
    html.classList.remove('js');

    $('section:not(.hero) h2').forEach((h) => reveal(h));
    $('.section-lead').forEach((p) => reveal(p, { y: 12 }));
    $('.showcase .shot').forEach((f, i) => reveal(f, { delay: (i % 2) * 0.09, y: 24 }));
    reveal('.feature-shot', { y: 24 });
    $('.fgroup').forEach((grp, c) => reveal([$('h3', grp)[0], ...$('li', grp)], { trigger: grp, stagger: 0.04, delay: c * 0.1 }));
    reveal('.badges li', { trigger: '.works-row', stagger: 0.08, y: 10 });
    reveal('.dl-card', { trigger: '.dl-grid', stagger: 0.11, y: 24 });

    const st = $('.steps')[0];
    const lis = $('li', st);
    const line = document.createElement('span');
    line.className = 'line';
    line.setAttribute('aria-hidden', 'true');
    st.prepend(line);
    st.classList.add('steps-fx');
    const vert = matchMedia('(max-width: 900px)');
    g.set(line, vert.matches ? { scaleY: 0 } : { scaleX: 0 });
    g.set(lis, { opacity: 0, y: 8 });
    g.set($('.num', st), { scale: 0.8 });
    g.set($('.sico .dr', st), { drawSVG: '0%', opacity: 0 });
    at(st, () => {
      const v = vert.matches;
      const total = v ? st.offsetHeight : st.offsetWidth;
      g.to(line, v ? { scaleY: 1, duration: 0.9, ease: 'none' } : { scaleX: 1, duration: 0.9, ease: 'none' });
      lis.forEach((li) => {
        const d = ((v ? li.offsetTop : li.offsetLeft) / total) * 0.9;
        g.to(li, { opacity: 1, y: 0, duration: 0.5, ease: E, delay: d, clearProps: CLEAR });
        g.to($('.num', li), { scale: 1, duration: 0.4, ease: 'back.out(1.4)', delay: d, clearProps: 'transform' });
        $('.sico .dr', li).forEach((p) => g.to(p, { drawSVG: '100%', opacity: 1, duration: 0.7, ease: 'power2.out', delay: d + 0.2 + dd(p) }));
      });
    }, 'top 80%');

    $('.ill').forEach((ill) => {
      const paths = $('.dr', ill);
      const fds = $('.fd', ill);
      g.set(paths, { drawSVG: '0%', opacity: 0 });
      g.set(fds, { opacity: 0 });
      const tl = g.timeline({ paused: true });
      const mine = [];
      paths.forEach((p) => tl.to(p, { drawSVG: '100%', opacity: 1, duration: 0.9, ease: 'power2.out' }, dd(p)));
      fds.forEach((f) => tl.to(f, { opacity: 1, duration: 0.6, ease: 'power1.out' }, dd(f) || 0.8));
      if (ill.classList.contains('ill-works')) {
        $('.sh', ill).forEach((s, i) => {
          g.set(s, { x: parseFloat(s.style.getPropertyValue('--x')), y: parseFloat(s.style.getPropertyValue('--y')), opacity: 0 });
          tl.to(s, { opacity: 1, duration: 0.5 }, i * 0.18)
            .to(s, { x: 0, duration: 1.6, ease: 'power3.out' }, i * 0.18)
            .to(s, { y: 0, duration: 1.6, ease: 'sine.inOut' }, i * 0.18);
        });
        $('.bob', ill).forEach((b, i) => mine.push(g.to(b, { y: -2.5, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 2 + i * 0.4, paused: true })));
      }
      if (ill.classList.contains('ill-hop')) {
        const lit = $('.lit', ill)[0];
        g.set(lit, { opacity: 0 });
        tl.to(lit, { opacity: 1, duration: 0.3 }, 0.7);
        [{ x: 40 }, { y: 40 }, { x: 0 }, { y: 0 }].forEach((v) => tl.to(lit, { ...v, duration: 0.45, ease: 'power2.inOut' }, '+=0.2'));
      }
      if (ill.classList.contains('ill-lock')) {
        const sh = $('.shk', ill)[0];
        g.set(sh, { y: -3.5 });
        tl.to(sh, { y: 0.6, duration: 0.22, ease: 'power2.in' }, 1.3).to(sh, { y: 0, duration: 0.1 });
      }
      if (ill.classList.contains('ill-desk')) {
        $('.steam', ill).forEach((s, i) => {
          g.set(s, { opacity: 0 });
          mine.push(g.timeline({ repeat: -1, paused: true, delay: 2.4 + i * 2 })
            .fromTo(s, { y: 4, opacity: 0 }, { y: -3, opacity: 0.85, duration: 1.4, ease: 'sine.out' })
            .to(s, { y: -10, opacity: 0, duration: 2.2, ease: 'sine.in' }));
        });
      }
      at(ill, () => tl.play(), 'top 85%');
      ScrollTrigger.create({ trigger: ill, start: 'top bottom', end: 'bottom top', onToggle: (s) => mine.forEach((t) => (s.isActive ? t.play() : t.pause())) });
      idle.push(...mine);
    });

    const code = $('.code code')[0];
    const rows = code.textContent.split('\n').map((t) => {
      const w = document.createElement('span');
      if (t.trim().startsWith('#')) w.className = 'c';
      const chars = [...t].map((ch) => {
        const s = document.createElement('span');
        s.className = 'tc';
        s.textContent = ch;
        w.append(s);
        return s;
      });
      return { w, chars, c: w.className === 'c' };
    });
    code.textContent = '';
    rows.forEach((r, i) => code.append(r.w, i < rows.length - 1 ? '\n' : ''));
    g.set(rows.flatMap((r) => r.chars), { opacity: 0 });
    const cur = document.createElement('span');
    cur.className = 'cur';
    cur.setAttribute('aria-hidden', 'true');
    at('.code', () => {
      const tl = g.timeline();
      let t = 0;
      rows.filter((r) => r.chars.length).forEach((r) => {
        if (r.c) {
          const last = r.chars[r.chars.length - 1];
          tl.set(r.chars, { opacity: 1 }, t).call(() => last.after(cur), null, t);
          t += 0.25;
          return;
        }
        r.chars.forEach((ch) => {
          tl.set(ch, { opacity: 1 }, t).call(() => ch.after(cur), null, t);
          t += 0.028;
        });
        t += 0.25;
      });
      tl.call(() => {
        const blink = g.to(cur, { opacity: 0, duration: 0.01, repeat: -1, repeatDelay: 0.5, yoyo: true });
        g.delayedCall(3, () => { blink.kill(); g.set(cur, { opacity: 1 }); });
      }, null, t);
    }, 'top 80%');

    window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
    return () => {
      document.removeEventListener('click', onClick);
      g.ticker.remove(tick);
      lenis.destroy();
      nav.classList.remove('nav-fx', 'scrolled');
      st.classList.remove('steps-fx');
      line.remove();
      idle.forEach((t) => t.kill());
    };
  });
})();
