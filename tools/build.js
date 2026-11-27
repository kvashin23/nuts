// NUTS static page generator.
// Open tools/build.html on the local dev server (server.ps1) with tools/save-server.ps1 running:
// it reads data/*.json and writes the inner pages under the old site addresses (projects/, services/, articles/, company/,
// contacts/), the head of index.html, sitemap.xml and robots.txt. See README, "SEO".

const SAVE = 'http://localhost:5174/save?path=';
// SEO (25.11): the new site keeps every address, title and description of the old nuts-agency.ru.
// Canonical URLs always point at production. INDEX = false while the site lives on the test domain:
// robots.txt closes everything and every page carries <meta name="robots" content="noindex, nofollow">.
// Before switching nuts-agency.ru to this site: INDEX = true, rebuild, push.
const SITE = 'https://nuts-agency.ru/';
const INDEX = false;
const VER = Date.now().toString(36); // appended to our CSS/JS URLs on every build

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

let D, FILES, PRICES, SEO, pages = {};

/* ---------- addresses ---------- */
// Templates speak in short "flat" names (cases/<slug>.html, services/<key>.html, blog/<slug>.html, about.html…);
// route() turns them into the old site's addresses, which are what the pages are written to and linked by.
const lowerCat = c => (c === 'Project-management' ? 'project-management' : c); // the old site 301s this one to lower case
const caseUrl = c => `projects/${c.cat}/${c.slug}/`;
const postUrl = a => `articles/${lowerCat(a.cat)}/${a.slug}/`;
const svcUrl = key => { const s = D.services.find(x => (x.slug || x.section) === key); return s ? `services/${s.section}/${s.slug ? s.slug + '/' : ''}` : null; };
const SVC_URL = key => svcUrl(key) || 'services/';
function route(flat) {
  if (flat === 'index.html' || flat === '') return '';
  const FIXED = { 'cases/index.html': 'projects/', 'blog/index.html': 'articles/', 'services/index.html': 'services/', 'about.html': 'company/', 'contacts.html': 'contacts/' };
  if (FIXED[flat]) return FIXED[flat];
  let m;
  if ((m = flat.match(/^cases\/(.+)\.html$/))) { const c = D.cases.find(x => x.slug === m[1]); return c ? caseUrl(c) : null; }
  if ((m = flat.match(/^blog\/(.+)\.html$/))) { const a = D.articles.find(x => x.slug === m[1]); return a ? postUrl(a) : null; }
  if ((m = flat.match(/^services\/(.+)\.html$/))) return svcUrl(m[1]);
  return null;
}
const fileOf = out => (out === '' ? 'index.html' : out.endsWith('/') ? out + 'index.html' : out);
// links to the old site inside imported texts: same address here (uploads live in assets/files)
function mapOldUrl(href) {
  const m = href.match(/^https?:\/\/(?:www\.)?nuts-agency\.ru(\/[^?#]*)?(#.*)?$/);
  if (!m) return null;
  const path = (m[1] || '/').replace(/\/index\.php$/, '/');
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'upload') return `assets/files/${seg[seg.length - 1]}`;
  if (seg.length && seg[0] === 'articles' && seg[1]) seg[1] = lowerCat(seg[1]);
  return (seg.length ? seg.join('/') + (/\.[a-z]{2,4}$/i.test(path) ? '' : '/') : '') + (m[2] || '');
}
// make every relative/old-site URL in a chunk of HTML correct for a page living at `depth`
function relink(html, depth) {
  const p = depth ? '../'.repeat(depth) : '';
  const home = p || './';
  return html.replace(/(href|src)="([^"]*)"/g, (all, attr, url) => {
    if (/^(#|mailto:|tel:|data:|javascript:)/.test(url)) return all;
    if (/^https?:/.test(url)) { const m = mapOldUrl(url); return m === null ? all : `${attr}="${m === '' ? home : p + m}"`; }
    const [path, hash = ''] = url.split('#');
    const target = LEGACY[path] || path || 'index.html';
    const r = route(target);
    const to = r === null ? p + target : r === '' ? home : p + r;
    return `${attr}="${to}${hash ? '#' + hash : ''}"`;
  });
}

/* ---------- content normalising ---------- */
// isCase: case texts are imported 1:1 (tools/import-cases.js), so their lists are never treated as old TOCs
function normalize(html, isCase) {
  const root = document.createElement('div');
  root.innerHTML = html;
  // drop images that failed to download
  root.querySelectorAll('img').forEach(img => {
    const f = img.getAttribute('src').replace('assets/content/', '');
    if (!FILES.has(f)) (img.closest('figure') || img).remove();
  });
  root.querySelectorAll('figure').forEach(f => { if (!f.querySelector('img,iframe')) f.remove(); });
  // old in-page TOCs: lists made only of bold items
  if (!isCase) root.querySelectorAll('ul,ol').forEach(l => {
    const lis = [...l.children];
    if (lis.length > 2 && lis.every(li => { const t = li.textContent.trim(); const b = [...li.querySelectorAll('strong')].map(s => s.textContent.trim()).join(' ').trim(); return t && b && t.startsWith(b) && t.length - b.length < 60; }) && root.querySelector('h2')) l.remove();
  });
  // wrap stray inline content into paragraphs
  const out = document.createElement('div');
  let para = null;
  [...root.childNodes].forEach(n => {
    const block = n.nodeType === 1 && /^(H2|H3|P|UL|OL|BLOCKQUOTE|FIGURE|TABLE|DIV|HR)$/.test(n.tagName);
    if (block) { para = null; out.appendChild(n); return; }
    if (n.nodeType === 3 && !n.textContent.trim()) return;
    if (n.nodeType === 1 && n.tagName === 'BR') { para = null; return; }
    if (!para) { para = document.createElement('p'); out.appendChild(para); }
    para.appendChild(n);
  });
  out.querySelectorAll('p').forEach(p => { if (!p.textContent.trim() && !p.querySelector('img')) p.remove(); });
  // the old CMS sometimes repeats an intro paragraph
  const seen = new Set();
  out.querySelectorAll('p').forEach(p => { const t = p.textContent.trim(); if (t.length > 40 && seen.has(t)) p.remove(); else seen.add(t); });
  out.querySelectorAll('table').forEach(t => { const w = document.createElement('div'); w.className = 'table-wrap'; t.replaceWith(w); w.appendChild(t); });
  // numbers like "30 000 ₽" never break across lines
  const tw = document.createTreeWalker(out, NodeFilter.SHOW_TEXT); let tn;
  while ((tn = tw.nextNode())) if (/\d /.test(tn.textContent)) tn.textContent = tn.textContent.replace(/(\d) (?=\d{3}(?!\d))/g, '$1 ').replace(/(\d) (?=₽|руб|р\.)/g, '$1 ');
  out.querySelectorAll('a[href^="http"]').forEach(a => { if (!/nuts-agency\.ru/.test(a.href)) { a.target = '_blank'; a.rel = 'noopener'; } });
  // links to pages that answer 404 on the old site too stay as plain text
  out.querySelectorAll('a[href]').forEach(a => { if (/nuts-agency\.ru\/(services\/smm\/(mytarget-reklama|reklama-facebook-instagram)|company\/licenses)\//.test(a.getAttribute('href'))) a.replaceWith(...a.childNodes); });
  return out.innerHTML;
}
// client edits 28.10: service texts lose their images and the old "cases / articles" link blocks;
// on the developer-IT page runs of photos become an auto-scrolling slider instead
const SLIDER_PAGES = new Set(['it-reshenie-dlya-zastroyshchikov']);
// client edits 25.11: pictures that stay in service texts after all (by file name)
const KEEP_IMAGES = new Set(['553091ea20422546a7054423dbb2bdcb.png']); // audit: example of the competitor table
// client edits 25.11: point fixes in old service texts, applied to the raw HTML before cleaning
const SERVICE_FIXES = {
  'informatsionnaya-podderzhka-sayta': [['Развитие и обновление сайта<br>', '<h3>Развитие и обновление сайта</h3>']],
  smm: [['<em><strong>Познакомьтесь с нашим кейсом</strong></em><a', '<em><strong>Познакомьтесь с нашим кейсом:</strong></em> <a']],
  'vedenie-sotssetey-pod-klyuch': [
    ['<p><strong>Наш шоурил (посмотрите, классный же, и тут всего 30 секунд)</strong>:</p>', '<p><strong>Наш шоурил (посмотрите, классный же, и тут всего 30 секунд)</strong>:</p><div class="embed embed--vk"><iframe src="https://vk.ru/video_ext.php?oid=-211142825&amp;id=456239033&amp;hash=7250f1986fc84f81" title="Шоурил NUTS" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock" allowfullscreen loading="lazy"></iframe></div>'],
  ],
};
const fixService = (html, key) => (SERVICE_FIXES[key] || []).reduce((h, [from, to]) => { if (!h.includes(from)) log(`WARN fix not applied on ${key}: ${from.slice(0, 50)}`); return h.split(from).join(to); }, html);
// the "Техническая и контентная поддержка" price table came without its header cells merged — rebuild it
function fixPackTable(t) {
  const rows = [...t.rows].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()));
  const [cap, head, sub, ...data] = rows;
  if (!head || !sub || sub.length !== (head.length - 1) * 3) return;
  t.outerHTML = `<table class="table--price"><caption>${esc(cap[0])}</caption>
<thead><tr><th rowspan="2" scope="col">${esc(head[0])}</th>${head.slice(1).map(h => `<th colspan="3" scope="colgroup">${esc(h)}</th>`).join('')}</tr>
<tr>${sub.map(s => `<th scope="col">${esc(s)}</th>`).join('')}</tr></thead>
<tbody>${data.map(r => `<tr><th scope="row">${esc(r[0])}</th>${r.slice(1).map(v => `<td><span class="num">${esc(v)}</span></td>`).join('')}</tr>`).join('\n')}</tbody></table>`;
}
function cleanService(html, key) {
  const root = document.createElement('div'); root.innerHTML = html;
  [...root.children].forEach(h => {
    if (!/^H3$/.test(h.tagName) || !/кейсы|статьи про|^\s*содержание\s*$/i.test(h.textContent)) return;
    let n = h.nextElementSibling;
    while (n && !/^H[23]$/.test(n.tagName)) { const next = n.nextElementSibling; n.remove(); n = next; }
    h.remove();
  });
  // old "Оформите заявку … / Заказать …" strips (one-row tables) — the page has its own brief form
  root.querySelectorAll('table').forEach(t => {
    if (t.rows.length === 1 && t.rows[0].cells.length === 2 && /заявк/i.test(t.rows[0].cells[0].textContent)) (t.closest('.table-wrap') || t).remove();
  });
  root.querySelectorAll('table').forEach(t => { if (/Пакет 10 часов/.test(t.textContent)) fixPackTable(t); });
  if (SLIDER_PAGES.has(key)) {
    // lists that hold nothing but pictures (one per item) are galleries — unwrap them into figures
    root.querySelectorAll('ul, ol').forEach(l => {
      const imgs = l.querySelectorAll('img');
      if (imgs.length < 2 || l.textContent.trim()) return;
      const figs = [...imgs].map(img => { const f = img.closest('figure') || Object.assign(document.createElement('figure'), {}); if (!f.contains(img)) f.appendChild(img); return f; });
      l.replaceWith(...figs);
    });
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const box = document.createElement('div'); box.className = 'autoslider';
        const track = document.createElement('div'); track.className = 'autoslider__track';
        run[0].before(box); box.appendChild(track); run.forEach(f => track.appendChild(f));
      }
      run = [];
    };
    [...root.children].forEach(n => { if (n.tagName === 'FIGURE') run.push(n); else flush(); });
    flush();
  } else {
    root.querySelectorAll('figure, img').forEach(f => {
      const img = f.tagName === 'IMG' ? f : f.querySelector('img');
      if (img && KEEP_IMAGES.has((img.getAttribute('src') || '').split('/').pop())) {
        // an italic line right under a kept picture is its caption
        const fig = f.tagName === 'FIGURE' ? f : f.closest('figure');
        const n = fig && fig.nextElementSibling;
        if (n && n.tagName === 'P' && n.textContent.trim() && n.textContent.trim() === [...n.querySelectorAll('em,i')].map(e => e.textContent).join('').trim()) {
          const cap = document.createElement('figcaption'); cap.textContent = n.textContent.trim(); fig.appendChild(cap); n.remove();
        }
        return;
      }
      f.remove();
    });
  }
  root.querySelectorAll('p').forEach(p => { if (!p.textContent.trim() && !p.querySelector('img')) p.remove(); });
  insertPrices(root, key);
  return root.innerHTML;
}
// client prices 25.11: old price lines leave the text, data/prices.json renders as cards in the price chapter
function priceSet(key) {
  const p = PRICES && PRICES.services[key];
  if (!p) return null;
  const pack = p.packs ? PRICES.packs[p.packs] : null;
  return { items: [...(pack ? pack.items : []), ...(p.items || []), ...(p.extra || [])], note: p.note || (pack && pack.note) || '', more: p.more };
}
const priceBlock = set => `<div class="prices"><div class="prices__grid">${set.items.map(i => `<div class="price-card${i.hit ? ' is-hit' : ''}"><span class="price-card__name">${esc(i.name)}</span><b class="price-card__price">${esc(i.price).replace(/(\d) (?=\d)/g, '$1 ').replace(/ ₽/g, ' ₽')}</b>${i.unit ? `<span class="price-card__unit">${esc(i.unit)}</span>` : ''}</div>`).join('')}</div>${set.note ? `<p class="prices__note">${esc(set.note)}</p>` : ''}${set.more ? `<p class="prices__more"><a href="${SVC_URL(set.more)}">Пакеты SEO с технической поддержкой →</a></p>` : ''}</div>`;
function insertPrices(root, key) {
  const set = priceSet(key);
  if (!set) return;
  root.querySelectorAll('blockquote').forEach(b => { if (/\d[\d\s ]*(₽|руб)/i.test(b.textContent)) b.remove(); });
  root.querySelectorAll('table').forEach(t => { if (/Пакет 10 часов/.test(t.textContent)) (t.closest('.table-wrap') || t).remove(); });
  root.querySelectorAll('p').forEach(p => { if (/^Цены за настройку и ведение|каждый дополнительный час оплачивается/.test(p.textContent.trim())) p.remove(); });
  const tpl = document.createElement('div'); tpl.innerHTML = priceBlock(set);
  const h = [...root.querySelectorAll('h2')].find(x => /^\s*(Цены|Сколько стоит|Стоимость)/i.test(x.textContent));
  if (h) h.after(tpl.firstChild);
  else { const h2 = document.createElement('h2'); h2.textContent = 'Цены'; root.append(h2, tpl.firstChild); }
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
const shy = text => esc(text); // client edits 25.11: no word breaks in headings at all — main.js shrinks long words instead
// the old CMS glued the project props and buttons onto the task text
const cleanTask = t => (t || '').replace(/\s*(Сфера|Сайт|Дата)\s.*$/s, '').replace(/\s*(Заказать проект|Задать вопрос).*$/s, '').trim();
// client edits 25.11: typos fixed on top of the 1:1 case texts (the old site has them too)
const CASE_FIXES = {
  'obrashcheniya-po-36-rubley-v-nishe-fitnes-klub': [['450-650 ₽.На данный момент', '450-650 ₽. На данный момент'], ['Фитнес-кубы', 'Фитнес-клубы']],
};
function fixCases(cases) {
  for (const c of cases) for (const [from, to] of CASE_FIXES[c.slug] || []) {
    const before = JSON.stringify(c);
    c.html = c.html.split(from).join(to);
    Object.keys(c.props).forEach(k => (c.props[k] = c.props[k].split(from).join(to)));
    if (JSON.stringify(c) === before) log(`WARN case fix not applied on ${c.slug}: ${from}`);
  }
}
const longTitle = (t, n = 55) => t.length > n || Math.max(...t.split(/\s+/).map(w => w.length)) >= 13;
const firstText = html => { const d = document.createElement('div'); d.innerHTML = html; const p = [...d.querySelectorAll('p')].find(x => x.textContent.trim().length > 60); return p ? p.textContent.trim() : ''; };

/* ---------- chrome ---------- */
const NAV = [['services/index.html', 'Услуги', 'services'], ['cases/index.html', 'Кейсы', 'cases'], ['about.html', 'О нас', 'about'], ['blog/index.html', 'Блог', 'blog'], ['contacts.html', 'Контакты', 'contacts']];
// footer: the old site's company section stays linked from every page
const FOOT = [['company/reviews/', 'Отзывы клиентов'], ['company/partners/', 'Технологии разработки'], ['company/vacancy/', 'Вакансии'], ['company/requisites/', 'Реквизиты']];
const PHONE = '+7 800 222-46-04';
const ADDRESS = { '@type': 'PostalAddress', streetAddress: 'ул. Красная, 155/2, 7 этаж', addressLocality: 'Краснодар', addressRegion: 'Краснодарский край', addressCountry: 'RU' };
const ORG = {
  '@type': 'Organization', '@id': SITE + '#org', name: 'Nuts Digital Agency', alternateName: ['NUTS', 'Nuts Agency'], url: SITE,
  logo: { '@type': 'ImageObject', url: SITE + 'assets/logo-mark-hd.png', width: 644, height: 752 },
  email: 'info@nuts-agency.ru', telephone: PHONE, address: ADDRESS, foundingDate: '2017',
  sameAs: ['https://vk.com/nutsdigital', 'https://t.me/nutsdigitalagency'],
};
const OFFICE = {
  '@type': 'ProfessionalService', '@id': SITE + '#office', name: 'Nuts Digital Agency', url: SITE, image: SITE + 'assets/og.png',
  telephone: PHONE, email: 'info@nuts-agency.ru', address: ADDRESS, priceRange: '₽₽',
  geo: { '@type': 'GeoCoordinates', latitude: 45.049593, longitude: 38.977031 },
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00' }],
  parentOrganization: { '@id': SITE + '#org' },
};
const PUBLISHER = { '@id': SITE + '#org' };
// Yandex.Metrika of the old site (counter 48404891) — only on the production domain, never on test or locally
const METRIKA = `<script>
if (/^(www\\.)?nuts-agency\\.ru$/.test(location.hostname)) {
  (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();
  for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
  (window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  ym(48404891, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
}
</script>`;

// pages are queued and rendered at the end, when every page's name is known (breadcrumbs)
const QUEUE = [];
const NAMES = {}; // out path -> short name for breadcrumbs
function page(opts) {
  const out = opts.base ? opts.path : (route(opts.path) ?? opts.path);
  const meta = SEO.pages['/' + out];
  NAMES[out] = opts.name || (meta && meta.h1[0]) || opts.title;
  QUEUE.push({ ...opts, out });
}
const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const absUrl = (out, file) => SITE + (file ? file.replace(/^(\.\.\/)+/, '') : out);
function crumbsOf(out) {
  const segs = out.split('/').filter(Boolean);
  const list = [{ name: 'Главная', out: '' }];
  for (let i = 1; i <= segs.length; i++) {
    const o = segs.slice(0, i).join('/') + '/';
    if (NAMES[o]) list.push({ name: NAMES[o], out: o });
  }
  return list;
}
function renderPage({ out, title, desc, active, main, before = '', image, base, ld = [], ogType = 'website', redirect }) {
  const file = fileOf(out);
  const depth = base ? 0 : file.split('/').length - 1;
  const p = depth ? '../'.repeat(depth) : '';
  const meta = SEO.pages['/' + out];
  // the old site's title and description win: search engines already know the pages by them
  if (meta && meta.title) title = meta.title;
  if (meta && meta.description) desc = meta.description;
  const url = SITE + out;
  const og = SITE + (image || 'assets/og.png');
  const robots = INDEX ? '' : '\n  <meta name="robots" content="noindex, nofollow">';
  if (redirect) {
    // duplicates of the old site (same page under two addresses): point visitors and robots to the main one
    pages[file] = `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><meta name="robots" content="noindex, follow"><link rel="canonical" href="${SITE + redirect}"><meta http-equiv="refresh" content="0; url=${p}${redirect}"></head><body><a href="${p}${redirect}">${esc(title)}</a></body></html>\n`;
    return;
  }
  const crumbs = crumbsOf(out);
  const graph = [...(out ? [] : [ORG, OFFICE, { '@type': 'WebSite', '@id': SITE + '#site', url: SITE, name: 'Nuts Digital Agency', inLanguage: 'ru', publisher: PUBLISHER }]), ...ld];
  if (out) graph.push({ '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.out })) });
  const nav = NAV.map(([href, label, key]) => `<a href="${href}"${key === active ? ' class="is-active"' : ''} data-cursor="hover">${label}</a>`).join('\n    ');
  const chrome = `
<header class="header" id="header">
  <a href="index.html" class="logo" aria-label="NUTS — на главную">
    <img src="assets/logo-mark.png" class="logo__mark" alt="" width="161" height="188"><img src="assets/logo-word.png" class="logo__word" alt="NUTS digital agency" width="325" height="188">
  </a>
  <nav class="nav" id="nav">
    ${nav}
  </nav>
  <div class="header__right">
    <a href="tel:88002224604" class="header__phone">8 800 222-46-04</a>
    <a href="contacts.html#brief" class="btn btn--sm magnetic" data-cursor="hover"><span>Обсудить проект</span></a>
    <button class="burger" id="burger" aria-label="Меню"><i></i><i></i></button>
  </div>
</header>
<div class="menu" id="menu">
  <nav class="menu__nav">${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>
  <div class="menu__foot"><a href="tel:88002224604">8 800 222-46-04</a><a href="mailto:info@nuts-agency.ru">info@nuts-agency.ru</a></div>
</div>
${before}
<main>
${main}
</main>

<footer class="footer">
  <div class="footer__big" aria-hidden="true"><span>N</span><span>U</span><span>T</span><span>S</span></div>
  <div class="footer__links">${FOOT.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</div>
  <div class="footer__row">
    <span>© 2017–2026 Nuts Digital Agency · Краснодар, ул. Красная, 155/2</span>
    <nav>${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</nav>
    <a href="#" class="footer__up" data-cursor="hover">Наверх ↑</a>
  </div>
</footer>`;
  const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">${robots}
  <link rel="canonical" href="${url}">${base ? `\n  <base href="${base}">` : ''}
  <meta property="og:locale" content="ru_RU">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="Nuts Digital Agency">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${og}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0d0d0d">
  <script>document.documentElement.classList.add('intro-wait');setTimeout(function(){document.documentElement.classList.remove('intro-wait')},4000)</script>
  <link rel="stylesheet" href="${p}vendor/fonts/fonts.css">
  <link rel="stylesheet" href="${p}css/style.css?v=${VER}">
  <link rel="stylesheet" href="${p}css/pages.css?v=${VER}">
  <link rel="icon" href="${p}favicon.ico" sizes="any">
  <link rel="icon" href="${p}assets/logo-mark.png" type="image/png">
  <link rel="apple-touch-icon" href="${p}assets/apple-touch-icon.png">
  ${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}
</head>
<body>

${relink(chrome, depth)}

<div class="grain" aria-hidden="true"></div>
<script src="${p}vendor/gsap.min.js"></script>
<script src="${p}vendor/ScrollTrigger.min.js"></script>
<script src="${p}vendor/lenis.min.js"></script>
<script src="${p}js/main.js?v=${VER}"></script>
${METRIKA}
</body>
</html>
`;
  pages[file] = html;
}

/* ---------- shared blocks ---------- */
// h1: the descriptive heading search engines knew on the old site; when the design shows a playful
// display title instead, the h1 sits above it as a small kicker and the display title becomes a <p>
const hero = ({ crumbs, tags = '', title, titleHtml, lead = '', after = '', sm, h1 }) => `
<section class="page-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <div class="page-hero__rings" aria-hidden="true"><i></i><i></i></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a>${crumbs.map(([h, t]) => h ? `<span><a href="${h}">${esc(t)}</a></span>` : `<span>${esc(t)}</span>`).join('')}</nav>
  ${tags ? `<div class="tags" data-in style="position:relative;margin-bottom:28px">${tags}</div>` : ''}
  ${h1 && h1 !== title ? `<h1 class="page-h1" data-in>${esc(h1)}</h1>
  <p class="page-title${sm ? ' page-title--sm' : ''}"><span class="line"><span class="split">${titleHtml || shy(title)}</span></span></p>` : `<h1 class="page-title${sm ? ' page-title--sm' : ''}"><span class="line"><span class="split">${titleHtml || shy(title)}</span></span></h1>`}
  ${lead ? `<p class="page-lead" data-in>${esc(lead)}</p>` : ''}
  ${after}
</section>`;

const caseCard = (c, wide) => `
    <a class="case${wide ? ' case--wide' : ''}" data-cat="${CASE_FILTER[c.cat]}" href="cases/${c.slug}.html" data-cursor="view">
      <div class="case__media"><img src="${c.cover}" alt="${esc(c.title)}" loading="lazy"></div>
      <div class="case__meta"><span>${CASE_CATS[c.cat]}</span><span>${esc(c.props['Сфера'] || '')}</span></div>
      <h3 class="case__title">${esc(c.title)}</h3>
    </a>`;

// client review on a case page: compact card, with the thank-you letter attached when the old site had one
const reviewCard = r => `
<section class="review-card" data-in>
  <span class="eyebrow">Отзыв клиента</span>
  <blockquote>${(r.paras && r.paras.length ? r.paras : [r.text]).map(t => `<p>${esc(t)}</p>`).join('')}</blockquote>
  <div class="review-card__foot">
    <div class="review-card__who"><b>${esc(r.name)}</b><span>${esc(r.role)}</span></div>
    ${(r.docs || []).map(d => `<a class="doc-link" href="${esc(d.href)}" target="_blank" rel="noopener" data-cursor="hover"><i aria-hidden="true">PDF</i><span><b>${esc(d.title)}</b>${d.size ? `<small>${esc(d.size)}</small>` : ''}</span></a>`).join('')}
  </div>
</section>`;

const nextCard = n => `
<a class="next next--sm" href="cases/${n.slug}.html" data-cursor="view">
  <div class="next__img"><img src="${n.cover}" alt="${esc(n.title)}" loading="lazy"></div>
  <div><span class="next__label">Следующий кейс →</span><h2 class="next__title">${esc(n.title)}</h2></div>
</a>`;

const postCard = a => `
    <a href="blog/${a.slug}.html" class="post" data-cat="${a.cat}" data-cursor="read">
      <div class="post__img">${a.cover && FILES.has(a.cover.replace('assets/content/', '')) ? `<img src="${a.cover}" alt="${esc(a.title)}" loading="lazy">` : `<div class="post__art post__art--1"><span>${esc((POST_CATS[a.cat] || '').slice(0, 3))}</span></div>`}</div>
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
          ${['до 300к', '300к – 1м', '1м+', 'All-in ♠'].map(v => `<label><input type="radio" name="budget" value="${v}"><span>${v}</span></label>`).join('\n          ')}
        </div>
      </fieldset>
      <div class="field" data-error="Как к вам обращаться?"><input id="fName" name="name" required placeholder=" " autocomplete="name"><label for="fName">Как вас зовут</label></div>
      <div class="field" data-error="Телефон, @ник в Telegram или почта"><input id="fContact" name="contact" required placeholder=" " autocomplete="tel"><label for="fContact">Телефон или Telegram</label></div>
      <div class="field"><textarea id="fMsg" name="msg" rows="3" placeholder=" "></textarea><label for="fMsg">Пара слов о задаче</label></div>
      <button type="submit" class="btn btn--orange btn--wide magnetic" data-cursor="hover"><span>Отправить и расколоть</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      <input type="text" name="_honey" class="brief__hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="brief__note">Нажимая кнопку, вы соглашаетесь с политикой обработки персональных данных.</p>
      <p class="brief__error" role="alert" hidden>Не получилось отправить. Напишите нам на <a href="mailto:info@nuts-agency.ru">info@nuts-agency.ru</a> или позвоните 8 800 222-46-04.</p>
      <div class="brief__done"><img src="assets/logo-mark.png" alt=""><h3>Орех принят!</h3><p>Скоро свяжемся.</p></div>
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
const seoH1 = out => { const m = SEO.pages['/' + out]; return m && m.h1[0] ? m.h1[0] : ''; };
// "26.06.2025" / "26 Июня 2025" -> "2025-06-26"
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const isoDate = s => {
  let m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = String(s || '').toLowerCase().match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/);
  if (m && MONTHS.indexOf(m[2]) >= 0) return `${m[3]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
};
// pictures whose alt is a file name ("brandbook.jpg") get their caption or the page title instead
function fixAlts(html, fallback) {
  const d = document.createElement('div'); d.innerHTML = html;
  d.querySelectorAll('img').forEach(img => {
    const alt = (img.getAttribute('alt') || '').trim();
    if (alt && !/\.(jpe?g|png|gif|webp|svg)$/i.test(alt) && !/^[\w\s()-]+$/.test(alt)) return;
    const cap = img.closest('figure')?.querySelector('figcaption')?.textContent.trim();
    img.setAttribute('alt', cap || fallback);
  });
  return d.innerHTML;
}
const filterLinks = (base, cats, labels, current, counts) => `<nav class="filters" data-in style="position:relative;margin-top:36px" aria-label="Разделы">
    <a class="filter${current ? '' : ' is-active'}" href="${base}">Все${counts ? ' · ' + counts.all : ''}</a>
    ${cats.map(k => `<a class="filter${k === current ? ' is-active' : ''}" href="${base}${k}/">${labels[k] || k}${counts ? ' · ' + counts[k] : ''}</a>`).join('\n    ')}
  </nav>`;

async function buildCases() {
  const cases = D.cases;
  const cats = Object.keys(CASE_CATS);
  const counts = { all: cases.length, ...Object.fromEntries(cats.map(k => [k, cases.filter(c => c.cat === k).length])) };
  const listPage = cat => {
    const list = cat ? cases.filter(c => c.cat === cat) : cases;
    const out = cat ? `projects/${cat}/` : 'projects/';
    page({
      path: out, name: cat ? CASE_CATS[cat] : 'Кейсы', title: `Кейсы${cat ? ' — ' + CASE_CATS[cat] : ''} — NUTS`, desc: `${list.length} проектов NUTS: разработка, реклама, SEO и SMM для бизнеса.`, active: 'cases',
      main: hero({ crumbs: cat ? [['cases/index.html', 'Кейсы'], [null, CASE_CATS[cat]]] : [[null, 'Кейсы']], h1: seoH1(out) || (cat ? CASE_CATS[cat] : 'Кейсы'), title: 'Расколотые орешки',
        lead: cat ? `${list.length} проектов в разделе «${CASE_CATS[cat]}».` : `${cases.length} проектов за 9 лет: сайты и приложения, реклама, SEO и соцсети для девелоперов, клиник, ритейла и производств.`,
        after: filterLinks('projects/', cats, CASE_CATS, cat, counts) }) + `
<section class="section" style="padding-top:0">
  <div class="cases__grid">${list.map(c => caseCard(c)).join('')}
  </div>
</section>` + ctaBand(),
      ld: [{ '@type': 'CollectionPage', name: seoH1(out) || 'Кейсы', url: SITE + out, isPartOf: { '@id': SITE + '#site' }, mainEntity: { '@type': 'ItemList', itemListElement: list.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + caseUrl(c), name: c.title })) } }],
    });
  };
  listPage(null);
  cats.forEach(listPage);

  for (const [i, c] of cases.entries()) {
    const path = `cases/${c.slug}.html`;
    const task = cleanTask(c.task);
    const desc = cut([task, firstText(normalize(c.html, true))].filter(Boolean).join(" "), 160) || cut(strip(c.html), 160);
    let main = await custom(path);
    if (!main) {
      const body = fixAlts(normalize(c.html, true), c.title);
      const list = chapters(body, 'О проекте');
      const facts = [['Направление', CASE_CATS[c.cat]], ...Object.entries(c.props)].filter(([, v]) => v);
      const sameCat = cases.filter(x => x.cat === c.cat && x !== c);
      const similar = [...c.similar.map(u => cases.find(x => x.url === u)).filter(Boolean), ...sameCat].filter((x, k, arr) => arr.indexOf(x) === k).slice(0, 3);
      const nextC = cases.slice(i + 1).find(x => x.cat === c.cat) || sameCat[0];
      main = hero({ crumbs: [['cases/index.html', 'Кейсы'], [`projects/${c.cat}/`, CASE_CATS[c.cat]]], tags: `<span class="is-hot">${CASE_CATS[c.cat]}</span>${c.props['Сфера'] ? `<span>${esc(c.props['Сфера'])}</span>` : ''}`, title: c.title, lead: task, sm: longTitle(c.title) }) + `
<div class="facts" data-in>
  ${facts.slice(0, 4).map(([k, v]) => `<div class="fact"><b>${esc(k)}</b>${k === 'Сайт' && /^https?:/.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener nofollow" data-cursor="hover">${esc(v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))} ↗</a>` : `<span>${esc(v)}</span>`}</div>`).join('\n  ')}
</div>
${list.length ? chapterHtml(list) : ''}
${c.review ? reviewCard(c.review) : ''}
${nextC && nextC !== c ? nextCard(nextC) : ''}
${similar.length ? `<section class="section" style="padding-top:clamp(40px,5vw,80px);padding-bottom:0">
  <div class="section__head section__head--row" style="margin-bottom:36px"><h2 class="h3">Похожие проекты</h2><a href="cases/index.html" class="link-arrow" data-cursor="hover">Все кейсы →</a></div>
  <div class="cases__grid">${similar.map(x => caseCard(x)).join('')}</div>
</section>` : ''}
${ctaBand('Хотите так же? Расколем и&nbsp;ваш орешек')}`;
    }
    const url = SITE + caseUrl(c);
    page({ path, name: c.title, title: `${c.title} — кейс NUTS`, desc, active: 'cases', main, image: c.cover, ogType: 'article',
      ld: [{ '@type': 'Article', headline: cut(c.title, 110), description: desc, image: SITE + c.cover, url, mainEntityOfPage: url, datePublished: isoDate(c.props['Дата']), author: PUBLISHER, publisher: PUBLISHER, about: c.props['Сфера'] || undefined, inLanguage: 'ru' }] });
  }
  // the old site shows two SMM cases under /projects/smm/ as well — those addresses lead to the main page
  for (const slug of ['video-o-kompanii-tochka-molochka', 'kak-menshe-chem-za-god-nabrat-14-mln-prosmotrov-v-tiktok-']) {
    const c = cases.find(x => x.slug === slug);
    if (c && c.cat !== 'smm') page({ path: `projects/smm/${slug}/`, name: c.title, title: c.title, desc: '', main: '', redirect: caseUrl(c) });
  }
}

async function buildServices() {
  const S = D.services;
  const sections = SECTION_ORDER.map(k => ({ key: k, page: S.find(s => s.section === k && !s.slug), subs: S.filter(s => s.section === k && s.slug) }));
  page({
    path: 'services/index.html', name: 'Услуги', title: 'Услуги — NUTS', desc: 'Разработка сайтов и приложений, реклама, SEO, SMM, IT-решения и поддержка. Полный цикл digital.', active: 'services',
    main: hero({ crumbs: [[null, 'Услуги']], h1: seoH1('services/') || 'Услуги', title: 'Что мы колем', titleHtml: 'Что мы <span class="orange">колем</span>', lead: 'Полный цикл: от стратегии и дизайна до трафика и поддержки. Можно целиком, можно по кусочку.' }) + `
<section class="section" style="padding-top:0">
  <div class="svc-list">
${sections.map((s, i) => `    <article class="svc-block">
      <div class="svc-block__head">
        <span class="svc__n">${String(i + 1).padStart(2, '0')}</span>
        <h2 class="svc-block__title"><a href="services/${s.key}.html">${esc(SECTIONS[s.key].label)}</a></h2>
        <div class="svc-block__subs">${s.subs.length ? s.subs.map(x => `<a href="services/${x.slug}.html">${esc(x.title)}</a>`).join('') : `<p>${esc(SECTIONS[s.key].short)}</p>`}</div>
        <a href="services/${s.key}.html" class="svc-block__arrow" aria-label="${esc(SECTIONS[s.key].label)}">→</a>
      </div>
    </article>`).join('\n')}
  </div>
</section>` + ctaBand(),
    ld: [{ '@type': 'ItemList', name: 'Услуги Nuts Digital Agency', itemListElement: S.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: SITE + svcUrl(s.slug || s.section), name: s.title })) }],
  });

  for (const s of S) {
    const key = s.slug || s.section;
    const path = `services/${key}.html`;
    const sec = SECTIONS[s.section];
    const body = fixAlts(cleanService(normalize(fixService(s.html, key)), key), s.title);
    const lead = cut(firstText(body), 220);
    const desc = cut(firstText(body), 160) || `${s.title} от NUTS: ${sec.short} Под задачи бизнеса — в Краснодаре и по всей России.`;
    let main = await custom(path);
    if (main) {
      // handcrafted page: its price cards are rendered here from data/prices.json too
      const set = priceSet(key);
      main = main.replace('<!-- @prices -->', set ? priceBlock(set) : '');
    } else {
      const subs = s.slug ? [] : S.filter(x => x.section === s.section && x.slug);
      const siblings = s.slug ? S.filter(x => x.section === s.section && x.slug && x !== s) : [];
      const list = chapters(body, 'Об услуге');
      const rel = D.cases.filter(c => c.cat === sec.cases).slice(0, 4);
      main = hero({ crumbs: [['services/index.html', 'Услуги'], ...(s.slug ? [[`services/${s.section}.html`, sec.label]] : []), [null, s.title]], tags: `<span class="is-hot">${esc(sec.label)}</span>`, title: s.title, lead,
        after: `<div class="svc-hero__ctas" data-in style="position:relative;margin-top:32px"><a href="#brief" class="btn btn--orange magnetic" data-cursor="hover"><span>Обсудить задачу</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>${rel.length ? '<a href="#svc-cases" class="btn btn--ghost magnetic" data-cursor="hover"><span>Кейсы</span></a>' : ''}</div>`, sm: longTitle(s.title, 40) }) + `
${subs.length ? `<section class="section section--light" style="margin-top:clamp(40px,6vw,80px)">
  <div class="section__head"><span class="eyebrow">Направления</span><h2 class="h2">Выберите<br><span class="orange">свой орех</span></h2></div>
  <div class="kinds">${subs.map((x, i) => `
    <a class="kind" href="services/${x.slug}.html" data-cursor="hover">
      <span class="kind__ico">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(x.title)}</h3>
      <p>${esc(cut(firstText(normalize(x.html)), 130))}</p>
      <div class="kind__term"><span>Подробнее</span><b>→</b></div>
    </a>`).join('')}
  </div>
</section>` : ''}
${list.length ? chapterHtml(list) : ''}
${rel.length ? `<section class="section" id="svc-cases"${list.length ? ' style="padding-top:0"' : ''}>
  <div class="section__head section__head--row"><div><span class="eyebrow">Кейсы</span><h2 class="h2">Уже <span class="orange">раскололи</span></h2></div><a href="projects/${sec.cases}/" class="link-arrow" data-cursor="hover">Все кейсы →</a></div>
  <div class="cases__grid">${rel.slice(0, 3).map(c => caseCard(c)).join('')}</div>
</section>` : ''}
${siblings.length ? `<section class="section" style="padding-top:0">
  <div class="section__head" style="margin-bottom:36px"><h2 class="h3">Ещё в разделе «${esc(sec.label)}»</h2></div>
  <div class="kinds kinds--dark">${siblings.map((x, i) => `
    <a class="kind" href="services/${x.slug}.html">
      <span class="kind__ico">${String(i + 1).padStart(2, '0')}</span>
      <h3>${esc(x.title)}</h3>
      <p>${esc(cut(firstText(cleanService(normalize(x.html), x.slug)), 130))}</p>
      <div class="kind__term"><span>Подробнее</span><b>→</b></div>
    </a>`).join('')}
  </div>
</section>` : ''}
${BRIEF}`;
    }
    // Service + its prices as offers
    const set = priceSet(key);
    const num = p => { const m = String(p).replace(/\s| /g, '').match(/(\d+)/); return m && !/%/.test(p) ? Number(m[1]) : null; };
    const offers = set ? set.items.map(i => ({ i, n: num(i.price) })).filter(x => x.n).map(({ i, n }) => ({ '@type': 'Offer', name: i.name, priceCurrency: 'RUB', price: n, priceSpecification: { '@type': 'UnitPriceSpecification', price: n, priceCurrency: 'RUB', ...(/месяц/.test(i.unit || '') ? { unitText: 'месяц' } : /час/.test(i.unit || '') ? { unitText: 'час' } : {}), ...(/^от/i.test(i.price) ? { minPrice: n } : {}) } })) : [];
    const url = SITE + svcUrl(key);
    page({ path, name: s.title, title: `${s.title} — NUTS`, desc, active: 'services', main,
      ld: [{ '@type': 'Service', name: seoH1(svcUrl(key)) || s.title, serviceType: sec.label, description: desc, url, provider: { '@id': SITE + '#office' }, areaServed: [{ '@type': 'City', name: 'Краснодар' }, { '@type': 'Country', name: 'Россия' }], ...(offers.length ? { offers } : {}) }] });
  }
}

async function buildBlog() {
  const A = D.articles;
  const cats = [...new Set(A.map(a => a.cat))];
  const lc = Object.fromEntries(cats.map(c => [lowerCat(c), POST_CATS[c] || c]));
  const listPage = cat => {
    const list = cat ? A.filter(a => lowerCat(a.cat) === cat) : A;
    const out = cat ? `articles/${cat}/` : 'articles/';
    const [first, ...rest] = list;
    page({
      path: out, name: cat ? lc[cat] : 'Блог', title: 'Блог — NUTS', desc: 'Статьи NUTS о сайтах, SEO, соцсетях, дизайне и digital-маркетинге.', active: 'blog',
      main: `
<section class="page-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <div class="page-hero__rings" aria-hidden="true"><i></i><i></i></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a>${cat ? `<span><a href="blog/index.html">Блог</a></span><span>${esc(lc[cat])}</span>` : '<span>Блог</span>'}</nav>
  <h1 class="page-h1" data-in>${esc(seoH1(out) || (cat ? lc[cat] : 'Блог'))}</h1>
  <div class="blog-top">
    <p class="page-title"><span class="line"><span class="split">Орехи</span></span><span class="line"><span class="split orange">для ума</span></span></p>
    ${filterLinks('articles/', Object.keys(lc), lc, cat).replace(' style="position:relative;margin-top:36px"', '')}
  </div>
  <p class="page-lead" data-in>Пишем о том, что делаем каждый день: сайты, SEO, соцсети, дизайн и digital-маркетинг. Без воды — только ядро.</p>
</section>
<a class="feature" href="blog/${first.slug}.html" data-cursor="read">
  <div class="feature__img"><img src="${first.cover}" alt="${esc(first.title)}"></div>
  <div class="feature__body">
    <div class="meta"><span class="cat">${POST_CATS[first.cat]}</span><span>${esc(first.date)}</span></div>
    <h2>${esc(first.title)}</h2>
    <p>${esc(cut(firstText(normalize(first.html)), 200))}</p>
    <span class="link-arrow" style="align-self:flex-start">Читать →</span>
  </div>
</a>
${rest.length ? `<section class="section" style="padding-top:clamp(60px,8vw,110px)">
  <div class="posts">${rest.map(postCard).join('')}
  </div>
</section>` : ''}
<section class="subscribe">
  <img src="assets/logo-mark.png" class="subscribe__nut" alt="" aria-hidden="true">
  <div><h2>Орехи — <span class="orange">в Telegram</span></h2><p>Новые статьи, кейсы и закулисье агентства. Без спама, только ядро.</p></div>
  <a href="https://t.me/nutsdigitalagency" target="_blank" rel="noopener" class="btn btn--orange magnetic" data-cursor="hover"><span>Подписаться</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
</section>` + ctaBand('Хватит читать — давайте делать'),
      ld: [{ '@type': 'Blog', name: 'Блог Nuts Digital Agency', url: SITE + out, publisher: PUBLISHER, blogPost: list.map(a => ({ '@type': 'BlogPosting', headline: a.title, url: SITE + postUrl(a) })) }],
    });
  };
  listPage(null);
  Object.keys(lc).forEach(listPage);

  for (const a of A) {
    const path = `blog/${a.slug}.html`;
    const body = fixAlts(normalize(a.html), a.title);
    const desc = cut(firstText(body), 160);
    const url = SITE + postUrl(a);
    let main = await custom(path);
    if (!main) {
      const root = document.createElement('div'); root.innerHTML = body;
      const toc = [];
      root.querySelectorAll('h2, h3').forEach((h, i) => { h.id = 's' + (i + 1); toc.push(`<a href="#${h.id}"${h.tagName === 'H3' ? ' class="sub"' : ''} data-cursor="hover">${esc(cut(h.textContent.trim(), 60))}</a>`); });
      const related = [...A.filter(x => x !== a && x.cat === a.cat), ...A.filter(x => x !== a && x.cat !== a.cat)].slice(0, 3);
      const share = encodeURIComponent(url);
      main = `
<section class="page-hero article-hero">
  <div class="page-hero__glow" aria-hidden="true"></div>
  <nav class="crumbs" data-in><a href="index.html">Главная</a><span><a href="blog/index.html">Блог</a></span><span><a href="articles/${lowerCat(a.cat)}/">${POST_CATS[a.cat] || a.cat}</a></span></nav>
  <div class="meta" data-in><span class="cat">${POST_CATS[a.cat] || a.cat}</span><time datetime="${isoDate(a.date) || ''}">${esc(a.date)}</time><span>${Math.max(1, Math.round(root.textContent.split(/\s+/).length / 180))} мин чтения</span></div>
  <h1 class="page-title page-title--sm"><span class="line"><span class="split">${shy(a.title)}</span></span></h1>
  <div class="author" data-in><span class="author__ava">N</span><div><b>Команда NUTS</b><span>Digital-агентство полного цикла</span></div></div>
</section>
${a.cover && FILES.has(a.cover.replace('assets/content/', '')) ? `<figure class="cover"><img src="${a.cover}" alt="${esc(a.title)}"></figure>` : ''}
<div class="article">
  <aside class="toc">
    ${toc.length > 1 ? `<span class="toc__title">Содержание</span>\n    ${toc.join('\n    ')}` : ''}
    <div class="share">
      <a href="https://t.me/share/url?url=${share}" target="_blank" rel="noopener nofollow" data-cursor="hover">Telegram</a>
      <a href="https://vk.com/share.php?url=${share}" target="_blank" rel="noopener nofollow" data-cursor="hover">VK</a>
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
    page({ path, name: a.title, title: `${a.title} — блог NUTS`, desc, active: 'blog', main, before: '<div class="readbar" id="readBar" aria-hidden="true"></div>', image: a.cover, ogType: 'article',
      ld: [{ '@type': 'BlogPosting', headline: cut(a.title, 110), description: desc, image: a.cover ? SITE + a.cover : undefined, url, mainEntityOfPage: url, datePublished: isoDate(a.date), author: PUBLISHER, publisher: PUBLISHER, inLanguage: 'ru' }] });
  }
  // the old "Реклама" blog category has no articles: its address leads to the blog
  page({ path: 'articles/elektronnaya-kommertsiya/', name: 'Реклама', title: 'Реклама', desc: '', main: '', redirect: 'articles/' });
}

function buildAbout() {
  const reviews = D.cases.filter(c => c.review);
  page({
    path: 'about.html', name: 'О компании', title: 'О компании — NUTS', desc: 'Nuts Digital Agency — digital-агентство полного цикла из Краснодара. С 2017 года делаем сайты, рекламу, SEO и SMM.', active: 'about',
    main: hero({ crumbs: [[null, 'О нас']], h1: seoH1('company/') || 'О компании', title: 'Привет! Мы Nuts', titleHtml: 'Привет! <span class="orange">Мы Nuts</span>', lead: 'Безумцы в стиле digital. В 2017 году Костя и Данил Квашины открыли агентство полного цикла — и с тех пор превращаем нереальное в реальное.' }) + `
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
<section class="section" style="padding-top:0">
  <div class="section__head" style="margin-bottom:36px"><h2 class="h3">Ещё о компании</h2></div>
  <div class="kinds kinds--dark">${FOOT.map(([href, label], i) => `
    <a class="kind" href="${href}"><span class="kind__ico">${String(i + 1).padStart(2, '0')}</span><h3>${label}</h3><div class="kind__term"><span>Подробнее</span><b>→</b></div></a>`).join('')}
  </div>
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
<section class="clients" style="padding-top:clamp(64px,8vw,110px)">
  <p class="clients__cap">Нас выбирают те, кто готов к успеху</p>
  <div class="ticker"><div class="ticker__track">
    ${(() => { const l = ['Девелопмент-Юг', 'Черкизово', 'DOGMA', 'КЛЮЧАВТО', 'СБС Мегамолл', 'МНТК «Микрохирургия глаза»', 'СК Семья', 'Алкотека', 'Лефкадия', 'Schaumann', 'Точка Молочка', 'Арт-Сайд'].map(x => `<span>${x}</span>`).join(''); return l + l; })()}
  </div></div>
</section>` + ctaBand('Познакомимся поближе?'),
    ld: [{ '@type': 'AboutPage', url: SITE + 'company/', name: 'О компании Nuts Digital Agency', mainEntity: { '@id': SITE + '#org' } }],
  });
}

// the old site's company section: technologies, vacancies, requisites, reviews (data/pages.json, tools/import-pages.html)
function buildCompany() {
  const P = PAGES;
  const sub = (out, name, crumbs, main, ld = []) => page({ path: out, name, title: (P['/' + out] || {}).title || name, desc: (P['/' + out] || {}).description || '', active: 'about', main, ld });
  const about = ['about.html', 'О нас'];
  const prose = html => `<section class="chapters" style="padding-top:0"><article class="chapter chapter--wide"><div class="chapter__body prose">${fixAlts(normalize(html), 'Nuts Digital Agency')}</div></article></section>`;
  // technologies
  const tech = P['/company/partners/'];
  if (tech) {
    sub('company/partners/', 'Технологии разработки', null, hero({ crumbs: [about, [null, 'Технологии']], h1: tech.h1, title: 'Чем колем', titleHtml: 'Чем <span class="orange">колем</span>', lead: 'Фреймворки, CMS и сервисы, на которых мы делаем сайты, приложения и порталы.' }) + `
<section class="section" style="padding-top:0">
  <div class="tech-grid">${tech.items.map(t => `
    <a class="tech" href="${t.href || '#'}" data-cursor="hover"><span class="tech__logo">${t.logo ? `<img src="${t.logo}" alt="${esc(t.name)}">` : ''}</span><b>${esc(t.name)}</b><span class="tech__more">Подробнее →</span></a>`).join('')}
  </div>
</section>` + ctaBand(), [{ '@type': 'ItemList', name: tech.h1, itemListElement: tech.items.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: mapOldUrl(t.href) !== null ? SITE + mapOldUrl(t.href) : undefined })) }]);
    for (const t of tech.items) {
      const out = mapOldUrl(t.href);
      const d = P['/' + out];
      if (!d) continue;
      sub(out, d.h1, null, hero({ crumbs: [about, ['company/partners/', 'Технологии'], [null, d.h1]], title: d.h1 }) + prose(d.html) + `
<section class="section" style="padding-top:0"><a href="company/partners/" class="link-arrow">← Все технологии</a></section>` + ctaBand());
    }
  }
  // requisites
  const req = P['/company/requisites/'];
  if (req) sub('company/requisites/', 'Реквизиты', null, hero({ crumbs: [about, [null, 'Реквизиты']], title: req.h1 }) + prose(req.html));
  // reviews
  const rev = P['/company/reviews/'];
  if (rev) sub('company/reviews/', 'Отзывы клиентов', null, hero({ crumbs: [about, [null, 'Отзывы']], h1: rev.h1, title: 'Что говорят клиенты', lead: rev.intro }) + `
<section class="reviews-list">${rev.reviews.map(r => reviewCard(r).replace('<span class="eyebrow">Отзыв клиента</span>', '')).join('')}</section>` + ctaBand('Станете следующим?'));
  // vacancies
  const vac = P['/company/vacancy/'];
  if (vac) {
    sub('company/vacancy/', 'Вакансии', null, hero({ crumbs: [about, [null, 'Вакансии']], h1: vac.h1, title: 'Ищем безумцев', titleHtml: 'Ищем <span class="orange">безумцев</span>', lead: 'Офис в центре Краснодара, Красная, 155/2. Присылайте резюме на info@nuts-agency.ru.' }) + `
<section class="section" style="padding-top:0">
  <div class="vacancies">${vac.items.map(v => `
    <details class="vacancy">
      <summary><span class="vacancy__dep">${esc(v.department)}</span><b class="vacancy__name">${esc(v.name)}</b><span class="vacancy__pay">${esc(v.pay)}</span><i aria-hidden="true"></i></summary>
      <div class="vacancy__body prose">${normalize(v.html)}${v.href ? `<p><a href="${'https://nuts-agency.ru' + v.href}">Страница вакансии →</a></p>` : ''}</div>
    </details>`).join('')}
  </div>
</section>` + ctaBand('Хотите к нам? Пишите'));
    for (const out of ['company/vacancy/junior-seo/', 'company/vacancy/rukovoditel-proektov/', 'company/vacancy/seo-spetsialist-seo-optimizator/']) {
      const d = P['/' + out];
      if (d) sub(out, d.h1, null, hero({ crumbs: [about, ['company/vacancy/', 'Вакансии'], [null, d.h1]], title: d.h1 }) + prose(d.html) + `
<section class="section" style="padding-top:0"><a href="company/vacancy/" class="link-arrow">← Все вакансии</a></section>` + ctaBand('Откликнуться: info@nuts-agency.ru'));
    }
  }
}

function buildContacts() {
  page({
    path: 'contacts.html', name: 'Контакты', title: 'Контакты — NUTS', desc: 'Nuts Digital Agency: Краснодар, ул. Красная, 155/2, 7 этаж. 8 800 222-46-04, info@nuts-agency.ru.', active: 'contacts',
    main: hero({ crumbs: [[null, 'Контакты']], h1: 'Контакты', title: 'Давайте знакомиться', lead: 'Пока вы думаете — ваши конкуренты уже едут в наш офис.' }) + `
<section class="section" style="padding-top:0">
  <div class="contact-cards">
    <a class="contact-card" href="tel:88002224604" data-cursor="hover"><b>Телефон</b><span>8 800 222-46-04</span></a>
    <a class="contact-card" href="mailto:info@nuts-agency.ru" data-cursor="hover"><b>Почта</b><span>info@nuts-agency.ru</span></a>
    <a class="contact-card" href="https://yandex.ru/maps/?text=%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%BE%D0%B4%D0%B0%D1%80%2C%20%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F%20155%2F2" target="_blank" rel="noopener" data-cursor="open"><b>Офис</b><span>Краснодар, Красная, 155/2, 7 этаж ↗</span></a>
    <a class="contact-card" href="https://t.me/nutsdigitalagency" target="_blank" rel="noopener" data-cursor="hover"><b>Telegram</b><span>@nutsdigitalagency ↗</span></a>
  </div>
  <p class="contact-hours">Работаем пн–пт с 9:00 до 18:00.</p>
</section>
${BRIEF}`,
    ld: [{ '@type': 'ContactPage', url: SITE + 'contacts/', name: 'Контакты Nuts Digital Agency', mainEntity: { '@id': SITE + '#office' } }, OFFICE],
  });
}

// homepage: index.html is hand-made; the build relinks it and writes its head from the old site's meta
function buildHome(home) {
  const meta = SEO.pages['/'];
  home = relink(home, 0)
    .replace(/<a href="#services"( data-cursor="hover")?>Услуги<\/a>/g, '<a href="services/"$1>Услуги</a>')
    .replace(/<a href="#about"( data-cursor="hover")?>О нас<\/a>/g, '<a href="company/"$1>О нас</a>')
    .replace(/Все проекты — \d+\+?/, `Все проекты — ${D.cases.length}`)
    .replace(/ target="_blank" rel="noopener"( class="(?:case|post)[^"]*")/g, '$1');
  home = home.replace(/(href|src)="((?:css|js)\/[^"?]+)(?:\?v=[^"]*)?"/g, (m, a, f) => `${a}="${f}?v=${VER}"`);
  // everything between the SEO markers in <head> is written by the build
  const head = `<!-- @seo -->
  <title>${esc(meta.title)}</title>
  <meta name="description" content="${esc(meta.description)}">${INDEX ? '' : '\n  <meta name="robots" content="noindex, nofollow">'}
  <link rel="canonical" href="${SITE}">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Nuts Digital Agency">
  <meta property="og:title" content="${esc(meta.title)}">
  <meta property="og:description" content="${esc(meta.description)}">
  <meta property="og:url" content="${SITE}">
  <meta property="og:image" content="${SITE}assets/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="favicon.ico" sizes="any">
  <link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
  ${jsonLd({ '@context': 'https://schema.org', '@graph': [ORG, OFFICE, { '@type': 'WebSite', '@id': SITE + '#site', url: SITE, name: 'Nuts Digital Agency', inLanguage: 'ru', publisher: PUBLISHER }] })}
  <!-- /@seo -->`;
  if (!/<!-- @seo -->[\s\S]*?<!-- \/@seo -->/.test(home)) throw new Error('index.html: no <!-- @seo --> … <!-- /@seo --> markers in <head>');
  home = home.replace(/<!-- @seo -->[\s\S]*?<!-- \/@seo -->/, head);
  if (!home.includes('mc.yandex.ru')) home = home.replace('</body>', METRIKA + '\n</body>');
  pages['index.html'] = home;
}

/* ---------- run ---------- */
let PAGES;
async function run() {
  D = await (await fetch('../data/content.json?' + Date.now())).json();
  FILES = new Set(await (await fetch('../data/files.json?' + Date.now())).json());
  PRICES = await (await fetch('../data/prices.json?' + Date.now())).json();
  SEO = await (await fetch('../data/seo.json?' + Date.now())).json();
  PAGES = await (await fetch('../data/pages.json?' + Date.now())).json();
  log(`content: ${D.cases.length} cases, ${D.services.length} services, ${D.articles.length} articles, ${Object.keys(PAGES).length} company pages`);
  fixCases(D.cases);
  await buildCases(); await buildServices(); await buildBlog(); buildAbout(); buildCompany(); buildContacts();
  // 404: served by the web server for any missing address, so links resolve from the site root via <base>
  page({
    path: '404.html', base: '/', name: '404', title: 'Страница не найдена — NUTS', desc: 'Такой страницы нет. Зато есть кейсы, услуги и блог NUTS.',
    main: hero({ crumbs: [[null, '404']], title: 'Орех не найден', lead: 'Похоже, эту страницу уже раскололи и съели. Вернитесь на главную или загляните в кейсы.',
      after: `<div class="svc-hero__ctas" data-in style="position:relative;margin-top:32px"><a href="index.html" class="btn btn--orange magnetic" data-cursor="hover"><span>На главную</span></a><a href="cases/index.html" class="btn btn--ghost magnetic" data-cursor="hover"><span>Кейсы</span></a></div>` }),
  });
  NAMES[''] = 'Главная';
  QUEUE.forEach(renderPage);
  buildHome(await (await fetch('../index.html?' + Date.now())).text());
  // sitemap: every real page under its production address (no redirects, no 404)
  const today = new Date().toISOString().slice(0, 10);
  const real = ['', ...QUEUE.filter(q => !q.redirect && q.out !== '404.html').map(q => q.out)];
  const prio = out => (out === '' ? '1.0' : /^(services|projects|articles)\/$/.test(out) || /^services\/[^/]+\/$/.test(out) ? '0.8' : /^services\//.test(out) ? '0.7' : '0.5');
  pages['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(real)].sort().map(o => `  <url><loc>${SITE}${o}</loc><lastmod>${today}</lastmod><priority>${prio(o)}</priority></url>`).join('\n')}\n</urlset>\n`;
  pages['robots.txt'] = INDEX
    ? `User-agent: *\nAllow: /\nDisallow: /tools/\nDisallow: /data/\nDisallow: /*?\nAllow: /*?v=\n\nSitemap: ${SITE}sitemap.xml\n`
    : `# test copy of the site: closed for indexing (tools/build.js, INDEX = false)\nUser-agent: *\nDisallow: /\n`;
  log(`pages: ${real.length} in sitemap, ${QUEUE.filter(q => q.redirect).length} redirects`);
  let n = 0;
  for (const [path, html] of Object.entries(pages)) {
    const r = await fetch(SAVE + encodeURIComponent(path), { method: 'POST', body: html });
    if (!r.ok) log('FAIL ' + path + ' ' + (await r.text()));
    n++;
  }
  log(`written: ${n} files`);
  window.__built = { n, paths: Object.keys(pages) };
}
run().catch(e => { log('ERROR ' + e.stack); window.__built = { error: String(e.stack) }; });
