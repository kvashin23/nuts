// Imports the old site's company pages (technologies, vacancies, requisites, reviews) into data/pages.json,
// from the crawl saved in .tmp-import/live (index.tsv + pageN.html) — see README, "SEO".
// Reuses conv()/tidy()/localImage() from import-cases.js. Missing pictures go to .tmp-import/missing.txt.
const PAGES = [
  '/company/partners/', '/company/partners/docker/', '/company/partners/figma/', '/company/partners/flutter/', '/company/partners/gitlab/',
  '/company/partners/laravel/', '/company/partners/node-js/', '/company/partners/nuxt-js/', '/company/partners/october-cms/',
  '/company/partners/react-native/', '/company/partners/restful-api/', '/company/partners/teamcity/', '/company/partners/vue-js/',
  '/company/partners/winter-cms/', '/company/requisites/', '/company/reviews/', '/company/vacancy/',
  '/company/vacancy/junior-seo/', '/company/vacancy/rukovoditel-proektov/', '/company/vacancy/seo-spetsialist-seo-optimizator/',
];

async function runPages() {
  FILES = new Set(await (await fetch('../data/files.json?' + Date.now())).json());
  LOCAL_FILES = new Set(await (await fetch('../.tmp-import/local-files.json?' + Date.now())).json().catch(() => []));
  const seo = (await (await fetch('../data/seo.json?' + Date.now())).json()).pages;
  const out = {};
  for (const p of PAGES) {
    const meta = seo[p];
    if (!meta) { log(`ERR ${p}: not in seo.json`); continue; }
    const html = new TextDecoder().decode(await (await fetch('../.tmp-import/live/' + meta.file)).arrayBuffer());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('.content-md');
    if (!main) { log(`ERR ${p}: no .content-md`); continue; }
    main.querySelectorAll('form, .ask_a_question_wrapper, .order-block, .btn, .sticky-wrapper, script, style').forEach(n => n.remove());
    const page = { title: meta.title, description: meta.description, h1: meta.h1[0] || '' };
    if (p === '/company/reviews/') {
      // reviews become structured cards
      page.intro = (main.querySelector('.text_before_items')?.textContent || '').replace(/\s+/g, ' ').trim();
      page.reviews = [...main.querySelectorAll('.item.review')].map(r => ({
        name: (r.querySelector('.title')?.textContent || '').trim(),
        role: (r.querySelector('.post')?.textContent || '').trim(),
        paras: (r.querySelector('.text')?.innerHTML || '').split(/<br\s*\/?>\s*(?:<br\s*\/?>)?/i).map(s => { const d = document.createElement('div'); d.innerHTML = s; return d.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean),
        docs: [...r.querySelectorAll('.docs-block a')].map(a => ({ title: a.textContent.trim(), href: localFile(a.getAttribute('href')), size: (a.parentNode.querySelector('.filesize')?.textContent || '').replace(/\s+/g, ' ').trim() })),
      }));
    } else if (p === '/company/partners/') {
      // technology list: logo, name, link to its page
      page.intro = [...main.children].filter(n => !n.classList.contains('item-views')).map(n => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
      page.items = [...main.querySelectorAll('.item')].map(it => {
        const a = it.querySelector('.title a, a.dark-color, a[href*="/company/partners/"]');
        const img = it.querySelector('img');
        return { name: (it.querySelector('.title')?.textContent || a?.textContent || '').replace(/\s+/g, ' ').trim(), href: a ? 'https://nuts-agency.ru' + a.getAttribute('href') : '', logo: img ? localImage(img.getAttribute('data-src') || img.getAttribute('src')) : '', site: (it.querySelector('.text a, .site a')?.getAttribute('href') || '') };
      }).filter(i => i.name);
    } else if (p === '/company/vacancy/') {
      // the old accordion becomes a list of vacancies: department, title, pay, full text
      page.items = [...main.querySelectorAll('.item')].map(it => {
        let dep = it.previousElementSibling; while (dep && !/^H[1-6]$/.test(dep.tagName)) dep = dep.previousElementSibling;
        if (!dep) { let up = it.parentElement; while (up && up !== main && !dep) { let s = up.previousElementSibling; while (s && !/^H[1-6]$/.test(s.tagName) && !s.querySelector('h3')) s = s.previousElementSibling; dep = s && (/^H/.test(s.tagName) ? s : s.querySelector('h3')); up = up.parentElement; } }
        const body = it.querySelector('.previewtext') || it.querySelector('.text');
        const box = document.createElement('div');
        if (body) [...body.childNodes].forEach(n => conv(n, box, document));
        const name = (it.querySelector('.accordion-head span')?.textContent || '').replace(/\s+/g, ' ').trim();
        const link = it.querySelector('a[href*="/company/vacancy/"]');
        return { department: dep ? dep.textContent.replace(/\s+/g, ' ').trim() : '', name, pay: (it.querySelector('.accordion-head .pay')?.textContent || '').replace(/\s+/g, ' ').trim(), href: link ? link.getAttribute('href') : '', html: tidy(box, document) };
      });
    } else {
      const box = document.createElement('div');
      [...main.childNodes].forEach(n => conv(n, box, document));
      page.html = tidy(box, document);
    }
    out[p] = page;
    log(`ok  ${p}`);
  }
  await fetch(SAVE + encodeURIComponent('data/pages.json'), { method: 'POST', body: JSON.stringify(out, null, 1) });
  await fetch(SAVE + encodeURIComponent('.tmp-import/missing.txt'), { method: 'POST', body: [...missing].map(([u, f]) => `${u}\t${f}`).join('\n') });
  log(`done: ${Object.keys(out).length}/${PAGES.length}, missing files: ${missing.size}`);
  window.__imported = { ok: Object.keys(out).length, missing: missing.size };
}
runPages().catch(e => { log('ERROR ' + e.stack); window.__imported = { error: String(e.stack) }; });
