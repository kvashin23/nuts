// Re-imports case texts 1:1 from the live nuts-agency.ru into data/content.json.
// Open tools/import-cases.html on the local dev server with tools/save-server.ps1 running (it proxies the old site).
// Keeps every text node as is; turns the old CMS markup into clean HTML:
//   big bold spans -> <h3>, centered italic lines under pictures -> <figcaption>, video iframes -> .embed,
//   review attachments -> review.docs. Pictures and files missing locally are listed in .tmp-import/missing.txt.

const SAVE = 'http://localhost:5174/save?path=';
const PROXY = 'http://localhost:5174/proxy?url=';
const OLD = 'https://nuts-agency.ru';
const log = m => { document.getElementById('log').textContent += m + '\n'; };

let FILES, LOCAL_FILES;
const missing = new Map(); // old url -> local path

const fileName = src => src.split('?')[0].split('/').pop();
const absUrl = u => (/^https?:/.test(u) ? u.replace(/^http:/, 'https:') : OLD + (u.startsWith('/') ? '' : '/') + u);
const isImageFile = u => /\.(jpe?g|png|gif|webp|svg)(\?|$)/i.test(u);

function localImage(src) {
  const name = fileName(src);
  if (!FILES.has(name)) missing.set(absUrl(src), 'assets/content/' + name);
  return 'assets/content/' + name;
}
function localFile(href) {
  const name = fileName(href);
  if (!LOCAL_FILES.has(name)) missing.set(absUrl(href), 'assets/files/' + name);
  return absUrl(href); // build.js maps nuts-agency.ru/upload/... to assets/files/<name>
}

const VIDEO = /(vimeo\.com|youtube\.com|youtu\.be|vk\.com\/video_ext|vk\.ru\/video_ext|vkvideo\.ru|rutube\.ru|dzen\.ru\/embed)/;
const bigBold = el => {
  const st = (el.getAttribute('style') || '').toLowerCase();
  const size = st.match(/font-size:\s*([\d.]+)\s*(em|px|pt)/);
  const big = size && ((size[2] === 'em' && +size[1] >= 1.2) || (size[2] !== 'em' && +size[1] >= 20));
  return big && (/font-weight:\s*(bold|[6-9]00)/.test(st) || el.querySelector('b,strong'));
};

// convert one old-CMS node into clean nodes appended to `out`
function conv(node, out, doc) {
  if (node.nodeType === 3) { out.appendChild(doc.createTextNode(node.textContent)); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  const kids = target => [...node.childNodes].forEach(n => conv(n, target, doc));
  const el = (name, attrs = {}) => { const e = doc.createElement(name); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  switch (tag) {
    case 'script': case 'style': case 'noscript': case 'form': case 'input': case 'button': return;
    case 'br': out.appendChild(el('br')); return;
    case 'img': {
      const src = node.getAttribute('src') || '';
      if (!src || /^data:/.test(src)) return;
      const f = el('figure'); f.appendChild(el('img', { src: localImage(src), alt: node.getAttribute('alt') || '', loading: 'lazy' }));
      out.appendChild(f); return;
    }
    case 'iframe': {
      const src = node.getAttribute('src') || '';
      if (!VIDEO.test(src)) return;
      const w = +node.getAttribute('width') || 16, h = +node.getAttribute('height') || 9;
      const box = el('div', { class: 'embed', style: `--ratio:${(w / h).toFixed(4)}` });
      box.appendChild(el('iframe', { src: src.replace(/^\/\//, 'https://'), title: node.getAttribute('title') || 'Видео', allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowfullscreen: '', loading: 'lazy' }));
      out.appendChild(box); return;
    }
    case 'a': {
      const href = node.getAttribute('href') || '';
      // links that only wrap a picture open the picture itself — the lightbox does that now
      if (node.querySelector('img') && (isImageFile(href) || !node.textContent.trim())) { kids(out); return; }
      let target = href;
      if (/^\/upload\//.test(href) || /nuts-agency\.ru\/upload\//.test(href)) target = isImageFile(href) ? localImage(href) : localFile(href);
      else if (href.startsWith('/')) target = OLD + href;
      const a = el('a', { href: target }); kids(a); out.appendChild(a); return;
    }
    case 'b': case 'strong': { const b = el('strong'); kids(b); out.appendChild(b); return; }
    case 'i': case 'em': {
      // the old CMS wraps whole caption paragraphs in <i>; keep blocks out of inline tags
      if (node.querySelector('p,div,h1,h2,h3,h4,ul,ol,table')) { const tmp = el('div'); kids(tmp); tmp.querySelectorAll('p').forEach(p => p.setAttribute('data-cap', '1')); [...tmp.childNodes].forEach(n => out.appendChild(n)); return; }
      const e = el('em'); kids(e); out.appendChild(e); return;
    }
    case 'u': case 'font': case 'label': kids(out); return;
    case 'sup': case 'sub': { const e = el(tag); kids(e); out.appendChild(e); return; }
    case 'span': {
      if (bigBold(node) && node.textContent.trim()) { const h = el('h3'); h.textContent = node.textContent.replace(/\s+/g, ' ').trim(); out.appendChild(h); return; }
      kids(out); return;
    }
    case 'h1': case 'h2': { const h = el('h2'); kids(h); out.appendChild(h); return; }
    case 'h3': case 'h4': case 'h5': case 'h6': { const h = el('h3'); kids(h); out.appendChild(h); return; }
    case 'p': {
      const p = el('p');
      if (/text-align:\s*center/i.test(node.getAttribute('style') || '')) p.setAttribute('data-center', '1');
      kids(p);
      // a paragraph that holds only a heading-sized span becomes that heading
      const only = [...p.childNodes].filter(n => n.nodeType === 1 || n.textContent.trim());
      if (only.length === 1 && only[0].tagName === 'H3') { out.appendChild(only[0]); return; }
      out.appendChild(p); return;
    }
    case 'ul': case 'ol': case 'li': case 'blockquote': case 'table': case 'thead': case 'tbody': case 'tr': case 'td': case 'th': {
      const e = el(tag);
      if ((tag === 'td' || tag === 'th') && node.getAttribute('colspan')) e.setAttribute('colspan', node.getAttribute('colspan'));
      if ((tag === 'td' || tag === 'th') && node.getAttribute('rowspan')) e.setAttribute('rowspan', node.getAttribute('rowspan'));
      kids(e); out.appendChild(e); return;
    }
    case 'hr': out.appendChild(el('hr')); return;
    default: kids(out); // div, section, center, etc. — unwrap
  }
}

// tidy the converted tree: lift blocks out of <p>, attach captions, image-only tables -> rows
function tidy(root, doc) {
  // blocks nested in <p> (figure, h3, embed, p) — split the paragraph around them
  const BLOCK = /^(FIGURE|H2|H3|P|UL|OL|TABLE|BLOCKQUOTE|DIV|HR)$/;
  let changed = true;
  while (changed) {
    changed = false;
    root.querySelectorAll('p').forEach(p => {
      const inner = [...p.children].find(c => BLOCK.test(c.tagName));
      if (!inner) return;
      changed = true;
      const before = doc.createElement('p'), after = doc.createElement('p');
      [...p.attributes].forEach(a => { before.setAttribute(a.name, a.value); after.setAttribute(a.name, a.value); });
      let n = p.firstChild;
      while (n && n !== inner) { const nx = n.nextSibling; before.appendChild(n); n = nx; }
      n = inner.nextSibling;
      while (n) { const nx = n.nextSibling; after.appendChild(n); n = nx; }
      p.replaceWith(before, inner, after);
    });
  }
  const blank = n => !n || (n.nodeType === 3 && !n.textContent.replace(/​/g, '').trim()) || (n.nodeType === 1 && n.tagName === 'BR') || (n.nodeType === 1 && /^(P|EM|STRONG)$/.test(n.tagName) && !n.textContent.replace(/​/g, '').trim() && !n.querySelector('img,iframe'));
  root.querySelectorAll('p, em, strong').forEach(n => { if (blank(n)) n.remove(); });
  // image-only tables become a row of pictures
  root.querySelectorAll('table').forEach(t => {
    const imgs = t.querySelectorAll('img');
    if (!imgs.length || t.textContent.trim()) return;
    const f = doc.createElement('figure'); f.className = 'figure-row';
    imgs.forEach(img => f.appendChild(img));
    t.replaceWith(f);
  });
  // a centered or italic-only short line right after a picture / video is its caption
  const isCaption = n => {
    if (!n || n.nodeType !== 1) return false;
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t || t.length > 160) return false;
    if (n.tagName === 'EM') return true;
    if (n.tagName !== 'P') return false;
    const ems = [...n.querySelectorAll('em')].map(e => e.textContent).join('').replace(/\s+/g, ' ').trim();
    return n.hasAttribute('data-cap') || (ems && ems === t) || (n.hasAttribute('data-center') && !n.querySelector('a,strong'));
  };
  root.querySelectorAll('figure, .embed').forEach(fig => {
    let n = fig.nextSibling;
    while (n && blank(n)) n = n.nextSibling;
    if (!isCaption(n)) return;
    const cap = doc.createElement('figcaption');
    cap.textContent = n.textContent.replace(/\s+/g, ' ').trim();
    if (fig.tagName === 'FIGURE') fig.appendChild(cap);
    else { const f = doc.createElement('figure'); f.className = 'figure-embed'; fig.replaceWith(f); f.append(fig, cap); }
    n.remove();
  });
  root.querySelectorAll('[data-center],[data-cap]').forEach(n => { n.removeAttribute('data-center'); n.removeAttribute('data-cap'); });
  return root.innerHTML.replace(/​/g, '').replace(/(<br>\s*){3,}/g, '<br><br>');
}

function parseCase(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // the case text sits in .introtext and/or .content of the main column (some cases have only one of them)
  const parts = [...doc.querySelectorAll('.col-md-9 > .introtext, .col-md-9 > .content')].filter(c => !c.closest('.reviews-block'));
  if (!parts.length) throw new Error('no .content');
  const out = document.createElement('div');
  parts.forEach(part => [...part.childNodes].forEach(n => conv(n, out, document)));
  const body = tidy(out, document);
  let review = null;
  const r = doc.querySelector('.reviews-block .review');
  if (r) {
    const txt = r.querySelector('.text');
    const paras = txt ? txt.innerHTML.split(/<br\s*\/?>\s*(?:<br\s*\/?>)?/i).map(s => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean) : [];
    review = {
      name: (r.querySelector('.title')?.textContent || '').trim(),
      role: (r.querySelector('.post')?.textContent || '').trim(),
      text: paras.join(' '),
      paras,
      docs: [...r.querySelectorAll('.docs-block a')].map(a => ({ title: a.textContent.trim(), href: localFile(a.getAttribute('href')), size: (a.parentNode.querySelector('.filesize')?.textContent || '').replace(/\s+/g, ' ').trim() })),
    };
  }
  return { body, review };
}

async function run() {
  const D = await (await fetch('../data/content.json?' + Date.now())).json();
  FILES = new Set(await (await fetch('../data/files.json?' + Date.now())).json());
  LOCAL_FILES = new Set(await (await fetch('../.tmp-import/local-files.json?' + Date.now())).json().catch(() => []));
  let ok = 0;
  const only = new Set((new URLSearchParams(location.search).get('only') || '').split(',').filter(Boolean)); // ?only=<slug>,<slug> re-imports some cases
  for (const c of D.cases) {
    if (only.size && !only.has(c.slug)) continue;
    try {
      const r = await fetch(PROXY + encodeURIComponent(OLD + c.url));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { body, review } = parseCase(await r.text());
      c.html = body;
      if (review) c.review = review;
      ok++;
      log(`ok  ${c.slug} (${body.length})`);
    } catch (e) { log(`ERR ${c.slug}: ${e.message}`); }
  }
  D.casesImported = new Date().toISOString();
  await fetch(SAVE + encodeURIComponent('data/content.json'), { method: 'POST', body: JSON.stringify(D, null, 1) });
  await fetch(SAVE + encodeURIComponent('.tmp-import/missing.txt'), { method: 'POST', body: [...missing].map(([u, p]) => `${u}\t${p}`).join('\n') });
  log(`done: ${ok}/${D.cases.length}, missing files: ${missing.size}`);
  window.__imported = { ok, total: D.cases.length, missing: missing.size };
}
run().catch(e => { log('ERROR ' + e.stack); window.__imported = { error: String(e.stack) }; });
