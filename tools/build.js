// NUTS static page generator.
// Open tools/build.html on the local dev server (server.ps1) with tools/save-server.ps1 running:
// it reads data/content.json and writes cases/, services/, blog/, about.html and contacts.html.

const SAVE = 'http://localhost:5174/save?path=';

const CASE_CATS = { 'web-razraborka': 'Разработка', reklama: 'Реклама', smm: 'SMM', seo: 'SEO' };
const CASE_FILTER = { 'web-razraborka': 'dev', reklama: 'ads', smm: 'smm', seo: 'seo' };
const POST_CATS = { smm: 'SMM', prodvizhenie: 'Продвижение', productivity: 'Разработка', 'Project-management': 'Менеджмент' };
const SECTIONS = {
  razrabatyvaem: { label: 'Разработка', cases: 'web-razraborka', short: 'Сайты, лендинги, интернет-магазины и приложения.' },
  reklamiryem: { label: 'Реклама', cases: 'reklama', short: 'Контекст, таргет, медийка и programmatic.' },
  'prodvigaem-v-poiskovikah': { label: 'SEO', cases: 'seo', short: 'Выводим в топ Яндекса и Google и держим там.' },
  smm: { label: 'SMM', cases: 'smm', short: 'Соцсети под ключ, клипы, посевы и продакшн.' },
  'it-resheniya': { label: 'IT-решения', cases: 'web-razraborka', short: 'CRM, тендерные площадки и порталы для бизнеса.' },
  podderzhivaem: { label: 'Поддержка', cases: 'seo', short: 'Техническая и информационная поддержка сайтов.' },
};
const SECTION_ORDER = ['razrabatyvaem', 'reklamiryem', 'prodvigaem-v-poiskovikah', 'smm', 'it-resheniya', 'podderzhivaem'];
// handcrafted bodies that replace the generated ones
const CUSTOM = {
  'cases/kompleksnoe-prodvizhenie-federalnogo-developera-dogma-v-sotsialnykh-setyakh-.html': 'case--kompleksnoe-prodvizhenie-federalnogo-developera-dogma-v-sotsialnykh-setyakh-',
  'services/razrabatyvaem.html': 'service--razrabatyvaem',
  'blog/gayd-pochemu-vash-sayt-rabotaet-neeffektivno.html': 'article--gayd-pochemu-vash-sayt-rabotaet-neeffektivno',
};
// root-level names the handcrafted bodies used before pages moved
const LEGACY = {
  'case.html': 'cases/kompleksnoe-prodvizhenie-federalnogo-developera-dogma-v-sotsialnykh-setyakh-.html',
  'service.html': 'services/razrabatyvaem.html',
  'article.html': 'blog/gayd-pochemu-vash-sayt-rabotaet-neeffektivno.html',
  'blog.html': 'blog/index.html',
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const strip = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim(); };
const cut = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s);
const log = m => { document.getElementById('log').textContent += m + '\n'; };

let D, FILES, pages = {};

/* ---------- links ---------- */
function mapOldUrl(href) {
  const m = href.match(/^https?:\/\/(?:www\.)?nuts-agency\.ru(\/[^?#]*)/);
  if (!m) return null;
  const seg = m[1].split('/').filter(Boolean);
  if (seg[0] === 'projects') return seg[2] && D.cases.some(c => c.slug === seg[2]) ? `cases/${seg[2]}.html` : 'cases/index.html';
  if (seg[0] === 'articles') return seg[2] && D.articles.some(a => a.slug === seg[2]) ? `blog/${seg[2]}.html` : 'blog/index.html';
  if (seg[0] === 'services') { const k = seg[2] || seg[1]; return k && D.services.some(s => (s.slug || s.section) === k) ? `services/${k}.html` : 'services/index.html'; }
  if (seg[0] === 'company') return 'about.html';
  if (seg[0] === 'contacts') return 'contacts.html';
  if (!seg.length) return 'index.html';
  return null;
}
// make every relative/old-site URL in a chunk of HTML correct for a page living at `depth`
function relink(html, depth) {
  const p = depth ? '../'.repeat(depth) : '';
  return html.replace(/(href|src)="([^"]*)"/g, (all, attr, url) => {
    if (/^(#|mailto:|tel:|data:|javascript:)/.test(url)) return all;
    if (/^https?:/.test(url)) { const m = mapOldUrl(url); return m ? `${attr}="${p}${m}"` : all; }
    const [path, hash = ''] = url.split('#');
    const target = LEGACY[path] || path || 'index.html';
    return `${attr}="${p}${target}${hash ? '#' + hash : ''}"`;
  });
}

/* ---------- content normalising ---------- */
function normalize(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  // drop images that failed to download
  root.querySelectorAll('img').forEach(img => {
    const f = img.getAttribute('src').replace('assets/content/', '');
    if (!FILES.has(f)) (img.closest('figure') || img).remove();
  });
  // old in-page TOCs: lists made only of bold items
  root.querySelectorAll('ul,ol').forEach(l => {
    const lis = [...l.children];
    if (lis.length > 2 && lis.every(li => { const t = li.textContent.trim(); const b = [...li.querySelectorAll('strong')].map(s => s.textContent.trim()).join(' ').trim(); return t && b && t.startsWith(b) && t.length - b.length < 60; }) && root.querySelector('h2')) l.remove();
  });
  // wrap stray inline content into paragraphs
  const out = document.createElement('div');
  let para = null;
  [...root.childNodes].forEach(n => {
    const block = n.nodeType === 1 && /^(H2|H3|P|UL|OL|BLOCKQUOTE|FIGURE|TABLE)$/.test(n.tagName);
    if (block) { para = null; out.appendChild(n); return; }
    if (n.nodeType === 3 && !n.textContent.trim()) return;
    if (n.nodeType === 1 && n.tagName === 'BR') { para = null; return; }
    if (!para) { para = document.createElement('p'); out.appendChild(para); }
    para.appendChild(n);
  });
  out.querySelectorAll('p').forEach(p => { if (!p.textContent.trim() && !p.querySelector('img')) p.remove(); });
  out.querySelectorAll('table').forEach(t => { const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.appendChild(t); });
  out.querySelectorAll('a[href^="http"]').forEach(a => { if (!/nuts-agency\.ru/.test(a.href)) { a.target = '_blank'; a.rel = 'noopener'; } });
  return out.innerHTML;
}
// split body into [{title, html}] by h2
function chapters(html, firstTitle) {
  const root = document.createElement('div'); root.innerHTML = html;
  const list = []; let cur = { title: firstTitle, html: '' };
  [...root.children].forEach(n => {
    if (n.tagName === 'H2') { if (cur.html.trim()) list.push(cur); cur = { title: n.textContent.trim(), html: '' }; }
    else cur.html += n.outerHTML;
  });
  if (cur.html.trim()) list.push(cur);
  return list;
}
// soft hyphens for long Russian words in big display type (browser hyphenation is unreliable here):
// break V|CV inside words of 11+ letters, keeping at least 3 letters on each side
const VOW = 'аеёиоуыэюяaeiouy';
const shy = text => esc(text).replace(/[А-Яа-яЁёA-Za-z]{11,}/g, w => {
  let out = '';
  for (let i = 0; i < w.length; i++) {
    out += w[i];
    const isV = c => c && VOW.includes(c.toLowerCase());
    if (i < 2 || i > w.length - 4 || 'ьъй'.includes(w[i + 1].toLowerCase())) continue;
    const vcv = isV(w[i]) && !isV(w[i + 1]) && isV(w[i + 2]);          // ве|ди
    const vccv = isV(w[i - 1]) && !isV(w[i]) && !isV(w[i + 1]) && isV(w[i + 2]); // из|во
    if (vcv || vccv) out += '&shy;';
  }
  return out;
});
const longTitle =(t, n = 55) => t.length > n || Math.max(...t.split(/\s+/).map(w => w.length)) >= 13;
const firstText = html => { const d = document.createElement('div'); d.innerHTML = html; const p = [...d.querySelectorAll('p')].find(x => x.textContent.trim().length > 60); return p ? p.textContent.trim() : ''; };

/* ---------- chrome ---------- */
const NAV = [['services/index.html', 'Услуги', 'services'], ['cases/index.html', 'Кейсы', 'cases'], ['about.html', 'О нас', 'about'], ['blog/index.html', 'Блог', 'blog'], ['contacts.html', 'Контакты', 'contacts']];
function page({ path, title, desc, active, main, before = '', image }) {
  const depth = path.split('/').length - 1;
  const p = depth ? '../'.repeat(depth) : '';
  const nav = NAV.map(([href, label, key]) => `<a href="${p}${href}"${key === active ? ' class="is-active"' : ''} data-cursor="hover">${label}</a>`).join('\n    ');
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">${image ? `\n  <meta property="og:image" content="${p}${image}">` : ''}
  <meta name="theme-color" content="#0d0d0d">
  <link rel="stylesheet" href="${p}vendor/fonts/fonts.css">
  <link rel="stylesheet" href="${p}css/style.css">
  <link rel="stylesheet" href="${p}css/pages.css">
  <link rel="icon" href="${p}assets/logo-mark.png" type="image/png">
</head>
<body>

<div class="cursor" id="cursor"><span class="cursor__label" id="cursorLabel"></span></div>

<header class="header" id="header">
  <a href="${p}index.html" class="logo" aria-label="NUTS — на главную">
    <img src="${p}assets/logo-mark.png" class="logo__mark" alt="" width="161" height="188"><img src="${p}assets/logo-word.png" class="logo__word" alt="NUTS digital agency" width="325" height="188">
  </a>
  <nav class="nav" id="nav">
    ${nav}
  </nav>
  <div class="header__right">
    <a href="tel:88002224604" class="header__phone">8 800 222-46-04</a>
    <a href="${p}contacts.html#brief" class="btn btn--sm magnetic" data-cursor="hover"><span>Обсудить проект</span></a>
    <button class="burger" id="burger" aria-label="Меню"><i></i><i></i></button>
  </div>
</header>
<div class="menu" id="menu">
  <nav class="menu__nav">${NAV.map(([href, label]) => `<a href="${p}${href}">${label}</a>`).join('')}</nav>
  <div class="menu__foot"><a href="tel:88002224604">8 800 222-46-04</a><a href="mailto:info@nuts-agency.ru">info@nuts-agency.ru</a></div>
</div>
${before}
<main>
${relink(main, depth)}
</main>

<footer class="footer">
  <div class="footer__big" aria-hidden="true"><span>N</span><span>U</span><span>T</span><span>S</span></div>
  <div class="footer__row">
    <span>© 2017–2026 Nuts Digital Agency</span>
    <nav>${NAV.map(([href, label]) => `<a href="${p}${href}">${label}</a>`).join('')}</nav>
    <a href="#" class="footer__up" data-cursor="hover">Наверх ↑</a>
  </div>
</footer>

<div class="grain" aria-hidden="true"></div>
<script src="${p}vendor/gsap.min.js"></script>
<script src="${p}vendor/ScrollTrigger.min.js"></script>
<script src="${p}vendor/lenis.min.js"></script>
<script src="${p}js/main.js"></script>
</body>
</html>
`;
  pages[path] = html;
}

/* ---------- shared blocks ---------- */
const hero = ({ crumbs, tags = '', title, lead = '', after = '', sm }) => `
<section class="page-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <div class="page-hero__rings" aria-hidden="true"><i></i><i></i></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a>${crumbs.map(([h, t]) => h ? `<span><a href="${h}">${esc(t)}</a></span>` : `<span>${esc(t)}</span>`).join('')}</nav>
  ${tags ? `<div class="tags" data-in style="position:relative;margin-bottom:28px">${tags}</div>` : ''}
  <h1 class="page-title${sm ? ' page-title--sm' : ''}"><span class="line"><span class="split">${shy(title)}</span></span></h1>
  ${lead ? `<p class="page-lead" data-in>${esc(lead)}</p>` : ''}
  ${after}
</section>`;

const caseCard = (c, wide) => `
    <a class="case${wide ? ' case--wide' : ''}" data-cat="${CASE_FILTER[c.cat]}" href="cases/${c.slug}.html" data-cursor="view">
      <div class="case__media"><img src="${c.cover}" alt="" loading="lazy"></div>
      <div class="case__meta"><span>${CASE_CATS[c.cat]}</span><span>${esc(c.props['Сфера'] || '')}</span></div>
      <h3 class="case__title">${esc(c.title)}</h3>
    </a>`;

const postCard = a => `
    <a href="blog/${a.slug}.html" class="post" data-cat="${a.cat}" data-cursor="read">
      <div class="post__img">${a.cover && FILES.has(a.cover.replace('assets/content/', '')) ? `<img src="${a.cover}" alt="" loading="lazy">` : `<div class="post__art post__art--1"><span>${esc((POST_CATS[a.cat] || '').slice(0, 3))}</span></div>`}</div>
      <div class="meta"><span class="cat">${POST_CATS[a.cat] || a.cat}</span><span>${esc(a.date)}</span></div>
      <h3>${esc(a.title)}</h3>
    </a>`;

const ctaBand = (t = 'Есть крепкий орешек? Расколем') => `
<section class="cta-band">
  <h2>${t.replace(/[А-Яа-яЁё]{11,}/g, shy)}</h2>
  <a href="contacts.html#brief" class="btn magnetic" data-cursor="hover"><span>Обсудить проект</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
</section>`;

const chapterHtml = list => `
<section class="chapters">
${list.map((ch, i) => `  <article class="chapter">
    <div class="chapter__head"><span class="chapter__n">${String(i + 1).padStart(2, '0')}</span><h2>${shy(ch.title)}</h2></div>
    <div class="chapter__body prose">${ch.html}</div>
  </article>`).join('\n')}
</section>`;

const BRIEF = `
<section class="contact section" id="brief">
  <div class="contact__bg" aria-hidden="true">NUTS</div>
  <div class="contact__grid">
    <div class="contact__left">
      <span class="eyebrow">Бриф</span>
      <h2 class="h2 contact__title">Есть крепкий<br><span class="orange">орешек?</span></h2>
      <p class="section__sub">Расскажите о задаче — ответим в течение рабочего дня и предложим, как её расколоть.</p>
      <div class="contact__links">
        <a href="tel:88002224604" class="contact__big" data-cursor="hover">8 800 222-46-04</a>
        <a href="mailto:info@nuts-agency.ru" class="contact__big" data-cursor="hover">info@nuts-agency.ru</a>
        <p class="contact__addr">Краснодар, ул. Красная, 155/2, 7 этаж</p>
        <div class="socials">
          <a href="https://t.me/nutsdigitalagency" target="_blank" rel="noopener" class="social" data-cursor="hover">Telegram</a>
          <a href="https://vk.com/nutsdigital" target="_blank" rel="noopener" class="social" data-cursor="hover">VK</a>
        </div>
      </div>
    </div>
    <form class="brief" id="briefForm" novalidate>
      <fieldset>
        <legend>Что нужно?</legend>
        <div class="chips">
          ${['Сайт', 'Приложение', 'Реклама', 'SEO', 'SMM', 'Видео', 'CRM / IT'].map(v => `<label><input type="checkbox" name="svc" value="${v}"><span>${v}</span></label>`).join('\n          ')}
        </div>
      </fieldset>
      <fieldset>
        <legend>Бюджет, ₽</legend>
        <div class="chips chips--radio">
          ${['до 300к', '300к – 1м', '1м+', 'All-in 🃏'].map(v => `<label><input type="radio" name="budget" value="${v}"><span>${v}</span></label>`).join('\n          ')}
        </div>
      </fieldset>
      <div class="field"><input id="fName" name="name" required placeholder=" "><label for="fName">Как вас зовут</label></div>
      <div class="field"><input id="fContact" name="contact" required placeholder=" "><label for="fContact">Телефон или Telegram</label></div>
      <div class="field"><textarea id="fMsg" name="msg" rows="3" placeholder=" "></textarea><label for="fMsg">Пара слов о задаче</label></div>
      <button type="submit" class="btn btn--orange btn--wide magnetic" data-cursor="hover"><span>Отправить и расколоть</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      <p class="brief__note">Нажимая кнопку, вы соглашаетесь с политикой обработки персональных данных.</p>
      <div class="brief__done"><span>🌰</span><h3>Орех принят!</h3><p>Скоро свяжемся.</p></div>
    </form>
  </div>
</section>`;

async function custom(path) {
  const name = CUSTOM[path];
  if (!name) return null;
  const r = await fetch(`../data/custom/${name}.html?` + Date.now());
  return r.ok ? r.text() : null;
}

/* ---------- pages ---------- */
async function buildCases() {
  const cases = D.cases;
  page({
    path: 'cases/index.html', title: 'Кейсы — NUTS', desc: `${cases.length} проектов NUTS: разработка, реклама, SEO и SMM для бизнеса.`, active: 'cases',
    main: hero({ crumbs: [[null, 'Кейсы']], title: 'Расколотые орешки', lead: `${cases.length} проектов за 9 лет: сайты и приложения, реклама, SEO и соцсети для девелоперов, клиник, ритейла и производств.`,
      after: `<div class="filters" id="filters" data-in style="position:relative;margin-top:36px">
    <button class="filter is-active" data-f="all">Все · ${cases.length}</button>
    ${Object.entries(CASE_FILTER).map(([k, f]) => `<button class="filter" data-f="${f}">${CASE_CATS[k]} · ${cases.filter(c => c.cat === k).length}</button>`).join('\n    ')}
  </div>` }) + `
<section class="section" style="padding-top:0">
  <div class="cases__grid">${cases.map((c, i) => caseCard(c, i % 7 === 0)).join('')}
  </div>
</section>` + ctaBand(),
  });

  for (const [i, c] of cases.entries()) {
    const path = `cases/${c.slug}.html`;
    const desc = cut(c.task || strip(c.html), 160);
    let main = await custom(path);
    if (!main) {
      const body = normalize(c.html);
      const list = chapters(body, 'О проекте');
      const facts = [['Направление', CASE_CATS[c.cat]], ...Object.entries(c.props)].filter(([, v]) => v);
      const gallery = c.gallery.filter(g => FILES.has(g.replace('assets/content/', '')) && g !== c.cover);
      const sameCat = cases.filter(x => x.cat === c.cat && x !== c);
      const similar = [...c.similar.map(u => cases.find(x => x.url === u)).filter(Boolean), ...sameCat].filter((x, k, arr) => arr.indexOf(x) === k).slice(0, 3);
      const nextC = cases.slice(i + 1).find(x => x.cat === c.cat) || sameCat[0];
      main = hero({ crumbs: [['cases/index.html', 'Кейсы'], [null, CASE_CATS[c.cat]]], tags: `<span class="is-hot">${CASE_CATS[c.cat]}</span>${c.props['Сфера'] ? `<span>${esc(c.props['Сфера'])}</span>` : ''}`, title: c.title, lead: c.task, sm: longTitle(c.title) }) + `
<div class="facts" data-in>
  ${facts.slice(0, 4).map(([k, v]) => `<div class="fact"><b>${esc(k)}</b>${k === 'Сайт' && /^https?:/.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener" data-cursor="hover">${esc(v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))} ↗</a>` : `<span>${esc(v)}</span>`}</div>`).join('\n  ')}
</div>
${c.cover && FILES.has(c.cover.replace('assets/content/', '')) ? `<figure class="cover" data-cursor="view"><img src="${c.cover}" alt="${esc(c.title)}"></figure>` : ''}
${list.length ? chapterHtml(list) : ''}
${gallery.length > 1 ? `<section class="gallery-wrap">
  <div class="section__head section__head--row"><h2 class="h3">Галерея проекта</h2><span class="gallery__hint">тяни <i></i></span></div>
  <div class="gallery" data-cursor="drag">${gallery.map(g => `<figure><img src="${g}" alt="" loading="lazy"></figure>`).join('')}</div>
</section>` : ''}
${c.review ? `<figure class="bigquote"><blockquote>${esc(c.review.text)}</blockquote><figcaption><b>${esc(c.review.name)}</b><span>${esc(c.review.role)}</span></figcaption></figure>` : ''}
${nextC && nextC !== c ? `<a class="next" href="cases/${nextC.slug}.html" data-cursor="view">
  <span class="next__label">Следующий кейс →</span>
  <h2 class="next__title">${shy(nextC.title)}</h2>
  <div class="next__img"><img src="${nextC.cover}" alt=""></div>
</a>` : ''}
${similar.length ? `<section class="section" style="padding-top:clamp(40px,5vw,80px);padding-bottom:0">
  <div class="section__head section__head--row" style="margin-bottom:36px"><h2 class="h3">Похожие проекты</h2><a href="cases/index.html" class="link-arrow" data-cursor="hover">Все кейсы →</a></div>
  <div class="cases__grid">${similar.map(x => caseCard(x)).join('')}</div>
</section>` : ''}
${ctaBand('Хотите так же? Расколем и&nbsp;ваш орешек')}`;
    }
    page({ path, title: `${c.title} — кейс NUTS`, desc, active: 'cases', main, image: c.cover });
  }
}

async function buildServices() {
  const S = D.services;
  const sections = SECTION_ORDER.map(k => ({ key: k, page: S.find(s => s.section === k && !s.slug), subs: S.filter(s => s.section === k && s.slug) }));
  page({
    path: 'services/index.html', title: 'Услуги — NUTS', desc: 'Разработка сайтов и приложений, реклама, SEO, SMM, IT-решения и поддержка. Полный цикл digital.', active: 'services',
    main: hero({ crumbs: [[null, 'Услуги']], title: 'Что мы колем', lead: 'Полный цикл: от стратегии и дизайна до трафика и поддержки. Можно целиком, можно по кусочку.' }) + `
<section class="section" style="padding-top:0">
  <div class="svc-list">
${sections.map((s, i) => `    <article class="svc-block">
      <a href="services/${s.key}.html" class="svc-block__head" data-cursor="open">
        <span class="svc__n">${String(i + 1).padStart(2, '0')}</span>
        <h2 class="svc-block__title">${esc(SECTIONS[s.key].label)}</h2>
        <p>${esc(SECTIONS[s.key].short)}</p>
        <span class="svc-block__arrow">→</span>
      </a>
      ${s.subs.length ? `<div class="svc-block__subs">${s.subs.map(x => `<a href="services/${x.slug}.html" data-cursor="hover">${esc(x.title)}</a>`).join('')}</div>` : ''}
    </article>`).join('\n')}
  </div>
</section>` + ctaBand(),
  });

  for (const s of S) {
    const key = s.slug || s.section;
    const path = `services/${key}.html`;
    const sec = SECTIONS[s.section];
    const body = normalize(s.html);
    const lead = cut(firstText(body), 220);
    let main = await custom(path);
    if (!main) {
      const subs = s.slug ? [] : S.filter(x => x.section === s.section && x.slug);
      const siblings = s.slug ? S.filter(x => x.section === s.section && x.slug && x !== s) : [];
      const list = chapters(body, 'Об услуге');
      const rel = D.cases.filter(c => c.cat === sec.cases).slice(0, 4);
      main = hero({ crumbs: [['services/index.html', 'Услуги'], ...(s.slug ? [[`services/${s.section}.html`, sec.label]] : []), [null, s.title]], tags: `<span class="is-hot">${esc(sec.label)}</span>`, title: s.title, lead,
        after: `<div class="svc-hero__ctas" data-in style="position:relative;margin-top:32px"><a href="#brief" class="btn btn--orange magnetic" data-cursor="hover"><span>Обсудить задачу</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>${rel.length ? '<a href="#svc-cases" class="btn btn--ghost magnetic" data-cursor="hover"><span>Кейсы</span></a>' : ''}</div>`, sm: longTitle(s.title, 40) }) + `
${subs.length ? `<section class="section section--light" style="margin-top:clamp(40px,6vw,80px)">
  <div class="section__head"><span class="eyebrow">Направления</span><h2 class="h2">Выберите<br><span class="orange">свой орех</span></h2></div>
  <div class="kinds">${subs.map((x, i) => `
    <a class="kind" href="services/${x.slug}.html" data-cursor="open">
      <span class="kind__ico">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(x.title)}</h3>
      <p>${esc(cut(firstText(normalize(x.html)), 130))}</p>
      <div class="kind__term"><span>Подробнее</span><b>→</b></div>
    </a>`).join('')}
  </div>
</section>` : ''}
${list.length ? chapterHtml(list) : ''}
${rel.length ? `<section class="section" id="svc-cases" style="padding-top:0">
  <div class="section__head section__head--row"><div><span class="eyebrow">Кейсы</span><h2 class="h2">Уже <span class="orange">раскололи</span></h2></div><a href="cases/index.html" class="link-arrow" data-cursor="hover">Все кейсы →</a></div>
  <div class="cases__grid">${rel.slice(0, 3).map(c => caseCard(c)).join('')}</div>
</section>` : ''}
${siblings.length ? `<section class="section" style="padding-top:0">
  <div class="section__head" style="margin-bottom:28px"><h2 class="h3">Ещё в разделе «${esc(sec.label)}»</h2></div>
  <div class="tags tags--big">${siblings.map(x => `<a href="services/${x.slug}.html" data-cursor="hover">${esc(x.title)}</a>`).join('')}</div>
</section>` : ''}
${BRIEF}`;
    }
    page({ path, title: `${s.title} — NUTS`, desc: lead || sec.short, active: 'services', main });
  }
}

async function buildBlog() {
  const A = D.articles;
  const cats = [...new Set(A.map(a => a.cat))];
  const [first, ...rest] = A;
  page({
    path: 'blog/index.html', title: 'Блог — NUTS', desc: 'Статьи NUTS о сайтах, SEO, соцсетях, дизайне и digital-маркетинге.', active: 'blog',
    main: `
<section class="page-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <div class="page-hero__rings" aria-hidden="true"><i></i><i></i></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a><span>Блог</span></nav>
  <div class="blog-top">
    <h1 class="page-title"><span class="line"><span class="split">Орехи</span></span><span class="line"><span class="split orange">для ума</span></span></h1>
    <div class="filters" id="filters" data-in>
      <button class="filter is-active" data-f="all">Все</button>
      ${cats.map(c => `<button class="filter" data-f="${c}">${POST_CATS[c] || c}</button>`).join('\n      ')}
    </div>
  </div>
  <p class="page-lead" data-in>Пишем о том, что делаем каждый день: сайты, SEO, соцсети, дизайн и digital-маркетинг. Без воды — только ядро.</p>
</section>
<a class="feature" href="blog/${first.slug}.html" data-cursor="read">
  <div class="feature__img"><img src="${first.cover}" alt=""></div>
  <div class="feature__body">
    <div class="meta"><span class="cat">${POST_CATS[first.cat]}</span><span>${esc(first.date)}</span></div>
    <h2>${esc(first.title)}</h2>
    <p>${esc(cut(firstText(normalize(first.html)), 200))}</p>
    <span class="link-arrow" style="align-self:flex-start">Читать →</span>
  </div>
</a>
<section class="section" style="padding-top:clamp(60px,8vw,110px)">
  <div class="posts">${rest.map(postCard).join('')}
  </div>
</section>
<section class="subscribe">
  <img src="assets/logo-mark.png" class="subscribe__nut" alt="" aria-hidden="true">
  <div><h2>Орехи — <span class="orange">в Telegram</span></h2><p>Новые статьи, кейсы и закулисье агентства. Без спама, только ядро.</p></div>
  <a href="https://t.me/nutsdigitalagency" target="_blank" rel="noopener" class="btn btn--orange magnetic" data-cursor="hover"><span>Подписаться</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
</section>` + ctaBand('Хватит читать — давайте делать'),
  });

  for (const a of A) {
    const path = `blog/${a.slug}.html`;
    const body = normalize(a.html);
    const desc = cut(firstText(body), 160);
    let main = await custom(path);
    if (!main) {
      const root = document.createElement('div'); root.innerHTML = body;
      const toc = [];
      root.querySelectorAll('h2, h3').forEach((h, i) => { h.id = 's' + (i + 1); toc.push(`<a href="#${h.id}"${h.tagName === 'H3' ? ' class="sub"' : ''} data-cursor="hover">${esc(cut(h.textContent.trim(), 60))}</a>`); });
      const related = [...A.filter(x => x !== a && x.cat === a.cat), ...A.filter(x => x !== a && x.cat !== a.cat)].slice(0, 3);
      const share = encodeURIComponent(`https://kvashin23.github.io/nuts/${path}`);
      main = `
<section class="page-hero article-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a><span><a href="blog/index.html">Блог</a></span><span>${POST_CATS[a.cat] || a.cat}</span></nav>
  <div class="meta" data-in><span class="cat">${POST_CATS[a.cat] || a.cat}</span><span>${esc(a.date)}</span><span>${Math.max(1, Math.round(root.textContent.split(/\s+/).length / 180))} мин чтения</span></div>
  <h1 class="page-title page-title--sm"><span class="line"><span class="split">${shy(a.title)}</span></span></h1>
  <div class="author" data-in><span class="author__ava">N</span><div><b>Команда NUTS</b><span>Digital-агентство полного цикла</span></div></div>
</section>
${a.cover && FILES.has(a.cover.replace('assets/content/', '')) ? `<figure class="cover"><img src="${a.cover}" alt=""></figure>` : ''}
<div class="article">
  <aside class="toc">
    ${toc.length > 1 ? `<span class="toc__title">Содержание</span>\n    ${toc.join('\n    ')}` : ''}
    <div class="share">
      <a href="https://t.me/share/url?url=${share}" target="_blank" rel="noopener" data-cursor="hover">Telegram</a>
      <a href="https://vk.com/share.php?url=${share}" target="_blank" rel="noopener" data-cursor="hover">VK</a>
    </div>
  </aside>
  <article class="article__body prose">${root.innerHTML}</article>
  <aside class="article__aside">
    <div class="aside-card"><h3>Нужна помощь?</h3><p>Расскажите о задаче — предложим, как её решить.</p><a href="contacts.html#brief" class="btn magnetic" data-cursor="hover"><span>Обсудить</span></a></div>
  </aside>
</div>
<section class="section">
  <div class="section__head section__head--row" style="margin-bottom:36px"><h2 class="h3">Читайте также</h2><a href="blog/index.html" class="link-arrow" data-cursor="hover">Все статьи →</a></div>
  <div class="posts">${related.map(postCard).join('')}</div>
</section>` + ctaBand('Остались вопросы? Расколем вместе');
    }
    page({ path, title: `${a.title} — блог NUTS`, desc, active: 'blog', main, before: '<div class="readbar" id="readBar" aria-hidden="true"></div>', image: a.cover });
  }
}

function buildAbout() {
  const reviews = D.cases.filter(c => c.review);
  page({
    path: 'about.html', title: 'О компании — NUTS', desc: 'Nuts Digital Agency — digital-агентство полного цикла из Краснодара. С 2017 года делаем сайты, рекламу, SEO и SMM.', active: 'about',
    main: hero({ crumbs: [[null, 'О нас']], title: 'Привет! Мы Nuts', lead: 'Безумцы в стиле digital. В 2017 году Костя и Данил Квашины открыли агентство полного цикла — и с тех пор превращаем нереальное в реальное.' }) + `
<section class="section" style="padding-top:0">
  <div class="bigstats" style="padding:0">
    <div class="bigstat"><b>2017</b><span>год основания. Начинали втроём на 20 м²</span></div>
    <div class="bigstat"><b>18</b><span>человек в команде сегодня</span></div>
    <div class="bigstat"><b>160<small>м²</small></b><span>офис на Красной, 155/2</span></div>
    <div class="bigstat"><b>${D.cases.length}</b><span>кейсов в портфолио</span></div>
  </div>
</section>
<section class="chapters" style="padding-top:0">
  <article class="chapter">
    <div class="chapter__head"><span class="chapter__n">01</span><h2>Кто мы</h2></div>
    <div class="chapter__body prose">
      <p><strong>Nuts Digital Agency — команда, влюблённая в интернет-маркетинг.</strong> Маркетологи, программисты, SEO-специалисты, дизайнеры и аналитики — 18 человек, готовых включиться в ваш проект уже сейчас.</p>
      <p>Мы занимаемся продвинутым интернет-маркетингом 24/7: веб-разработка, медийная реклама, продвижение и поддержка сайтов, стратегии, рост прибыли и управление репутацией.</p>
    </div>
  </article>
  <article class="chapter">
    <div class="chapter__head"><span class="chapter__n">02</span><h2>Что умеем</h2></div>
    <div class="chapter__body prose">
      <ul class="checklist">
        <li>Захватываем интернет эффективными стратегиями: продвижение, контекст, таргет, медийка</li>
        <li>Увеличиваем прибыль: CRM, тендерные площадки и порталы под процессы бизнеса</li>
        <li>Выстраиваем репутацию и учим клиентов пользоваться её плодами</li>
        <li>Выводим сайты в топ — с индивидуальным подходом и результатом в цифрах</li>
      </ul>
    </div>
  </article>
  <article class="chapter">
    <div class="chapter__head"><span class="chapter__n">03</span><h2>Почему NUTS</h2></div>
    <div class="chapter__body prose">
      <p>Nuts — это и орехи, и «сумасшедшие» в хорошем смысле, и умные: грецкий орех похож на мозг. А ещё «the nuts» — лучшая рука в покере, которую невозможно побить. Мы играем на результат.</p>
    </div>
  </article>
</section>
${reviews.length ? `<section class="section section--light">
  <div class="reviews" style="margin-top:0">
    <div class="reviews__head"><h2 class="h3">Что говорят клиенты</h2>
      <div class="reviews__nav">
        <button class="round" id="revPrev" aria-label="Назад" data-cursor="hover"><svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg></button>
        <button class="round" id="revNext" aria-label="Вперёд" data-cursor="hover"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </div>
    </div>
    <div class="reviews__viewport"><div class="reviews__track" id="revTrack">
      ${reviews.map(c => `<figure class="review"><blockquote>${esc(cut(c.review.text, 260))}</blockquote><figcaption><b>${esc(c.review.name)}</b><span>${esc(c.review.role)}</span></figcaption></figure>`).join('\n      ')}
    </div></div>
  </div>
</section>` : ''}
<section class="clients">
  <p class="clients__cap">Нас выбирают те, кто готов к успеху</p>
  <div class="ticker"><div class="ticker__track">
    ${(() => { const l = ['Девелопмент-Юг', 'Черкизово', 'DOGMA', 'КЛЮЧАВТО', 'СБС Мегамолл', 'МНТК «Микрохирургия глаза»', 'СК Семья', 'Алкотека', 'Лефкадия', 'Schaumann', 'Точка Молочка', 'Арт-Сайд'].map(x => `<span>${x}</span>`).join(''); return l + l; })()}
  </div></div>
</section>` + ctaBand('Познакомимся поближе?'),
  });
}

function buildContacts() {
  page({
    path: 'contacts.html', title: 'Контакты — NUTS', desc: 'Nuts Digital Agency: Краснодар, ул. Красная, 155/2, 7 этаж. 8 800 222-46-04, info@nuts-agency.ru.', active: 'contacts',
    main: hero({ crumbs: [[null, 'Контакты']], title: 'Давайте знакомиться', lead: 'Пока вы думаете — ваши конкуренты уже едут в наш офис.' }) + `
<section class="section" style="padding-top:0">
  <div class="contact-cards">
    <a class="contact-card" href="tel:88002224604" data-cursor="hover"><b>Телефон</b><span>8 800 222-46-04</span></a>
    <a class="contact-card" href="mailto:info@nuts-agency.ru" data-cursor="hover"><b>Почта</b><span>info@nuts-agency.ru</span></a>
    <a class="contact-card" href="https://yandex.ru/maps/?text=%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%BE%D0%B4%D0%B0%D1%80%2C%20%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F%20155%2F2" target="_blank" rel="noopener" data-cursor="open"><b>Офис</b><span>Краснодар, Красная, 155/2, 7 этаж ↗</span></a>
    <a class="contact-card" href="https://t.me/nutsdigitalagency" target="_blank" rel="noopener" data-cursor="hover"><b>Telegram</b><span>@nutsdigitalagency ↗</span></a>
  </div>
</section>
${BRIEF}`,
  });
}

/* ---------- run ---------- */
async function run() {
  D = await (await fetch('../data/content.json?' + Date.now())).json();
  FILES = new Set(await (await fetch('../data/files.json?' + Date.now())).json());
  log(`content: ${D.cases.length} cases, ${D.services.length} services, ${D.articles.length} articles`);
  await buildCases(); await buildServices(); await buildBlog(); buildAbout(); buildContacts();
  // homepage: point old-site and legacy links at the generated pages
  let home = await (await fetch('../index.html?' + Date.now())).text();
  home = relink(home, 0)
    .replace(/<a href="#services"( data-cursor="hover")?>Услуги<\/a>/g, '<a href="services/index.html"$1>Услуги</a>')
    .replace(/<a href="#about"( data-cursor="hover")?>О нас<\/a>/g, '<a href="about.html"$1>О нас</a>')
    .replace(/Все проекты — \d+\+?/, `Все проекты — ${D.cases.length}`)
    .replace(/ target="_blank" rel="noopener"( class="(?:case|post)[^"]*")/g, '$1');
  pages['index.html'] = home;
  // keep old flat URLs working
  for (const [old, now] of Object.entries(LEGACY)) pages[old] = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${now}"><link rel="canonical" href="${now}"><a href="${now}">${now}</a>\n`;
  let n = 0;
  for (const [path, html] of Object.entries(pages)) {
    const r = await fetch(SAVE + encodeURIComponent(path), { method: 'POST', body: html });
    if (!r.ok) log('FAIL ' + path + ' ' + (await r.text()));
    n++;
  }
  log(`written: ${n} pages`);
  window.__built = { n, paths: Object.keys(pages) };
}
run().catch(e => { log('ERROR ' + e.stack); window.__built = { error: String(e.stack) }; });
