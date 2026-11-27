// NUTS — interactions
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined';
  if (hasGsap && typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);
  if (hasGsap) gsap.config({ nullTargetWarn: false }); // pages share this file; not every block exists everywhere

  document.body.classList.add('is-loading');

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (typeof Lenis !== 'undefined' && !reduced) {
    lenis = new Lenis({ lerp: .1, smoothWheel: true });
    if (hasGsap) {
      lenis.on('scroll', ScrollTrigger.update);
      // page height changes after pins/images/accordions — keep Lenis' scroll limit in sync
      ScrollTrigger.addEventListener('refresh', () => lenis.resize());
      gsap.ticker.add(t => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else {
      const raf = t => { lenis.raf(t); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
    }
  }
  const scrollTo = target => lenis ? lenis.scrollTo(target, { offset: 0, duration: 1.4 }) : $(target)?.scrollIntoView({ behavior: 'smooth' });

  $$('a[href^="#"]').forEach(a => a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const el = $(id);
    if (!el) return;
    e.preventDefault();
    if (document.body.classList.contains('menu-open')) setMenu(false);
    scrollTo(el);
  }));

  /* ---------- loader ---------- */
  const loader = $('#loader'), count = $('#loaderCount');
  let n = 0;
  if (!loader) requestAnimationFrame(() => { document.body.classList.remove('is-loading'); heroIn(); });
  const done = () => {
    count.textContent = 100;
    loader.style.transition = 'transform 1s cubic-bezier(.7,0,.2,1) .15s';
    loader.style.transform = 'translateY(-100%)';
    setTimeout(() => loader.remove(), 1300);
    document.body.classList.remove('is-loading');
    heroIn();
  };
  const step = () => {
    n += Math.max(1, Math.round((100 - n) * .08));
    if (n >= 100) return done();
    count.textContent = n;
    setTimeout(step, 28);
  };
  // the counter plays once per visit; later returns to the homepage skip it
  let seen = false;
  try { seen = sessionStorage.getItem('nutsLoaderSeen') === '1'; sessionStorage.setItem('nutsLoaderSeen', '1'); } catch (e) { /* private mode */ }
  if (loader && seen) { loader.remove(); requestAnimationFrame(() => { document.body.classList.remove('is-loading'); heroIn(); }); }
  else if (loader) step();

  // first-screen texts stay hidden (html.intro-wait, set in <head>) until their entrance tweens have set
  // the start state — otherwise the browser paints them, they vanish and fly in again: a visible blink
  const introReady = () => document.documentElement.classList.remove('intro-wait');
  // fonts are font-display: swap — start the entrance only when they are in (max 1.2 s), so the first
  // screen never shows the fallback font and then jumps to the brand one
  let introStarted = false;
  function heroIn() {
    if (introStarted) return;
    introStarted = true;
    const fontsIn = document.fonts && document.fonts.status !== 'loaded' ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]) : Promise.resolve();
    fontsIn.then(heroEntrance);
  }
  function heroEntrance() {
    if (!hasGsap) return introReady();
    if (!$('#hero')) {
      // inner pages
      gsap.from('.page-hero .split', { yPercent: 110, duration: 1.2, ease: 'expo.out', stagger: .1, delay: .1 });
      gsap.from('.page-hero [data-in]', { y: 30, opacity: 0, duration: 1, ease: 'power3.out', stagger: .07, delay: .35 });
      return introReady();
    }
    gsap.from('.hero__line .split', { yPercent: 110, duration: 1.3, ease: 'expo.out', stagger: .12, delay: .35 });
    gsap.from(['.hero__top', '.hero__lead', '.hero__ctas', '.hero__scroll'], { y: 30, opacity: 0, duration: 1, ease: 'power3.out', stagger: .08, delay: .7 });
    gsap.from('.hero__rings i', { scale: .6, opacity: 0, duration: 1.8, ease: 'expo.out', stagger: .1, delay: .4 });
    introReady();
  }

  /* ---------- magnetic buttons ---------- */
  if (finePointer) $$('.magnetic').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${dx * .25}px, ${dy * .35}px)`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.transition = 'transform .6s cubic-bezier(.2,1.6,.4,1)';
      el.style.transform = '';
      setTimeout(() => (el.style.transition = ''), 600);
    });
  });

  /* ---------- header ---------- */
  const header = $('#header');
  let lastY = 0;
  addEventListener('scroll', () => {
    const y = scrollY;
    header.classList.toggle('is-scrolled', y > 40);
    header.classList.toggle('is-hidden', y > lastY && y > 400 && !document.body.classList.contains('menu-open'));
    lastY = y;
  }, { passive: true });
  const burger = $('#burger'), menu = $('#menu');
  menu.inert = true; // closed menu links stay out of the tab order
  const setMenu = open => {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    menu.inert = !open;
    if (lenis) open ? lenis.stop() : lenis.start();
  };
  burger.setAttribute('aria-controls', 'menu');
  burger.setAttribute('aria-expanded', 'false');
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#menu a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setMenu(false); burger.focus(); }
  });

  // active nav link
  const navLinks = $$('#nav a');
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  ['services', 'cases', 'about', 'blog', 'contact'].forEach(id => $('#' + id) && io.observe($('#' + id)));

  /* ---------- manifesto word reveal ---------- */
  $$('.reveal-words').forEach(el => {
    const walk = node => {
      [...node.childNodes].forEach(ch => {
        if (ch.nodeType === 3) {
          const frag = document.createDocumentFragment();
          ch.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) frag.append(part);
            else { const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.append(s); }
          });
          ch.replaceWith(frag);
        } else if (ch.nodeType === 1) walk(ch);
      });
    };
    walk(el);
    const words = $$('.w', el);
    if (hasGsap) {
      ScrollTrigger.create({
        trigger: el, start: 'top 80%', end: 'bottom 45%', scrub: true,
        onUpdate: s => { const k = Math.floor(s.progress * words.length); words.forEach((w, i) => (w.style.opacity = i <= k ? 1 : .14)); },
      });
    } else words.forEach(w => (w.style.opacity = 1));
  });

  /* ---------- generic reveals ---------- */
  if (hasGsap) {
    $$('.h2').forEach(h => gsap.from(h, { y: 60, opacity: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: h, start: 'top 88%' } }));
    gsap.from('.pcard', { y: 200, opacity: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: .1, scrollTrigger: { trigger: '#hand', start: 'top 80%' }, clearProps: 'transform,opacity' });
    $$('.case, .post').forEach(c => gsap.from(c, { y: 80, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: c, start: 'top 92%' } }));
    gsap.from('.svc__item', { y: 40, opacity: 0, duration: .8, stagger: .07, ease: 'power3.out', scrollTrigger: { trigger: '#svc', start: 'top 80%' } });
    gsap.from('.tl', { x: -30, opacity: 0, duration: .8, stagger: .12, ease: 'power3.out', scrollTrigger: { trigger: '.about__timeline', start: 'top 80%' } });
    // scrubbed so the letters are always fully up at the very bottom of the page
    gsap.from('.footer__big span', { yPercent: 100, ease: 'power2.out', stagger: .08, scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'max', scrub: .6, invalidateOnRefresh: true } });
    // section parallax of the giant contact word
    gsap.to('.contact__bg', { xPercent: -20, ease: 'none', scrollTrigger: { trigger: '.contact', start: 'top bottom', end: 'bottom top', scrub: true } });
    // inner pages
    $$('.cover img').forEach(img => gsap.fromTo(img, { yPercent: -8 }, { yPercent: 8, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } }));
    $$('.cover').forEach(c => gsap.from(c, { clipPath: 'inset(12% 8% 12% 8% round 28px)', duration: 1.4, ease: 'expo.out', delay: .3 }));
    $$('.stage__bar').forEach(b => gsap.to(b, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: b.parentElement, start: 'top 85%', end: 'bottom 45%', scrub: true } }));
    $$('.bigstat, .kind, .chapter, .faq__item, .feature, .bigquote, .subscribe').forEach(el => gsap.from(el, { y: 60, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%' } }));
    gsap.from('.stack span', { y: 30, opacity: 0, scale: .8, duration: .6, stagger: .04, ease: 'back.out(2)', scrollTrigger: { trigger: '.stack', start: 'top 85%' } });
    // hero text drifts as nut cracks
    gsap.to('.hero__title', { yPercent: -30, opacity: .2, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  }

  /* ---------- counters ---------- */
  $$('[data-count]').forEach(el => {
    const to = +el.dataset.count, from = to > 1000 ? to - 40 : 0;
    const run = () => {
      if (!hasGsap) return (el.textContent = to);
      const o = { v: from };
      gsap.to(o, { v: to, duration: 2, ease: 'expo.out', onUpdate: () => (el.textContent = Math.round(o.v)) });
    };
    new IntersectionObserver(([en], obs) => { if (en.isIntersecting) { run(); obs.disconnect(); } }, { threshold: .6 }).observe(el);
  });

  /* ---------- poker cards (tap on touch) ---------- */
  $$('.pcard').forEach(c => {
    c.addEventListener('click', () => {
      if (finePointer) return;
      c.classList.toggle('is-open');
    });
    c.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      c.classList.toggle('is-open');
    });
  });

  /* ---------- services accordion ---------- */
  $$('.svc__item').forEach(item => {
    $('.svc__row', item).addEventListener('click', () => {
      const open = item.classList.contains('is-open');
      $$('.svc__item.is-open').forEach(i => i.classList.remove('is-open'));
      if (!open) item.classList.add('is-open');
      setTimeout(() => hasGsap && ScrollTrigger.refresh(), 650);
    });
  });

  /* ---------- case filters ---------- */
  $$('.filter[data-f]').forEach(btn => btn.addEventListener('click', () => {
    $$('.filter[data-f]').forEach(b => b.classList.toggle('is-active', b === btn));
    const f = btn.dataset.f;
    const cards = $$('[data-cat]');
    const apply = () => {
      cards.forEach(c => {
        const show = f === 'all' || c.dataset.cat === f;
        c.classList.toggle('is-hidden', !show);
        c.classList.toggle('case--wide', show && f === 'all' && c.hasAttribute('data-wide'));
      });
      hasGsap && ScrollTrigger.refresh();
    };
    if (hasGsap) {
      gsap.to(cards, { opacity: 0, y: 20, duration: .25, onComplete: () => {
        apply();
        gsap.fromTo(cards.filter(c => !c.classList.contains('is-hidden')), { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: .6, stagger: .05, ease: 'expo.out' });
      } });
    } else apply();
  }));
  $$('.case--wide').forEach(c => c.setAttribute('data-wide', ''));

  /* ---------- process: horizontal scroll ---------- */
  const mm = hasGsap ? gsap.matchMedia() : null;
  mm && $('#processTrack') && mm.add('(min-width: 701px)', () => {
    const track = $('#processTrack');
    const dist = () => track.scrollWidth - innerWidth;
    const tween = gsap.to(track, { x: () => -dist(), ease: 'none' });
    const st = ScrollTrigger.create({
      trigger: '.process', start: 'top top', end: () => '+=' + dist(), pin: '.process__pin',
      animation: tween, scrub: 1, invalidateOnRefresh: true, anticipatePin: 1,
    });
    return () => { st.kill(); tween.kill(); };
  });

  /* ---------- reviews slider ---------- */
  const track = $('#revTrack'), slides = track ? $$('.review', track) : [];
  let idx = 0;
  if (track) {
  const go = d => {
    const vw = track.parentElement.clientWidth;
    const w = slides[0].getBoundingClientRect().width + 20;
    const perView = Math.max(1, Math.floor(vw / w));
    idx = Math.min(Math.max(idx + d, 0), slides.length - perView);
    track.style.transform = `translateX(${-idx * w}px)`;
  };
  $('#revPrev').addEventListener('click', () => go(-1));
  $('#revNext').addEventListener('click', () => go(1));
  // drag / swipe
  let sx = null;
  track.addEventListener('pointerdown', e => (sx = e.clientX));
  addEventListener('pointerup', e => { if (sx === null) return; const dx = e.clientX - sx; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); sx = null; });
  }

  /* ---------- brief form ---------- */
  // Requests go to the agency's own form service «Приёмная» (feedback.nuts-agency.ru): it keeps every request
  // and emails it from no-reply@nuts-agency.ru to info@nuts-agency.ru. The site key only works on the domains
  // listed for it there (nuts-agency.ru, www, nuts.test.devnuts.ru, kvashin23.github.io) — not on localhost.
  const FORM_API = 'https://feedback.nuts-agency.ru/api/submit/';
  const FORM_SITE = 'pk_wHuETewXiBIOH2ey';
  const form = $('form.brief');
  const sendBrief = async () => {
    const fd = new FormData(form);
    const services = fd.getAll('svc').join(', ');
    const contact = fd.get('contact').trim();
    const body = new FormData();
    body.append('site', FORM_SITE);
    body.append('form', 'main');
    body.append('tag', services);
    body.append('page', location.href);
    body.append('company_website', fd.get('_honey') || '');
    body.append('name', fd.get('name').trim());
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) body.append('email', contact);
    else if (/^\+?[\d\s()-]{10,}$/.test(contact)) body.append('phone', contact);
    body.append('contact', contact);
    body.append('services', services || '—');
    body.append('budget', fd.get('budget') || '—');
    body.append('message', (fd.get('msg') || '').trim() || '—');
    const r = await fetch(FORM_API, { method: 'POST', body });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  };
  form && form.addEventListener('submit', async e => {
    e.preventDefault();
    if (form.classList.contains('is-sending')) return;
    let ok = true;
    // contact: a phone (10+ digits), a @telegram nick or an email
    const contactOk = v => /^\+?[\d\s()-]{10,}$/.test(v) && v.replace(/\D/g, '').length >= 10 || /^(@|(https?:\/\/)?t\.me\/)[a-z0-9_]{5,32}$/i.test(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    const rules = { name: v => v.length >= 2, contact: contactOk };
    Object.entries(rules).forEach(([n, test]) => {
      const f = form.elements[n];
      const bad = !test(f.value.trim());
      f.parentElement.classList.toggle('is-error', bad);
      f.setAttribute('aria-invalid', String(bad));
      if (bad) ok = false;
    });
    if (!ok) {
      hasGsap && gsap.fromTo(form, { x: -8 }, { x: 0, duration: .5, ease: 'elastic.out(1.2, .3)' });
      return;
    }
    const btn = form.querySelector('button[type=submit] span');
    const label = btn.textContent;
    const err = form.querySelector('.brief__error');
    form.classList.add('is-sending');
    btn.textContent = 'Отправляем…';
    err.hidden = true;
    try {
      // bots fill the hidden field; pretend success and drop it
      if (!form.elements._honey.value) await sendBrief();
      form.classList.add('is-sent');
      form.reset();
    } catch (ex) {
      console.warn('brief:', ex);
      err.hidden = false;
    } finally {
      form.classList.remove('is-sending');
      btn.textContent = label;
    }
  });

  /* ---------- article: reading progress + table of contents ---------- */
  const bar = $('#readBar'), article = $('.article__body');
  if (bar && article) {
    const upd = () => {
      const r = article.getBoundingClientRect();
      const p = Math.min(Math.max(-r.top / (r.height - innerHeight), 0), 1);
      bar.style.transform = `scaleX(${p})`;
    };
    addEventListener('scroll', upd, { passive: true });
    upd();
    const tocLinks = $$('.toc a');
    const tio = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting) tocLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
    }), { rootMargin: '-20% 0px -70% 0px' });
    $$('h2[id], h3[id]', article).forEach(h => tio.observe(h));
  }

  /* ---------- draggable galleries ---------- */
  $$('.gallery').forEach(g => {
    let down = false, sx = 0, sl = 0, moved = false;
    g.addEventListener('pointerdown', e => { down = true; moved = false; sx = e.clientX; sl = g.scrollLeft; g.classList.add('is-drag'); });
    addEventListener('pointermove', e => { if (!down) return; const dx = e.clientX - sx; if (Math.abs(dx) > 4) moved = true; g.scrollLeft = sl - dx; });
    addEventListener('pointerup', () => { down = false; g.classList.remove('is-drag'); });
    g.addEventListener('click', e => moved && e.preventDefault(), true);
    g.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) return; e.stopPropagation(); }, { passive: true });
  });

  /* ---------- auto-scrolling photo sliders ---------- */
  $$('.autoslider').forEach(box => {
    const track = $('.autoslider__track', box), slides = track.children.length;
    const dots = document.createElement('div');
    dots.className = 'autoslider__dots';
    dots.innerHTML = Array.from({ length: slides }, (_, i) => `<button type="button" aria-label="Фото ${i + 1}"></button>`).join('');
    box.appendChild(dots);
    let i = 0, timer = null;
    const show = n => {
      i = (n + slides) % slides;
      track.style.transform = `translateX(${-i * 100}%)`;
      $$('button', dots).forEach((b, k) => b.classList.toggle('is-active', k === i));
    };
    const play = () => { if (!reduced) { clearInterval(timer); timer = setInterval(() => show(i + 1), 3500); } };
    $$('button', dots).forEach((b, k) => b.addEventListener('click', () => { show(k); play(); }));
    box.addEventListener('pointerenter', () => clearInterval(timer));
    box.addEventListener('pointerleave', play);
    // swipe: touch events on phones (pointer events get cancelled by the browser's own scrolling), pointer drag with a mouse
    let sx = null, sy = null;
    const end = x => { if (sx !== null && Math.abs(x - sx) > 40) { show(i + (x < sx ? 1 : -1)); play(); } sx = sy = null; };
    box.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; clearInterval(timer); }, { passive: true });
    box.addEventListener('touchmove', e => { if (sx !== null && Math.abs(e.touches[0].clientX - sx) > Math.abs(e.touches[0].clientY - sy)) e.preventDefault(); }, { passive: false });
    box.addEventListener('touchend', e => end(e.changedTouches[0].clientX));
    box.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') sx = e.clientX; });
    box.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') end(e.clientX); });
    show(0); play();
  });

  /* ---------- pictures in texts open in a popup ---------- */
  const shots = $$('.prose figure img, .prose > p img');
  if (shots.length) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure><button type="button" class="lightbox__close" aria-label="Закрыть">×</button><button type="button" class="lightbox__nav lightbox__nav--prev" aria-label="Предыдущая">←</button><button type="button" class="lightbox__nav lightbox__nav--next" aria-label="Следующая">→</button>';
    document.body.appendChild(lb);
    const big = $('img', lb), cap = $('figcaption', lb), prev = $('.lightbox__nav--prev', lb), next = $('.lightbox__nav--next', lb);
    let cur = 0, opener = null;
    const show = k => {
      cur = (k + shots.length) % shots.length;
      const img = shots[cur];
      big.src = img.currentSrc || img.src;
      big.alt = img.alt || '';
      const c = img.closest('figure')?.querySelector('figcaption');
      cap.textContent = c ? c.textContent : '';
      cap.hidden = !c;
    };
    const open = k => { opener = document.activeElement; show(k); prev.hidden = next.hidden = shots.length < 2; lb.classList.add('is-open'); lenis && lenis.stop(); $('.lightbox__close', lb).focus(); };
    const close = () => { lb.classList.remove('is-open'); lenis && lenis.start(); opener && opener.focus && opener.focus(); };
    shots.forEach((img, k) => {
      const link = img.closest('a');
      (link || img).addEventListener('click', e => { e.preventDefault(); open(k); });
    });
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.lightbox__close') || e.target === big) close(); });
    prev.addEventListener('click', e => { e.stopPropagation(); show(cur - 1); });
    next.addEventListener('click', e => { e.stopPropagation(); show(cur + 1); });
    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(cur - 1);
      if (e.key === 'ArrowRight') show(cur + 1);
    });
    let tx = null;
    lb.addEventListener('touchstart', e => (tx = e.touches[0].clientX), { passive: true });
    lb.addEventListener('touchend', e => { if (tx !== null && Math.abs(e.changedTouches[0].clientX - tx) > 50) show(cur + (e.changedTouches[0].clientX < tx ? 1 : -1)); tx = null; });
  }

  /* ---------- headings never break words: shrink the type until the longest word fits ---------- */
  const FIT = '.page-title, .chapter__head h2, .h2, .h3, .case__title, .feature__body h2, .post h3, .kind h3, .svc-block__title, .step h3, .cta-band h2, .next__title, .contact__title, .hero__line, .pcard__back h3, .subscribe h2';
  const fitHeadings = () => $$(FIT).forEach(h => {
    h.style.fontSize = '';
    const box = h.clientWidth;
    if (!box) return;
    // widest single word of the heading
    const words = (h.textContent || '').split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0';
    h.appendChild(probe);
    let widest = 0;
    words.forEach(w => { probe.textContent = w; widest = Math.max(widest, probe.getBoundingClientRect().width); });
    probe.remove();
    const cs = getComputedStyle(h);
    const room = box - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let size = parseFloat(cs.fontSize);
    if (widest > room) {
      size = Math.max(12, Math.floor(size * (room / widest) * 0.97));
      h.style.fontSize = size + 'px';
    }
    // final check against the real layout (letter-spacing, nested spans): step down until nothing sticks out
    for (let k = 0; k < 8 && size > 12 && h.scrollWidth > h.clientWidth + 1; k++) { size = Math.max(12, Math.floor(size * 0.95)); h.style.fontSize = size + 'px'; }
  });
  let ft;
  const refit = () => { clearTimeout(ft); ft = setTimeout(fitHeadings, 120); };
  fitHeadings();
  document.fonts && document.fonts.ready.then(fitHeadings);
  addEventListener('resize', refit);

  /* ---------- FAQ ---------- */
  $$('.faq__q').forEach(q => q.addEventListener('click', () => {
    q.parentElement.classList.toggle('is-open');
    setTimeout(() => hasGsap && ScrollTrigger.refresh(), 650);
  }));

  /* ---------- keep pinned sections in sync with late layout changes ---------- */
  if (hasGsap) {
    let rt;
    const refresh = () => { clearTimeout(rt); rt = setTimeout(() => ScrollTrigger.refresh(), 200); };
    $$('img').forEach(img => img.complete || img.addEventListener('load', refresh, { once: true }));
    addEventListener('load', refresh);
    document.fonts && document.fonts.ready.then(refresh);
  }

  /* ---------- crack easter egg ---------- */
  addEventListener('nut:crack', e => {
    if (!hasGsap || !e.detail) return;
    gsap.fromTo('.hero__line--big', { scale: 1 }, { scale: 1.04, duration: .12, yoyo: true, repeat: 3, ease: 'power1.inOut' });
  });
})();
