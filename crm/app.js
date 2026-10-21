'use strict';

// ---------- константы ----------
const STORE_KEY = 'nutscrm.v1';
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_STEMS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const SECTIONS = ['Поддержка', 'SEO', 'Разработка', 'Реклама', 'SMM', 'Мутки'];
const LEGAL = new Set(['ооо', 'ао', 'пао', 'зао', 'оао', 'ип', 'фгау']);
// Поступления этих типов — не оплаты клиентов (депозиты, проценты, свои переводы).
const SERVICE_OPS = /депозит|процент|между счетами|наличн|вывод|возврат средств/i;
// Оплата разовых работ — их нет в ежемесячной таблице, поэтому они не гасят абонентские начисления.
const ONEOFF_RE = /доработ|разработ|редизайн|дизайн|этап|спринт|лиценз|битрикс\s*24|хостинг|пополнени\S* баланса|функционал|верстк|привлечени/i;
// «по счету № 538 от 01.10.26», «сч. № 482 от 01.09.2026», «Оплата по 412 от 31.08.2026»
const INVOICE_RE = /(?:сч(?:е|ё)?т?(?:у|а)?\.?|по)\s*(?:на\s+оплату\s*)?(?:№|N)?\s*(\d{1,7})(?:\s*,\s*\d{1,7})*\s*от\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i;
const KINDS = { regular: 'По плану', oneoff: 'Разовая работа', prior: 'Долг прошлого периода' };

// ---------- утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const money = n => (Math.round(n || 0)).toLocaleString('ru-RU');
const moneyS = n => (n < 0 ? '−' : '') + money(Math.abs(n));
const round2 = n => Math.round(n * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const curMonth = () => todayISO().slice(0, 7);
const monthLabel = m => { const [y, mm] = m.split('-'); return MONTHS[+mm - 1][0].toUpperCase() + MONTHS[+mm - 1].slice(1) + ' ' + y; };
const monthShort = m => { const [y, mm] = m.split('-'); return MONTHS_SHORT[+mm - 1] + ' ' + y.slice(2); };
const addMonths = (m, k) => { let [y, mm] = m.split('-').map(Number); mm += k; while (mm > 12) { mm -= 12; y++; } while (mm < 1) { mm += 12; y--; } return y + '-' + String(mm).padStart(2, '0'); };
const fmtDate = d => d ? d.split('-').reverse().join('.') : '';
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/общество с ограниченной ответственностью/g, ' ')
    .replace(/индивидуальный предприниматель/g, ' ')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .split(' ').filter(t => t && !LEGAL.has(t)).join(' ');
}
function hasSeq(tokens, kwTokens) {
  outer: for (let i = 0; i + kwTokens.length <= tokens.length; i++) {
    for (let j = 0; j < kwTokens.length; j++) if (tokens[i + j] !== kwTokens[j]) continue outer;
    return true;
  }
  return false;
}

// ---------- хранилище ----------
let S;
function freshState() {
  const priv = window.SEED_PRIVATE || {};   // контакты и заметки из локального seed.private.js (его нет в репозитории)
  return {
    version: 1,
    clients: (window.SEED_CLIENTS || []).map(c => ({
      id: c.id, name: c.name, payers: (c.payers || []).map(norm), accounts: [], kw: c.kw || [], aliases: [],
      postpay: !!c.postpay, ooo: !!c.ooo, opening: 0,
      contact: (priv[c.id] || {}).contact || '', note: (priv[c.id] || {}).note || '', archived: false,
    })),
    accruals: [],   // {id, clientId, month, section, title, amount, source}
    payments: [],   // {id, key, date, payer, payerNorm, account, amount, desc, docNo, invoiceNo, opType, clientId, ignored, ignoreReason, auto}
    log: [],        // история загрузок
  };
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return JSON.parse(raw); } catch (e) { console.warn(e); }
  return null;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { toast('Не удалось сохранить в браузере: ' + e.message + '. Сделайте резервную копию.', 'bad'); }
}
const clientById = id => S.clients.find(c => c.id === id);

// ---------- сопоставление ----------
function kwMatch(text) {
  const tokens = norm(text).split(' ');
  let best = null, bestScore = 0, tie = false;
  for (const c of S.clients) {
    if (c.archived) continue;
    for (const k of c.kw) {
      const kt = norm(k).split(' ').filter(Boolean);
      if (!kt.length || !hasSeq(tokens, kt)) continue;
      const score = kt.join(' ').length;
      if (score > bestScore) { best = c; bestScore = score; tie = false; }
      else if (score === bestScore && best && best.id !== c.id) tie = true;
    }
  }
  return tie ? null : best;
}
function matchPayment(p) {
  if (p.account) { const c = S.clients.find(c => c.accounts.includes(p.account)); if (c) return c; }
  const byName = S.clients.find(c => c.payers.includes(p.payerNorm));
  if (byName) return byName;
  return p.payer ? kwMatch(p.payer) : null;
}
function classify(p) {
  if (!p.clientId) return 'regular';
  // счёт выставлен до начала учёта (до самого раннего загруженного месяца) — это оплата старого долга
  const first = S.accruals.reduce((m, a) => a.month < m ? a.month : m, '9999-99');
  const ref = p.serviceMonth || p.invoiceMonth;
  if (first !== '9999-99' && ((ref && ref < first) || /задолженност|акт\S* сверки/i.test(p.desc))) return 'prior';
  if (ONEOFF_RE.test(p.desc)) return 'oneoff';
  return 'regular';
}
// Переносит всё (начисления, платежи, плательщиков, ключевые слова) из fromId в toId и удаляет fromId.
function mergeClients(fromId, toId) {
  const from = clientById(fromId), to = clientById(toId);
  if (!from || !to || from === to) return;
  for (const k of ['payers', 'accounts', 'kw', 'aliases']) to[k] = [...new Set([...to[k], ...from[k]])];
  to.opening = round2((to.opening || 0) + (from.opening || 0));
  if (from.note) to.note = [to.note, from.note].filter(Boolean).join(' / ');
  if (from.contact) to.contact = [to.contact, from.contact].filter(Boolean).join(', ');
  S.accruals.forEach(a => { if (a.clientId === fromId) a.clientId = toId; });
  S.payments.forEach(p => { if (p.clientId === fromId) p.clientId = toId; });
  S.clients = S.clients.filter(c => c.id !== fromId);
  reclassifyAll();
  save();
}
function reclassifyAll() {
  for (const p of S.payments) if (!p.kindManual) p.kind = classify(p);
}
function matchAccrualName(name) {
  const n = norm(name);
  const byAlias = S.clients.find(c => c.aliases.includes(n));
  return byAlias || kwMatch(name);
}

// ---------- расчёт: FIFO-распределение оплат по начислениям ----------
// Оплаты клиента гасят самые старые начисления первыми. Остаток — аванс.
function computeLedger(asOf = curMonth()) {
  const res = new Map();
  for (const c of S.clients) res.set(c.id, { client: c, acc: [], pays: [], accrued: 0, paid: 0, balance: 0, overdue: 0, current: 0, advance: 0, lastPay: null });
  for (const a of S.accruals) { const r = res.get(a.clientId); if (r) r.acc.push({ ...a, paid: 0 }); }
  for (const p of S.payments) { if (p.clientId && !p.ignored) { const r = res.get(p.clientId); if (r) r.pays.push(p); } }
  const counts = (p, c) => (p.kind || 'regular') === 'regular' || (p.kind === 'prior' && c.opening > 0);
  for (const r of res.values()) {
    const c = r.client;
    r.acc.sort((a, b) => a.month.localeCompare(b.month) || (SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section)));
    if (c.opening > 0) r.acc.unshift({ id: 'opening', clientId: c.id, month: '0000-00', section: '', title: 'Долг на начало учёта', amount: c.opening, paid: 0 });
    r.pays.sort((a, b) => a.date.localeCompare(b.date));
    // Две корзины: оплаты «по плану» гасят абонентку, оплаты разовых работ — строки «Разработка».
    // Остаток одной корзины докрывает неоплаченное в другой (на случай, если тип угадан неверно).
    const planPaid = r.pays.filter(p => counts(p, c)).reduce((s, p) => s + p.amount, 0);
    let pool = planPaid + (c.opening < 0 ? -c.opening : 0);
    let projPool = r.pays.filter(p => p.kind === 'oneoff').reduce((s, p) => s + p.amount, 0);
    const isProj = a => a.section === 'Разработка';
    const fill = (items, take) => { for (const a of items) { const x = take(round2(a.amount - a.paid)); a.paid = round2(a.paid + x); } };
    const fromPool = need => { const x = Math.min(need, pool); pool = round2(pool - x); return x; };
    const fromProj = need => { const x = Math.min(need, projPool); projPool = round2(projPool - x); return x; };
    fill(r.acc.filter(a => !isProj(a)), fromPool);
    fill(r.acc.filter(isProj), fromProj);
    fill(r.acc.filter(isProj), fromPool);   // лишние абонентские оплаты докрывают проекты; обратное не делаем
    r.advance = pool;
    const graceMonth = c.postpay ? addMonths(asOf, -1) : asOf;   // начисления раньше этого месяца — просрочка
    for (const a of r.acc) {
      const left = round2(a.amount - a.paid);
      a.status = left <= 0.5 ? 'paid' : a.paid > 0 ? 'partial' : 'unpaid';
      if (left > 0.5) { if (a.month < graceMonth) r.overdue += left; else r.current += left; }
    }
    r.accruedAll = r.acc.reduce((s, a) => s + a.amount, 0);
    r.paidAll = r.pays.reduce((s, p) => s + p.amount, 0);
    r.oneoffPaid = r.pays.filter(p => p.kind === 'oneoff').reduce((s, p) => s + p.amount, 0);
    // сальдо: неоплаченное минус аванс (лишние разовые оплаты авансом не считаются)
    r.balance = round2(r.acc.reduce((s, a) => s + a.amount - a.paid, 0) - r.advance);
    r.lastPay = r.pays.length ? r.pays[r.pays.length - 1] : null;
  }
  return res;
}
function inPeriod(dateOrMonth, period) {
  if (period === 'all') return true;
  return dateOrMonth.startsWith(period);
}

// ---------- импорт xlsx ----------
function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) return reject(new Error('Библиотека XLSX не загрузилась — нужен интернет при первом открытии.'));
    const fr = new FileReader();
    fr.onload = () => { try { resolve(XLSX.read(new Uint8Array(fr.result), { type: 'array' })); } catch (e) { reject(e); } };
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}
function cellDate(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const m = String(v || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const iso = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}
function num(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/\s| /g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
}

// Банковская выписка: ищем строку заголовков на любом листе, колонки — по названиям.
const BANK_COLS = {
  date: [/^дата$/i, /^дата (операции|платежа|проводки)/i],
  payer: [/^контрагент$/i, /^плательщик$/i, /^наименование плательщика/i, /^контрагент/i],
  in: [/^поступило/i, /^приход/i, /^кредит/i, /^зачислено/i, /^поступление/i],
  out: [/^списано/i, /^расход/i, /^дебет/i],
  desc: [/^описание/i, /^назначение/i],
  type: [/^тип операции/i],
  docNo: [/^№ документа/i, /^номер документа/i, /^№ п\/п/i],
  account: [/реквизиты контрагента/i, /сч[её]т (контрагента|плательщика)/i],
};
function detectBankSheet(wb) {
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const hdr = rows[i].map(h => String(h).trim());
      const cols = {};
      for (const [key, patterns] of Object.entries(BANK_COLS)) {
        for (const re of patterns) { const idx = hdr.findIndex(h => re.test(h)); if (idx >= 0) { cols[key] = idx; break; } }
      }
      if (cols.date != null && cols.in != null) return { rows: rows.slice(i + 1), cols, sheet: name };
    }
  }
  return null;
}
function parseBank(wb) {
  const det = detectBankSheet(wb);
  if (!det) throw new Error('Не нашёл в файле колонки «Дата» и «Поступило/Приход». Это точно выписка?');
  const { rows, cols } = det;
  const out = [];
  for (const r of rows) {
    const amount = num(r[cols.in]);
    if (!(amount > 0)) continue;
    const date = cellDate(r[cols.date]);
    if (!date) continue;
    const payer = String(r[cols.payer] ?? '').trim();
    const desc = String(r[cols.desc] ?? '').trim();
    const opType = String(r[cols.type] ?? '').trim();
    const docNo = String(r[cols.docNo] ?? '').trim();
    const accM = String(r[cols.account] ?? '').match(/\b\d{20}\b/);
    // «Счёт на оплату № 289 от 1 июня 2026» → приводим к виду «от 01.06.2026»
    const wordDate = desc.match(/№\s*(\d{1,7})\s*от\s*(\d{1,2})\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*\s+(\d{4})/i);
    const invM = desc.match(INVOICE_RE)
      || (wordDate && [wordDate[0], wordDate[1], wordDate[2], String(MONTH_STEMS.indexOf(wordDate[3].toLowerCase()) + 1), wordDate[4]])
      || desc.match(/сч(?:е|ё)т(?:у|а)?\s*(?:№|N)?\s*(\d{1,7})/i);
    const invYear = invM && invM[4] ? (invM[4].length === 2 ? '20' + invM[4] : invM[4]) : '';
    // период услуги из текста: «в октябре 2025», «за Сентябрь 2026 г.», «в ноябре, декабре 2025»
    const svc = desc.match(/(?:^|[\s(.,])(?:в|за)\s+(январ|феврал|март|апрел|ма|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*(?:\s*(?:,|и|-|–)\s*[а-я]+)*\s*(\d{4})/i);
    const payerNorm = norm(payer);
    out.push({
      date, payer, payerNorm, amount: round2(amount), desc, opType, docNo,
      account: accM ? accM[0] : '', invoiceNo: invM ? invM[1] : '',
      invoiceMonth: invYear ? invYear + '-' + invM[3].padStart(2, '0') : '',
      serviceMonth: svc && MONTH_STEMS.includes(svc[1].toLowerCase()) ? svc[2] + '-' + String(MONTH_STEMS.indexOf(svc[1].toLowerCase()) + 1).padStart(2, '0') : '',
      key: [date, docNo, round2(amount), payerNorm].join('|'),
    });
  }
  return out;
}
function importBank(parsed, fileName) {
  const have = new Map();
  for (const p of S.payments) have.set(p.key, (have.get(p.key) || 0) + 1);
  const seen = new Map();
  let added = 0, dup = 0, matched = 0, service = 0;
  const minD = parsed.reduce((m, p) => p.date < m ? p.date : m, '9999'), maxD = parsed.reduce((m, p) => p.date > m ? p.date : m, '0000');
  for (const p of parsed) {
    const n = (seen.get(p.key) || 0) + 1; seen.set(p.key, n);
    if (n <= (have.get(p.key) || 0)) { dup++; continue; }
    const rec = { id: uid(), ...p, clientId: null, ignored: false, ignoreReason: '', auto: true };
    if (SERVICE_OPS.test(p.opType) || SERVICE_OPS.test(p.desc) && /депозит/i.test(p.desc)) { rec.ignored = true; rec.ignoreReason = 'Служебная операция: ' + (p.opType || 'депозит'); service++; }
    else { const c = matchPayment(p); if (c) { rec.clientId = c.id; matched++; } }
    rec.kind = classify(rec);
    S.payments.push(rec); added++;
  }
  S.log.unshift({ at: new Date().toISOString(), kind: 'bank', file: fileName, added, dup, matched, service, period: minD + ' — ' + maxD });
  save();
  return { added, dup, matched, service, unmatched: added - matched - service };
}
function rematchAll() {
  let n = 0;
  for (const p of S.payments) {
    if (p.ignored || (p.clientId && !p.auto)) continue;
    const c = matchPayment(p); const id = c ? c.id : null;
    if (id !== p.clientId) { p.clientId = id; n++; }
  }
  reclassifyAll();
  save(); return n;
}
function assignPayment(pid, clientId, remember) {
  const p = S.payments.find(x => x.id === pid); if (!p) return;
  if (clientId === '__ignore') { p.ignored = true; p.ignoreReason = 'Не оплата клиента'; p.clientId = null; p.auto = false; }
  else {
    p.ignored = false; p.clientId = clientId || null; p.auto = false;
    const c = clientById(clientId);
    if (c && remember) {
      if (p.payerNorm && !c.payers.includes(p.payerNorm)) c.payers.push(p.payerNorm);
      if (p.account && !c.accounts.includes(p.account)) c.accounts.push(p.account);
      // все остальные платежи этого плательщика, ещё не размеченные вручную, — тоже ему
      for (const q of S.payments) if (q !== p && !q.ignored && !q.clientId && q.payerNorm && q.payerNorm === p.payerNorm) { q.clientId = c.id; q.auto = true; if (!q.kindManual) q.kind = classify(q); }
    }
  }
  if (!p.kindManual) p.kind = classify(p);
  save();
}

// Таблица «Оплаты»: листы вида «Октябрь 2026», колонка A — направление, B — клиент/работа, C — сумма, D/E — заметки.
function planSheets(wb) {
  const out = [];
  for (const name of wb.SheetNames) {
    const m = name.trim().replace(/\s+/g, ' ').toLowerCase().match(/^([а-яё]+) (\d{4})$/);
    if (!m) continue;
    const mi = MONTHS.indexOf(m[1]); if (mi < 0) continue;
    out.push({ sheet: name, month: m[2] + '-' + String(mi + 1).padStart(2, '0') });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}
function parsePlanSheet(wb, sheet, month) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
  const out = [];
  let section = '', secIdx = -1;
  for (const r of rows) {
    const a = String(r[0] ?? '').trim(), b = String(r[1] ?? '').trim();
    if (a) { const i = SECTIONS.findIndex(s => s.toLowerCase() === a.toLowerCase()); section = i >= 0 ? SECTIONS[i] : a; secIdx = i; }
    if (/^итого/i.test(b)) { // после «Итого» без подписи начинается следующее направление (в октябре потеряна подпись «Реклама»)
      if (secIdx >= 0 && secIdx + 1 < SECTIONS.length) { secIdx++; section = SECTIONS[secIdx]; }
      continue;
    }
    if (!b || /^клиент\/работа/i.test(b)) continue;
    const amount = num(r[2]);
    if (!(amount > 0)) continue;
    out.push({ month, section: section || 'Прочее', title: b, amount: round2(amount), note: [r[3], r[4]].filter(Boolean).join(' / ') });
  }
  return out;
}

// ---------- экспорт ----------
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportBackup() {
  download(`nuts-crm-backup-${todayISO()}.json`, new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
}
function exportDebtsXlsx() {
  const L = computeLedger();
  const rows = [...L.values()].filter(r => r.balance > 0.5).sort((a, b) => b.balance - a.balance).map(r => ({
    'Клиент': r.client.name, 'Долг всего': Math.round(r.balance), 'Просрочено': Math.round(r.overdue), 'Текущий месяц': Math.round(r.current),
    'Неоплаченные месяцы': r.acc.filter(a => a.status !== 'paid').map(a => a.month === '0000-00' ? 'нач. долг' : monthShort(a.month)).filter((v, i, arr) => arr.indexOf(v) === i).join(', '),
    'Последняя оплата': r.lastPay ? fmtDate(r.lastPay.date) : '—', 'Сумма посл. оплаты': r.lastPay ? r.lastPay.amount : '',
    'Постоплата': r.client.postpay ? 'да' : '', 'Контакт': r.client.contact,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 40 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Долги');
  XLSX.writeFile(wb, `Долги клиентов ${fmtDate(todayISO())}.xlsx`);
}

// ---------- UI-состояние ----------
const UI = {
  tab: 'summary',
  period: curMonth().slice(0, 4),
  month: curMonth(),
  clientSort: { key: 'balance', dir: -1 },
  clientSearch: '',
  payFilter: 'unmatched',
  monthMode: 'clients',
  monthFilter: 'all',
  monthShowOoo: false,
  monthSort: { key: 'rank', dir: 1 },
  paySearch: '',
  payClient: '',
  analyticsSort: { key: 'paidP', dir: -1 },
};
try { Object.assign(UI, JSON.parse(localStorage.getItem(STORE_KEY + '.ui') || '{}')); } catch (e) { /* без сохранённого вида */ }
function saveUI() { try { localStorage.setItem(STORE_KEY + '.ui', JSON.stringify({ tab: UI.tab, period: UI.period, clientSort: UI.clientSort, payFilter: UI.payFilter, monthMode: UI.monthMode, monthFilter: UI.monthFilter, monthShowOoo: UI.monthShowOoo, monthSort: UI.monthSort })); } catch (e) { /* не критично */ } }

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 6000);
}
function clientOptions(selected, extra = '') {
  return extra + S.clients.filter(c => !c.archived).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}
function periodOptions() {
  const years = new Set([curMonth().slice(0, 4)]);
  S.accruals.forEach(a => years.add(a.month.slice(0, 4)));
  S.payments.forEach(p => years.add(p.date.slice(0, 4)));
  const months = new Set([curMonth()]);
  S.accruals.forEach(a => months.add(a.month));
  S.payments.forEach(p => months.add(p.date.slice(0, 7)));
  return `<option value="all" ${UI.period === 'all' ? 'selected' : ''}>За всё время</option>` +
    [...years].sort().reverse().map(y => `<option value="${y}" ${UI.period === y ? 'selected' : ''}>${y} год</option>`).join('') +
    [...months].sort().reverse().map(m => `<option value="${m}" ${UI.period === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
}
const statusChip = s => s === 'paid' ? '<span class="chip ok">✓ оплачено</span>' : s === 'partial' ? '<span class="chip warn">◐ частично</span>' : '<span class="chip bad">✕ не оплачено</span>';

// ---------- вкладки ----------
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === UI.tab));
  const unm = S.payments.filter(p => !p.ignored && !p.clientId).length;
  $('#badge-unmatched').textContent = unm || '';
  const view = { summary: viewSummary, clients: viewClients, month: viewMonth, payments: viewPayments, analytics: viewAnalytics, data: viewData }[UI.tab];
  $('#view').innerHTML = view();
  saveUI();
}

function viewSummary() {
  if (!S.accruals.length && !S.payments.length) return `
    <div class="empty">
      <h2>С чего начать</h2>
      <ol>
        <li><b>Загрузите таблицу «Оплаты.xlsx»</b> — возьму из неё начисления по месяцам (кому сколько выставляем).</li>
        <li><b>Загрузите банковскую выписку</b> (Эльба → Деньги → выгрузка в Excel) — отмечу, кто оплатил.</li>
      </ol>
      <div class="row gap">
        <label class="btn primary">Загрузить «Оплаты.xlsx»<input type="file" accept=".xlsx,.xls" hidden data-act="plan-file"></label>
        <label class="btn">Загрузить выписку<input type="file" accept=".xlsx,.xls,.csv" hidden data-act="bank-file"></label>
      </div>
    </div>`;
  const L = computeLedger();
  const m = UI.month;
  const accM = S.accruals.filter(a => a.month === m).reduce((s, a) => s + a.amount, 0);
  const paidM = S.payments.filter(p => p.clientId && !p.ignored && p.date.startsWith(m)).reduce((s, p) => s + p.amount, 0);
  let debt = 0, overdue = 0, adv = 0, debtors = 0;
  for (const r of L.values()) { if (r.balance > 0.5) { debt += r.balance; debtors++; } overdue += r.overdue; adv += r.advance; }
  const monthAcc = [...L.values()].flatMap(r => r.acc.filter(a => a.month === m));
  const paidLines = monthAcc.filter(a => a.status === 'paid').length;
  const unm = S.payments.filter(p => !p.ignored && !p.clientId);
  const top = [...L.values()].filter(r => r.overdue > 0.5).sort((a, b) => b.overdue - a.overdue).slice(0, 10);
  return `
    <div class="toolbar">
      <label>Месяц <select data-act="set-month">${[...new Set([curMonth(), ...S.accruals.map(a => a.month)])].sort().reverse().map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x)}</option>`).join('')}</select></label>
      <span class="spacer"></span>
      <label class="btn primary">Загрузить выписку<input type="file" accept=".xlsx,.xls,.csv" hidden data-act="bank-file"></label>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Начислено за ${esc(monthLabel(m).toLowerCase())}</div><div class="k-val">${money(accM)} ₽</div><div class="k-sub">${monthAcc.length} строк, оплачено ${paidLines}</div></div>
      <div class="kpi"><div class="k-label">Поступило от клиентов за месяц</div><div class="k-val">${money(paidM)} ₽</div><div class="k-sub">${accM ? Math.round(paidM / accM * 100) + '% от начисленного' : '&nbsp;'}</div></div>
      <div class="kpi"><div class="k-label">Дебиторка всего</div><div class="k-val">${money(debt)} ₽</div><div class="k-sub">${debtors} клиентов должны</div></div>
      <div class="kpi alert"><div class="k-label">Из них просрочено</div><div class="k-val">${money(overdue)} ₽</div><div class="k-sub">прошлые месяцы (у постоплаты — позапрошлые)</div></div>
      <div class="kpi"><div class="k-label">Авансы клиентов</div><div class="k-val">${money(adv)} ₽</div><div class="k-sub">оплачено сверх начислений</div></div>
    </div>
    ${unm.length ? `<div class="notice">Нераспознанных поступлений: <b>${unm.length}</b> на ${money(unm.reduce((s, p) => s + p.amount, 0))} ₽. <a href="#" data-act="goto" data-tab="payments" data-filter="unmatched">Разобрать →</a></div>` : ''}
    <div class="grid2">
      <section class="card"><h3>Начислено и поступило по месяцам</h3>${chartMonthly()}</section>
      <section class="card"><h3>Главные должники (просрочка)</h3>
        ${top.length ? `<table class="tbl compact"><thead><tr><th>Клиент</th><th class="num">Просрочено</th><th class="num">Последняя оплата</th></tr></thead><tbody>
        ${top.map(r => `<tr class="click" data-act="open-client" data-id="${r.client.id}"><td>${esc(r.client.name)}</td><td class="num bad-t">${money(r.overdue)}</td><td class="num muted">${r.lastPay ? fmtDate(r.lastPay.date) : 'не было'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Просроченных долгов нет.</p>'}
      </section>
    </div>`;
}

function chartMonthly() {
  const year = UI.month.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).filter(m => m <= curMonth() || S.accruals.some(a => a.month === m));
  const acc = months.map(m => S.accruals.filter(a => a.month === m).reduce((s, a) => s + a.amount, 0));
  const inc = months.map(m => S.payments.filter(p => p.clientId && !p.ignored && p.date.startsWith(m)).reduce((s, p) => s + p.amount, 0));
  const max = Math.max(1, ...acc, ...inc);
  const W = 640, H = 240, padL = 48, padB = 26, padT = 10, plotH = H - padB - padT, gw = (W - padL) / months.length, bw = Math.min(18, gw / 2 - 4);
  const step = niceStep(max / 4);
  let grid = '';
  for (let v = 0; v <= max + 1; v += step) {
    const y = padT + plotH - v / max * plotH;
    grid += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" class="gridline"/><text x="${padL - 6}" y="${y + 4}" class="axis" text-anchor="end">${v >= 1e6 ? (v / 1e6).toLocaleString('ru-RU') + ' млн' : Math.round(v / 1e3) + ' т'}</text>`;
  }
  const bar = (x, v, cls, m, label) => {
    const h = Math.max(0, v / max * plotH), y = padT + plotH - h;
    const r = Math.min(4, h, bw / 2);
    const path = h > 0 ? `M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${padT + plotH} Z` : '';
    return `<path d="${path}" class="${cls}"/><rect x="${x - 2}" y="${padT}" width="${bw + 4}" height="${plotH}" class="hit" data-tip="${esc(monthLabel(m))} · ${label}: ${money(v)} ₽"/>`;
  };
  const bars = months.map((m, i) => {
    const x0 = padL + i * gw + gw / 2 - bw - 1;
    return bar(x0, acc[i], 's1', m, 'начислено') + bar(x0 + bw + 2, inc[i], 's2', m, 'поступило') +
      `<text x="${padL + i * gw + gw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${MONTHS_SHORT[+m.slice(5) - 1]}</text>`;
  }).join('');
  return `<div class="legend"><span><i class="sw s1"></i>Начислено</span><span><i class="sw s2"></i>Поступило от клиентов</span></div>
    <div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Начислено и поступило по месяцам">${grid}<line x1="${padL}" x2="${W}" y1="${padT + plotH}" y2="${padT + plotH}" class="baseline"/>${bars}</svg></div>
    <details class="tableview"><summary>Таблица</summary><table class="tbl compact"><thead><tr><th>Месяц</th><th class="num">Начислено</th><th class="num">Поступило</th><th class="num">Разница</th></tr></thead><tbody>
    ${months.map((m, i) => `<tr><td>${monthLabel(m)}</td><td class="num">${money(acc[i])}</td><td class="num">${money(inc[i])}</td><td class="num">${moneyS(inc[i] - acc[i])}</td></tr>`).join('')}</tbody></table></details>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

function clientRows() {
  const L = computeLedger();
  const per = UI.period;
  return [...L.values()].map(r => {
    const accP = r.acc.filter(a => a.month !== '0000-00' && inPeriod(a.month, per)).reduce((s, a) => s + a.amount, 0);
    const paidP = r.pays.filter(p => inPeriod(p.date, per)).reduce((s, p) => s + p.amount, 0);
    const monthly = S.accruals.filter(a => a.clientId === r.client.id && a.month === curMonth()).reduce((s, a) => s + a.amount, 0);
    const sections = [...new Set(r.acc.filter(a => a.section).map(a => a.section))];
    return {
      r, id: r.client.id, name: r.client.name, sections, monthly, accP, paidP, balance: r.balance, overdue: r.overdue,
      lastPay: r.lastPay ? r.lastPay.date : '', days: r.lastPay ? daysBetween(r.lastPay.date, todayISO()) : 99999,
    };
  }).filter(x => x.accP || x.paidP || Math.abs(x.balance) > 0.5 || x.monthly);
}
function sortRows(rows, sort) {
  const { key, dir } = sort;
  return rows.sort((a, b) => {
    const va = a[key], vb = b[key];
    return (typeof va === 'string' ? va.localeCompare(vb, 'ru') : (va - vb)) * dir;
  });
}
function th(label, key, sort, act, cls = '') {
  const arrow = sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : '';
  return `<th class="sortable ${cls}" data-act="${act}" data-key="${key}">${label}${arrow}</th>`;
}
function viewClients() {
  let rows = clientRows();
  const q = norm(UI.clientSearch);
  if (q) rows = rows.filter(x => norm(x.name).includes(q));
  rows = sortRows(rows, UI.clientSort);
  const tot = rows.reduce((t, x) => ({ accP: t.accP + x.accP, paidP: t.paidP + x.paidP, balance: t.balance + Math.max(0, x.balance), overdue: t.overdue + x.overdue }), { accP: 0, paidP: 0, balance: 0, overdue: 0 });
  const s = UI.clientSort, A = 'sort-clients';
  return `
    <div class="toolbar">
      <input type="search" placeholder="Поиск клиента" value="${esc(UI.clientSearch)}" data-act="client-search">
      <label>Период <select data-act="set-period">${periodOptions()}</select></label>
      <span class="spacer"></span>
      <button class="btn" data-act="export-debts">Долги в Excel</button>
      <button class="btn" data-act="new-client">+ Клиент</button>
    </div>
    <p class="hint">Нажмите на заголовок столбца, чтобы отсортировать. «Сальдо» считается за всё время: плюс — клиент должен, минус — аванс.</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>${th('Клиент', 'name', s, A)}<th>Направления</th>${th('В месяц', 'monthly', s, A, 'num')}${th('Начислено', 'accP', s, A, 'num')}${th('Оплачено', 'paidP', s, A, 'num')}${th('Сальдо', 'balance', s, A, 'num')}${th('Просрочено', 'overdue', s, A, 'num')}${th('Посл. оплата', 'days', s, A, 'num')}</tr></thead>
      <tbody>${rows.map(x => `<tr class="click" data-act="open-client" data-id="${x.id}">
        <td>${esc(x.name)}${x.r.client.postpay ? ' <span class="tag">постоплата</span>' : ''}${x.r.client.ooo ? ' <span class="tag">на ООО</span>' : ''}</td>
        <td class="muted small">${x.sections.map(esc).join(', ')}</td>
        <td class="num">${x.monthly ? money(x.monthly) : '—'}</td>
        <td class="num">${money(x.accP)}</td>
        <td class="num">${money(x.paidP)}</td>
        <td class="num ${x.balance > 0.5 ? 'bad-t' : x.balance < -0.5 ? 'ok-t' : ''}">${Math.abs(x.balance) < 0.5 ? '0' : moneyS(x.balance)}</td>
        <td class="num ${x.overdue > 0.5 ? 'bad-t' : ''}">${x.overdue > 0.5 ? money(x.overdue) : '—'}</td>
        <td class="num muted">${x.lastPay ? fmtDate(x.lastPay) + `<br><span class="small">${x.days} дн. назад</span>` : 'не было'}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>Итого (${rows.length})</td><td></td><td></td><td class="num">${money(tot.accP)}</td><td class="num">${money(tot.paidP)}</td><td class="num">${money(tot.balance)}</td><td class="num">${money(tot.overdue)}</td><td></td></tr></tfoot>
    </table></div>`;
}

// Одна строка на клиента за месяц: сколько начислено, сколько из этого закрыто оплатами, что висит с прошлых месяцев.
const MONTH_STATUS = {
  paid: { rank: 4, chip: '<span class="chip ok">✓ оплатил</span>', label: 'Оплатил' },
  partial: { rank: 1, chip: '<span class="chip warn">◐ частично</span>', label: 'Частично' },
  unpaid: { rank: 0, chip: '<span class="chip bad">✕ не оплатил</span>', label: 'Не оплатил' },
  notdue: { rank: 2, chip: '<span class="chip">⏳ постоплата, срок не наступил</span>', label: 'Постоплата, срок не наступил' },
  ooo: { rank: 3, chip: '<span class="chip">на ООО — нет выписки</span>', label: 'На ООО — нет выписки' },
};
function monthClientRows(m) {
  const L = computeLedger();
  const out = [];
  for (const r of L.values()) {
    const acc = r.acc.filter(a => a.month === m);
    if (!acc.length) continue;
    const c = r.client;
    const amount = acc.reduce((s, a) => s + a.amount, 0), paid = acc.reduce((s, a) => s + a.paid, 0), left = round2(amount - paid);
    const oldDebt = r.acc.filter(a => a.month < m).reduce((s, a) => s + a.amount - a.paid, 0);
    const paysInMonth = r.pays.filter(p => p.date.startsWith(m));
    let status = left <= 0.5 ? 'paid' : paid > 0.5 ? 'partial' : 'unpaid';
    if (c.ooo) status = 'ooo';
    else if (status !== 'paid' && c.postpay && m >= addMonths(curMonth(), -1)) status = 'notdue';
    out.push({
      id: c.id, name: c.name, client: c, status, rank: MONTH_STATUS[status].rank,
      sections: [...new Set(acc.map(a => a.section))].join(', '),
      amount, paid, left, oldDebt: round2(oldDebt),
      paidInMonth: paysInMonth.reduce((s, p) => s + p.amount, 0),
      lastPay: r.lastPay ? r.lastPay.date : '',
    });
  }
  return out;
}
function filteredMonthRows() {
  let rows = monthClientRows(UI.month);
  if (!UI.monthShowOoo) rows = rows.filter(x => x.status !== 'ooo');
  const f = UI.monthFilter;
  if (f === 'debtors') rows = rows.filter(x => x.status === 'unpaid' || x.status === 'partial');
  else if (f === 'paid') rows = rows.filter(x => x.status === 'paid');
  else if (f === 'notdue') rows = rows.filter(x => x.status === 'notdue');
  return sortRows(rows, UI.monthSort);
}
function exportMonthXlsx() {
  const rows = filteredMonthRows().map(x => ({
    'Клиент': x.name, 'Направления': x.sections, 'Начислено': Math.round(x.amount), 'Оплачено': Math.round(x.paid),
    'Не оплачено': Math.round(x.left), 'Статус': MONTH_STATUS[x.status].label, 'Долг за прошлые месяцы': Math.round(x.oldDebt),
    'Поступило в месяце': Math.round(x.paidInMonth), 'Последняя оплата': x.lastPay ? fmtDate(x.lastPay) : '—',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 42 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, monthLabel(UI.month));
  XLSX.writeFile(wb, `Оплаты ${monthLabel(UI.month)}.xlsx`);
}
function viewMonthClients(m, months) {
  const all = monthClientRows(m).filter(x => UI.monthShowOoo || x.status !== 'ooo');
  const rows = filteredMonthRows();
  const cnt = st => all.filter(x => x.status === st).length;
  const sum = (arr, k) => arr.reduce((s, x) => s + x[k], 0);
  const debtors = all.filter(x => x.status === 'unpaid' || x.status === 'partial');
  const s = UI.monthSort, A = 'sort-month';
  return `
    <div class="kpis">
      <div class="kpi"><div class="k-label">Начислено за ${esc(monthLabel(m).toLowerCase())}</div><div class="k-val">${money(sum(all, 'amount'))} ₽</div><div class="k-sub">${all.length} клиентов</div></div>
      <div class="kpi"><div class="k-label">Оплатили</div><div class="k-val ok-t">${cnt('paid')} клиентов</div><div class="k-sub">${money(sum(all, 'paid'))} ₽ закрыто</div></div>
      <div class="kpi alert"><div class="k-label">Не оплатили / частично</div><div class="k-val bad-t">${debtors.length} клиентов</div><div class="k-sub">${money(sum(debtors, 'left'))} ₽ не хватает</div></div>
      <div class="kpi"><div class="k-label">Постоплата, срок не наступил</div><div class="k-val">${cnt('notdue')} клиентов</div><div class="k-sub">${money(sum(all.filter(x => x.status === 'notdue'), 'left'))} ₽ ждём</div></div>
    </div>
    <div class="toolbar">
      <select data-act="month-filter">
        ${[['all', 'Все клиенты'], ['debtors', 'Не оплатили'], ['paid', 'Оплатили'], ['notdue', 'Постоплата — ждём']].map(([v, l]) => `<option value="${v}" ${UI.monthFilter === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="check"><input type="checkbox" data-act="month-ooo" ${UI.monthShowOoo ? 'checked' : ''}> Показывать клиентов «на ООО»</label>
      <span class="spacer"></span>
      <button class="btn" data-act="export-month">В Excel</button>
    </div>
    <p class="hint">«Оплатил» — начисление за этот месяц закрыто деньгами. Оплаты сначала гасят старые долги клиента, поэтому у должника с прошлых месяцев текущий месяц может оставаться неоплаченным. Нажмите на заголовок, чтобы отсортировать, на клиента — чтобы открыть историю.</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>${th('Клиент', 'name', s, A)}<th>Направления</th>${th('Начислено', 'amount', s, A, 'num')}${th('Оплачено', 'paid', s, A, 'num')}${th('Не оплачено', 'left', s, A, 'num')}${th('Статус', 'rank', s, A)}${th('Долг за прошлые мес.', 'oldDebt', s, A, 'num')}${th('Посл. оплата', 'lastPay', s, A, 'num')}</tr></thead>
      <tbody>${rows.map(x => `<tr class="click" data-act="open-client" data-id="${x.id}">
        <td>${esc(x.name)}${x.client.postpay ? ' <span class="tag">постоплата</span>' : ''}</td>
        <td class="small muted">${esc(x.sections)}</td>
        <td class="num">${money(x.amount)}</td>
        <td class="num">${x.paid > 0.5 ? money(x.paid) : '—'}</td>
        <td class="num ${x.left > 0.5 && (x.status === 'unpaid' || x.status === 'partial') ? 'bad-t' : ''}">${x.left > 0.5 ? money(x.left) : '—'}</td>
        <td>${MONTH_STATUS[x.status].chip}</td>
        <td class="num ${x.oldDebt > 0.5 ? 'bad-t' : 'muted'}">${x.oldDebt > 0.5 ? money(x.oldDebt) : '—'}</td>
        <td class="num muted">${x.lastPay ? fmtDate(x.lastPay) : 'не было'}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Нет клиентов под этот фильтр</td></tr>'}</tbody>
      <tfoot><tr><td>Итого (${rows.length})</td><td></td><td class="num">${money(sum(rows, 'amount'))}</td><td class="num">${money(sum(rows, 'paid'))}</td><td class="num">${money(sum(rows, 'left'))}</td><td></td><td class="num">${money(sum(rows, 'oldDebt'))}</td><td></td></tr></tfoot>
    </table></div>`;
}

function viewMonth() {
  const m = UI.month;
  const L = computeLedger();
  const lines = [...L.values()].flatMap(r => r.acc.filter(a => a.month === m).map(a => ({ ...a, client: r.client })));
  const months = [...new Set([curMonth(), addMonths(curMonth(), 1), ...S.accruals.map(a => a.month)])].sort().reverse();
  const modeSwitch = `<div class="seg">${[['clients', 'По клиентам'], ['lines', 'По строкам таблицы']].map(([v, l]) => `<button class="${UI.monthMode === v ? 'active' : ''}" data-act="month-mode" data-mode="${v}">${l}</button>`).join('')}</div>`;
  if (UI.monthMode !== 'lines') return `
    <div class="toolbar">
      <label>Месяц <select data-act="set-month">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x)}</option>`).join('')}</select></label>
      ${modeSwitch}
    </div>
    ${lines.length ? viewMonthClients(m, months) : `<div class="empty"><p>За ${esc(monthLabel(m).toLowerCase())} начислений нет. Переключитесь на «По строкам таблицы», чтобы скопировать прошлый месяц или импортировать.</p></div>`}`;
  const bySec = SECTIONS.concat([...new Set(lines.map(l => l.section))].filter(s => !SECTIONS.includes(s)))
    .map(sec => ({ sec, items: lines.filter(l => l.section === sec).sort((a, b) => a.client.name.localeCompare(b.client.name, 'ru')) }))
    .filter(g => g.items.length);
  const tot = lines.reduce((s, l) => s + l.amount, 0), paid = lines.reduce((s, l) => s + l.paid, 0);
  return `
    <div class="toolbar">
      <label>Месяц <select data-act="set-month">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${monthLabel(x)}</option>`).join('')}</select></label>
      ${modeSwitch}
      <span class="muted">Начислено <b>${money(tot)}</b> · оплачено <b>${money(paid)}</b> · осталось <b class="${tot - paid > 0.5 ? 'bad-t' : ''}">${money(tot - paid)}</b></span>
      <span class="spacer"></span>
      <button class="btn" data-act="copy-prev">Скопировать из ${esc(monthLabel(addMonths(m, -1)).toLowerCase())}</button>
      <label class="btn">Импорт из «Оплаты.xlsx»<input type="file" accept=".xlsx" hidden data-act="plan-file"></label>
      <button class="btn" data-act="add-line">+ Строка</button>
    </div>
    <p class="hint">Статус считается автоматически: оплаты клиента гасят его самые старые начисления. Сумму можно поправить прямо в таблице.</p>
    ${bySec.length ? bySec.map(g => {
      const t = g.items.reduce((s, l) => s + l.amount, 0), p = g.items.reduce((s, l) => s + l.paid, 0);
      return `<section class="card"><h3>${esc(g.sec)} <span class="muted small">${money(p)} из ${money(t)}</span></h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Клиент</th><th>Работа (как в таблице)</th><th class="num">Сумма</th><th class="num">Оплачено</th><th>Статус</th><th></th></tr></thead><tbody>
      ${g.items.map(l => `<tr>
        <td><a href="#" data-act="open-client" data-id="${l.client.id}">${esc(l.client.name)}</a></td>
        <td class="small muted">${esc(l.title)}</td>
        <td class="num"><input class="amt" type="number" step="0.01" value="${l.amount}" data-act="edit-amount" data-id="${l.id}"></td>
        <td class="num">${money(l.paid)}</td>
        <td>${statusChip(l.status)}</td>
        <td><button class="icon" title="Удалить строку" data-act="del-line" data-id="${l.id}">×</button></td>
      </tr>`).join('')}</tbody></table></div></section>`;
    }).join('') : `<div class="empty"><p>За ${esc(monthLabel(m).toLowerCase())} начислений нет. Скопируйте прошлый месяц или импортируйте из «Оплаты.xlsx».</p></div>`}`;
}

function viewPayments() {
  let list = S.payments.slice();
  const f = UI.payFilter;
  if (f === 'unmatched') list = list.filter(p => !p.ignored && !p.clientId);
  else if (f === 'matched') list = list.filter(p => !p.ignored && p.clientId);
  else if (f === 'ignored') list = list.filter(p => p.ignored);
  if (UI.payClient) list = list.filter(p => p.clientId === UI.payClient);
  const q = norm(UI.paySearch);
  if (q) list = list.filter(p => norm(p.payer + ' ' + p.desc).includes(q));
  list.sort((a, b) => b.date.localeCompare(a.date));
  // нераспознанные — группируем по плательщику, так разбирать быстрее
  const groups = f === 'unmatched' ? [...list.reduce((m, p) => { const k = p.payerNorm || '—'; (m.get(k) || m.set(k, []).get(k)).push(p); return m; }, new Map()).values()].sort((a, b) => b.reduce((s, p) => s + p.amount, 0) - a.reduce((s, p) => s + p.amount, 0)) : null;
  const total = list.reduce((s, p) => s + p.amount, 0);
  return `
    <div class="toolbar">
      <label class="btn primary">Загрузить выписку<input type="file" accept=".xlsx,.xls,.csv" hidden data-act="bank-file"></label>
      <select data-act="pay-filter">
        ${[['unmatched', 'Нераспознанные'], ['matched', 'Оплаты клиентов'], ['ignored', 'Не клиентские (депозиты и пр.)'], ['all', 'Все поступления']].map(([v, l]) => `<option value="${v}" ${f === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select data-act="pay-client"><option value="">Все клиенты</option>${clientOptions(UI.payClient)}</select>
      <input type="search" placeholder="Плательщик или назначение" value="${esc(UI.paySearch)}" data-act="pay-search">
      <span class="muted">${list.length} шт. на ${money(total)} ₽</span>
    </div>
    ${groups ? (groups.length ? `<p class="hint">Выберите клиента — я запомню этого плательщика и в следующих выписках отмечу его сам.</p>` + groups.map(g => `
      <section class="card payer-group">
        <div class="row gap wrap">
          <div class="grow"><b>${esc(g[0].payer || 'Плательщик не указан')}</b> <span class="muted">· ${g.length} плат. на ${money(g.reduce((s, p) => s + p.amount, 0))} ₽</span>
            <div class="small muted">${esc(g[0].desc)}</div></div>
          <select data-act="assign-group" data-ids="${g.map(p => p.id).join(',')}">
            <option value="">— Кому отнести? —</option>
            <option value="__new">+ Создать нового клиента</option>
            <option value="__ignore">Не оплата клиента (игнорировать)</option>
            ${clientOptions('')}
          </select>
        </div>
      </section>`).join('') : '<div class="empty"><p>Все поступления распознаны 👌</p></div>') : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Дата</th><th>Плательщик</th><th class="num">Сумма</th><th>Назначение</th><th>Клиент</th><th>Тип</th></tr></thead>
      <tbody>${list.slice(0, 1000).map(p => `<tr>
        <td class="nowrap">${fmtDate(p.date)}</td>
        <td class="small">${esc(p.payer)}</td>
        <td class="num">${money(p.amount)}</td>
        <td class="small muted desc">${esc(p.desc)}${p.invoiceNo ? ` <span class="tag">счёт ${esc(p.invoiceNo)}</span>` : ''}</td>
        <td><select data-act="assign-one" data-id="${p.id}">
          <option value="">—</option><option value="__ignore" ${p.ignored ? 'selected' : ''}>Не клиент</option>${clientOptions(p.clientId)}
        </select>${p.ignored && p.ignoreReason ? `<div class="small muted">${esc(p.ignoreReason)}</div>` : ''}</td>
        <td>${p.clientId && !p.ignored ? `<select data-act="set-kind" data-id="${p.id}">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${(p.kind || 'regular') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>${list.length > 1000 ? '<p class="muted">Показаны первые 1000 — уточните фильтр.</p>' : ''}`}`;
}

function viewAnalytics() {
  const per = UI.period;
  const rows = clientRows();
  const totalPaid = rows.reduce((s, x) => s + x.paidP, 0) || 1;
  const sorted = sortRows(rows.filter(x => x.paidP > 0 || x.accP > 0), UI.analyticsSort);
  let cum = 0;
  const byPaid = rows.slice().sort((a, b) => b.paidP - a.paidP);
  const top5 = byPaid.slice(0, 5).reduce((s, x) => s + x.paidP, 0);
  // выручка по направлениям (начисления)
  const secs = {};
  S.accruals.filter(a => inPeriod(a.month, per)).forEach(a => { secs[a.section] = (secs[a.section] || 0) + a.amount; });
  const secTotal = Object.values(secs).reduce((s, v) => s + v, 0) || 1;
  const silent = rows.filter(x => x.monthly > 0 && x.days > 45).sort((a, b) => b.days - a.days);
  const s = UI.analyticsSort, A = 'sort-analytics';
  const maxPaid = Math.max(1, ...sorted.map(x => x.paidP));
  return `
    <div class="toolbar"><label>Период <select data-act="set-period">${periodOptions()}</select></label></div>
    <div class="kpis">
      <div class="kpi"><div class="k-label">Поступило от клиентов</div><div class="k-val">${money(totalPaid)} ₽</div></div>
      <div class="kpi"><div class="k-label">Доля топ-5 клиентов</div><div class="k-val">${Math.round(top5 / totalPaid * 100)}%</div><div class="k-sub">${byPaid.slice(0, 5).map(x => esc(x.name.split(' (')[0])).join(', ')}</div></div>
      <div class="kpi"><div class="k-label">Собираемость</div><div class="k-val">${rows.reduce((s, x) => s + x.accP, 0) ? Math.round(totalPaid / rows.reduce((s, x) => s + x.accP, 0) * 100) + '%' : '—'}</div><div class="k-sub">оплачено / начислено за период</div></div>
    </div>
    <div class="grid2">
      <section class="card"><h3>Кто сколько оплатил</h3>
        <div class="tbl-wrap"><table class="tbl compact"><thead><tr>${th('Клиент', 'name', s, A)}${th('Оплачено', 'paidP', s, A, 'num')}<th class="num">Доля</th>${th('Начислено', 'accP', s, A, 'num')}${th('Сальдо', 'balance', s, A, 'num')}</tr></thead><tbody>
        ${sorted.map(x => { cum += x.paidP; return `<tr class="click" data-act="open-client" data-id="${x.id}"><td>${esc(x.name)}<div class="bar"><i style="width:${x.paidP / maxPaid * 100}%"></i></div></td><td class="num">${money(x.paidP)}</td><td class="num muted">${(x.paidP / totalPaid * 100).toFixed(1)}%</td><td class="num">${money(x.accP)}</td><td class="num ${x.balance > 0.5 ? 'bad-t' : ''}">${moneyS(x.balance)}</td></tr>`; }).join('')}
        </tbody></table></div></section>
      <div>
        <section class="card"><h3>Начисления по направлениям</h3>
          ${Object.entries(secs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="bar"><i style="width:${v / secTotal * 100}%"></i></div><span class="num">${money(v)} <span class="muted small">${Math.round(v / secTotal * 100)}%</span></span></div>`).join('') || '<p class="muted">Нет начислений за период.</p>'}
        </section>
        <section class="card"><h3>Платят по плану, но давно не платили (&gt;45 дней)</h3>
          ${silent.length ? `<table class="tbl compact"><tbody>${silent.map(x => `<tr class="click" data-act="open-client" data-id="${x.id}"><td>${esc(x.name)}</td><td class="num">${money(x.monthly)}/мес</td><td class="num bad-t">${x.days > 9999 ? 'ни разу' : x.days + ' дн.'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Таких нет.</p>'}
        </section>
      </div>
    </div>`;
}

function viewData() {
  const unUsed = S.clients.filter(c => !S.accruals.some(a => a.clientId === c.id) && !S.payments.some(p => p.clientId === c.id));
  return `
    <section class="card"><h3>Загрузка данных</h3>
      <div class="row gap wrap">
        <label class="btn primary">Банковская выписка<input type="file" accept=".xlsx,.xls,.csv" hidden data-act="bank-file"></label>
        <label class="btn">Начисления из «Оплаты.xlsx»<input type="file" accept=".xlsx" hidden data-act="plan-file"></label>
        <button class="btn" data-act="rematch">Перераспознать платежи</button>
      </div>
      <p class="hint">Выписку можно грузить сколько угодно раз — повторы я пропускаю. Ручная разметка не перезаписывается.</p>
    </section>
    <section class="card"><h3>Резервная копия</h3>
      <p class="hint">Все данные хранятся только в этом браузере на этом компьютере. Раз в неделю сохраняйте копию в файл.</p>
      <div class="row gap wrap">
        <button class="btn" data-act="backup">Сохранить копию (.json)</button>
        <label class="btn">Восстановить из копии<input type="file" accept=".json" hidden data-act="restore"></label>
        <button class="btn danger" data-act="reset">Очистить всё</button>
      </div>
    </section>
    <section class="card"><h3>История загрузок</h3>
      ${S.log.length ? `<table class="tbl compact"><thead><tr><th>Когда</th><th>Файл</th><th>Итог</th></tr></thead><tbody>${S.log.slice(0, 30).map(l => `<tr><td class="nowrap">${new Date(l.at).toLocaleString('ru-RU')}</td><td class="small">${esc(l.file)}</td><td class="small">${l.kind === 'bank' ? `период ${esc(l.period)}: новых ${l.added}, повторов ${l.dup}, распознано ${l.matched}, служебных ${l.service}` : esc(l.summary)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Пока ничего не загружали.</p>'}
    </section>
    <section class="card"><h3>Клиенты без начислений и оплат (${unUsed.length})</h3>
      <p class="small muted">${unUsed.map(c => esc(c.name)).join(', ') || '—'}</p>
    </section>`;
}

// ---------- карточка клиента ----------
function openClient(id) {
  const L = computeLedger();
  const r = L.get(id); if (!r) return;
  const c = r.client;
  const events = [
    ...r.acc.map(a => ({ date: a.month === '0000-00' ? '0000-00-00' : a.month + '-01', kind: 'acc', a })),
    ...r.pays.map(p => ({ date: p.date, kind: 'pay', p })),
  ].sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'acc' ? -1 : 1));
  const rowsHtml = events.map(e => {
    if (e.kind === 'acc') { const left = e.a.amount - e.a.paid; return `<tr><td class="nowrap">${e.a.month === '0000-00' ? '—' : monthShort(e.a.month)}</td><td>${esc(e.a.section)} <span class="muted small">${esc(e.a.title)}</span></td><td class="num">${money(e.a.amount)}</td><td></td><td class="num ${left > 0.5 ? 'bad-t' : ''}">${left > 0.5 ? money(left) : '—'}</td><td>${statusChip(e.a.status)}</td></tr>`; }
    const kind = e.p.kind || 'regular';
    return `<tr class="payrow"><td class="nowrap">${fmtDate(e.p.date)}</td><td class="small">${kind === 'regular' ? 'Оплата' : `<span class="tag">${KINDS[kind]}</span>`}${e.p.invoiceNo ? ` по счёту ${esc(e.p.invoiceNo)}` : ''} · <span class="muted">${esc(e.p.desc.slice(0, 120))}</span></td><td></td><td class="num ok-t">${money(e.p.amount)}</td><td></td><td></td></tr>`;
  }).join('');
  $('#modal-body').innerHTML = `
    <div class="row gap wrap"><h2 class="grow">${esc(c.name)}</h2><button class="icon" data-act="close-modal">×</button></div>
    <div class="kpis small-kpis">
      <div class="kpi"><div class="k-label">Сальдо</div><div class="k-val ${r.balance > 0.5 ? 'bad-t' : 'ok-t'}">${moneyS(r.balance)} ₽</div><div class="k-sub">${r.balance > 0.5 ? 'клиент должен' : r.balance < -0.5 ? 'аванс' : 'в расчёте'}</div></div>
      <div class="kpi"><div class="k-label">Просрочено</div><div class="k-val">${money(r.overdue)} ₽</div></div>
      <div class="kpi"><div class="k-label">Начислено / оплачено всего</div><div class="k-val">${money(r.accruedAll)} / ${money(r.paidAll)}</div><div class="k-sub">${r.oneoffPaid ? `из оплат ${money(r.oneoffPaid)} — разовые работы` : '&nbsp;'}</div></div>
    </div>
    ${c.ooo ? '<div class="notice">Клиент платит на ООО — его оплат нет в загруженной выписке ИП. Загрузите выписку ООО, иначе долг будет завышен.</div>' : ''}
    <form class="client-form" data-id="${c.id}">
      <label>Название <input name="name" value="${esc(c.name)}"></label>
      <label>Контакт <input name="contact" value="${esc(c.contact)}"></label>
      <label>Долг на начало учёта, ₽ <input name="opening" type="number" step="0.01" value="${c.opening || 0}" title="Минус — аванс на начало"></label>
      <label class="check"><input type="checkbox" name="postpay" ${c.postpay ? 'checked' : ''}> Постоплата (платит после закрытия месяца)</label>
      <label class="check"><input type="checkbox" name="ooo" ${c.ooo ? 'checked' : ''}> Платит на ООО</label>
      <label class="wide">Заметка <textarea name="note" rows="2">${esc(c.note)}</textarea></label>
      <label class="wide">Ключевые слова для узнавания (через запятую) <input name="kw" value="${esc(c.kw.join(', '))}"></label>
      <div class="wide small muted">Плательщики в выписке: ${c.payers.map(esc).join('; ') || '—'}${c.accounts.length ? '<br>Счета: ' + c.accounts.join(', ') : ''}</div>
      <div class="wide row gap wrap"><button class="btn primary" type="submit">Сохранить</button><span class="spacer"></span>
        <select data-act="merge-into" data-id="${c.id}" title="Например, если клиент платит через агентство или сменил юрлицо"><option value="">Перенести всё в другого клиента…</option>${clientOptions('').replace(`<option value="${c.id}" >${esc(c.name)}</option>`, '')}</select>
        <button class="btn danger" type="button" data-act="del-client" data-id="${c.id}">Удалить клиента</button></div>
    </form>
    <h3>История: начисления и оплаты</h3>
    <div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Дата</th><th>Операция</th><th class="num">Начислено</th><th class="num">Оплачено</th><th class="num">Не оплачено</th><th>Статус</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="6" class="muted">Пусто</td></tr>'}</tbody></table></div>`;
  $('#modal').showModal();
}

// ---------- импорт плана: мастер сопоставления ----------
let planWB = null;
async function startPlanImport(file) {
  planWB = await readWorkbook(file);
  const sheets = planSheets(planWB);
  if (!sheets.length) throw new Error('Не нашёл листов вида «Октябрь 2026».');
  const year = curMonth().slice(0, 4);
  $('#modal-body').innerHTML = `
    <div class="row gap"><h2 class="grow">Импорт начислений из «${esc(file.name)}»</h2><button class="icon" data-act="close-modal">×</button></div>
    <p class="hint">Отметьте месяцы. Начисления за отмеченные месяцы, загруженные раньше из таблицы, будут заменены (ручные строки останутся).</p>
    <div class="months-pick">${sheets.slice().reverse().map(s => `<label class="check"><input type="checkbox" value="${s.month}|${esc(s.sheet)}" ${s.month.startsWith(year) ? 'checked' : ''}> ${monthLabel(s.month)}</label>`).join('')}</div>
    <label class="check"><input type="checkbox" id="skip-mutki" checked> Пропустить раздел «Мутки»</label>
    <label class="check"><input type="checkbox" id="dedupe-dev" checked> «Разработка»: одинаковая строка в нескольких месяцах — это один этап, а не ежемесячный платёж</label>
    <div class="row gap"><button class="btn primary" data-act="plan-preview">Дальше: сопоставить клиентов</button></div>`;
  $('#modal').showModal();
}
let planRows = [], planDedupeDev = true;
function planPreview() {
  const picked = [...document.querySelectorAll('.months-pick input:checked')].map(i => i.value.split('|'));
  const skipMutki = $('#skip-mutki').checked;
  planDedupeDev = $('#dedupe-dev').checked;
  planRows = picked.flatMap(([month, sheet]) => parsePlanSheet(planWB, sheet, month)).filter(r => !(skipMutki && r.section === 'Мутки'));
  const names = new Map();
  for (const r of planRows) { const k = norm(r.title); const g = names.get(k) || { title: r.title, rows: [], match: matchAccrualName(r.title) }; g.rows.push(r); names.set(k, g); }
  const list = [...names.entries()].sort((a, b) => (a[1].match ? 1 : 0) - (b[1].match ? 1 : 0) || a[1].title.localeCompare(b[1].title, 'ru'));
  const unmatched = list.filter(([, g]) => !g.match).length;
  $('#modal-body').innerHTML = `
    <div class="row gap"><h2 class="grow">Сопоставление: ${planRows.length} строк, ${list.length} названий</h2><button class="icon" data-act="close-modal">×</button></div>
    <p class="hint">${unmatched ? `<b>${unmatched}</b> названий не узнал — выберите клиента или «создать нового». ` : 'Все названия узнал. '}Проверьте и остальные. Выбор запомню для следующих импортов.</p>
    <div class="tbl-wrap tall"><table class="tbl compact"><thead><tr><th>Название в таблице</th><th>Месяцы</th><th class="num">Сумма (посл.)</th><th>Клиент</th></tr></thead><tbody>
    ${list.map(([k, g]) => `<tr class="${g.match ? '' : 'warnrow'}"><td class="small">${esc(g.title)}</td><td class="small muted">${[...new Set(g.rows.map(r => monthShort(r.month)))].join(', ')}</td><td class="num">${money(g.rows[g.rows.length - 1].amount)}</td>
      <td><select data-key="${esc(k)}" class="plan-map"><option value="">— пропустить —</option><option value="__new" ${g.match ? '' : 'selected'}>+ новый клиент</option>${clientOptions(g.match ? g.match.id : '')}</select></td></tr>`).join('')}
    </tbody></table></div>
    <div class="row gap"><button class="btn primary" data-act="plan-commit">Импортировать</button></div>`;
}
function cleanName(t) {
  return t.replace(/https?:\/\/\S+|@\S+|\S+@\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
function planCommit() {
  const map = {};
  document.querySelectorAll('.plan-map').forEach(s => { map[s.dataset.key] = s.value; });
  const created = {};
  for (const [k, v] of Object.entries(map)) {
    if (v === '__new') {
      const title = planRows.find(r => norm(r.title) === k).title;
      const c = { id: uid(), name: cleanName(title), payers: [], accounts: [], kw: [], aliases: [k], postpay: false, opening: 0, contact: '', note: '', archived: false };
      S.clients.push(c); created[k] = c.id;
    } else if (v) {
      const c = clientById(v); if (c && !c.aliases.includes(k) && !(kwMatch(k) && kwMatch(k).id === v)) c.aliases.push(k);
    }
  }
  const months = [...new Set(planRows.map(r => r.month))];
  S.accruals = S.accruals.filter(a => !(a.source === 'import' && months.includes(a.month)));
  let n = 0, merged = 0;
  const devSeen = new Set(S.accruals.filter(a => a.section === 'Разработка').map(a => `${a.clientId}|${norm(a.title)}|${a.amount}`));
  for (const r of planRows.slice().sort((a, b) => a.month.localeCompare(b.month))) {
    const k = norm(r.title); const cid = created[k] || (map[k] !== '__new' ? map[k] : '');
    if (!cid) continue;
    if (planDedupeDev && r.section === 'Разработка') {
      const dk = `${cid}|${k}|${r.amount}`;
      if (devSeen.has(dk)) { merged++; continue; }
      devSeen.add(dk);
    }
    S.accruals.push({ id: uid(), clientId: cid, month: r.month, section: r.section, title: r.title, amount: r.amount, note: r.note, source: 'import' });
    n++;
  }
  reclassifyAll();
  const summary = `месяцы: ${months.map(monthShort).join(', ')}; строк ${n}${merged ? ` (повторов этапов разработки пропущено: ${merged})` : ''}, новых клиентов ${Object.keys(created).length}`;
  S.log.unshift({ at: new Date().toISOString(), kind: 'plan', file: 'Оплаты.xlsx', summary });
  save();
  $('#modal').close();
  toast('Начисления загружены: ' + summary, 'ok');
  render();
}

// ---------- новый клиент из группы плательщиков ----------
function createClientFromPayer(p) {
  const name = prompt('Название клиента', p.payer.replace(/^(ООО|ИП|АО|ПАО)\s+/i, '').replace(/["«»]/g, '').trim());
  if (!name) return null;
  const c = { id: uid(), name, payers: [], accounts: [], kw: [], aliases: [], postpay: false, opening: 0, contact: '', note: '', archived: false };
  S.clients.push(c); return c;
}

// ---------- события ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const act = t.dataset.act;
  if (t.tagName === 'SELECT' || t.tagName === 'INPUT' && act !== 'export-debts') return;
  if (t.tagName === 'A') e.preventDefault();
  switch (act) {
    case 'goto': UI.tab = t.dataset.tab; if (t.dataset.filter) UI.payFilter = t.dataset.filter; render(); break;
    case 'open-client': openClient(t.dataset.id); break;
    case 'close-modal': $('#modal').close(); render(); break;
    case 'sort-clients': case 'sort-analytics': case 'sort-month': {
      const s = act === 'sort-clients' ? UI.clientSort : act === 'sort-month' ? UI.monthSort : UI.analyticsSort;
      if (s.key === t.dataset.key) s.dir = -s.dir; else { s.key = t.dataset.key; s.dir = ['name', 'rank'].includes(t.dataset.key) ? 1 : -1; }
      render(); break;
    }
    case 'month-mode': UI.monthMode = t.dataset.mode; render(); break;
    case 'export-month': exportMonthXlsx(); break;
    case 'export-debts': exportDebtsXlsx(); break;
    case 'backup': exportBackup(); break;
    case 'reset': if (confirm('Удалить все клиенты, начисления и платежи из этого браузера? Сначала сохраните копию.')) { S = freshState(); save(); render(); } break;
    case 'rematch': toast('Перераспознано платежей: ' + rematchAll(), 'ok'); render(); break;
    case 'copy-prev': {
      const prev = addMonths(UI.month, -1);
      const src = S.accruals.filter(a => a.month === prev);
      if (!src.length) { toast('В прошлом месяце нет начислений', 'bad'); break; }
      if (S.accruals.some(a => a.month === UI.month) && !confirm('В этом месяце уже есть строки. Добавить к ним строки прошлого месяца?')) break;
      src.forEach(a => S.accruals.push({ ...a, id: uid(), month: UI.month, source: 'manual' }));
      save(); render(); toast(`Скопировано строк: ${src.length}`, 'ok'); break;
    }
    case 'add-line': {
      $('#modal-body').innerHTML = `<div class="row gap"><h2 class="grow">Новая строка — ${esc(monthLabel(UI.month))}</h2><button class="icon" data-act="close-modal">×</button></div>
        <form class="client-form" id="line-form">
          <label>Клиент <select name="clientId" required>${clientOptions('')}</select></label>
          <label>Направление <select name="section">${SECTIONS.map(s => `<option>${s}</option>`).join('')}</select></label>
          <label class="wide">Работа <input name="title" placeholder="например: доработка сайта, 50% предоплата"></label>
          <label>Сумма, ₽ <input name="amount" type="number" step="0.01" required></label>
          <div class="wide"><button class="btn primary" type="submit">Добавить</button></div>
        </form>`;
      $('#modal').showModal(); break;
    }
    case 'del-line': S.accruals = S.accruals.filter(a => a.id !== t.dataset.id); save(); render(); break;
    case 'new-client': {
      const name = prompt('Название клиента'); if (!name) break;
      const c = { id: uid(), name, payers: [], accounts: [], kw: [], aliases: [], postpay: false, opening: 0, contact: '', note: '', archived: false };
      S.clients.push(c); save(); render(); openClient(c.id); break;
    }
    case 'del-client': {
      const id = t.dataset.id, c = clientById(id);
      const n = S.accruals.filter(a => a.clientId === id).length;
      if (!confirm(`Удалить «${c.name}»? Его начисления (${n}) удалятся, платежи станут нераспознанными.`)) break;
      S.clients = S.clients.filter(x => x.id !== id); S.accruals = S.accruals.filter(a => a.clientId !== id);
      S.payments.forEach(p => { if (p.clientId === id) { p.clientId = null; p.auto = true; } });
      save(); $('#modal').close(); render(); break;
    }
    case 'plan-preview': planPreview(); break;
    case 'plan-commit': planCommit(); break;
  }
});
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) { UI.tab = b.dataset.tab; render(); } });
document.addEventListener('change', async e => {
  const t = e.target, act = t.dataset.act; if (!act) return;
  try {
    switch (act) {
      case 'bank-file': {
        const f = t.files[0]; if (!f) return;
        const res = importBank(parseBank(await readWorkbook(f)), f.name);
        toast(`Выписка загружена: новых ${res.added} (повторов ${res.dup}). Распознано ${res.matched}, служебных ${res.service}, не узнал ${res.unmatched}.`, 'ok');
        if (res.unmatched) { UI.tab = 'payments'; UI.payFilter = 'unmatched'; }
        render(); break;
      }
      case 'plan-file': { const f = t.files[0]; if (f) await startPlanImport(f); break; }
      case 'restore': {
        const f = t.files[0]; if (!f) return;
        const data = JSON.parse(await f.text());
        if (!data.clients || !data.payments) throw new Error('Это не резервная копия nuts-crm');
        if (!confirm('Заменить текущие данные данными из копии?')) return;
        S = data; save(); render(); toast('Данные восстановлены', 'ok'); break;
      }
      case 'set-month': UI.month = t.value; render(); break;
      case 'set-period': UI.period = t.value; render(); break;
      case 'month-filter': UI.monthFilter = t.value; render(); break;
      case 'month-ooo': UI.monthShowOoo = t.checked; render(); break;
      case 'pay-filter': UI.payFilter = t.value; render(); break;
      case 'pay-client': UI.payClient = t.value; render(); break;
      case 'edit-amount': { const a = S.accruals.find(x => x.id === t.dataset.id); if (a) { a.amount = round2(num(t.value)); save(); render(); } break; }
      case 'assign-one': assignPayment(t.dataset.id, t.value, false); render(); break;
      case 'merge-into': {
        const from = clientById(t.dataset.id), to = clientById(t.value);
        if (!from || !to) return;
        if (!confirm(`Перенести начисления, платежи и плательщиков «${from.name}» в «${to.name}»? Карточка «${from.name}» будет удалена.`)) { t.value = ''; return; }
        mergeClients(from.id, to.id); openClient(to.id); render(); toast('Клиенты объединены', 'ok'); break;
      }
      case 'set-kind': { const p = S.payments.find(x => x.id === t.dataset.id); if (p) { p.kind = t.value; p.kindManual = true; save(); render(); } break; }
      case 'assign-group': {
        const ids = t.dataset.ids.split(',');
        let v = t.value; if (!v) return;
        if (v === '__new') { const c = createClientFromPayer(S.payments.find(p => p.id === ids[0])); if (!c) { t.value = ''; return; } v = c.id; }
        ids.forEach((id, i) => assignPayment(id, v, i === 0));
        render(); toast('Готово, плательщика запомнил', 'ok'); break;
      }
    }
  } catch (err) { console.error(err); toast(err.message, 'bad'); }
  finally { if (t.type === 'file') t.value = ''; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'client-search') { UI.clientSearch = t.value; rerenderKeepFocus(t); }
  if (t.dataset.act === 'pay-search') { UI.paySearch = t.value; rerenderKeepFocus(t); }
});
function rerenderKeepFocus(t) {
  const act = t.dataset.act, pos = t.selectionStart;
  render(); const n = document.querySelector(`[data-act="${act}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
}
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  if (f.id === 'line-form') {
    S.accruals.push({ id: uid(), clientId: d.clientId, month: UI.month, section: d.section, title: d.title || d.section, amount: round2(num(d.amount)), source: 'manual' });
    save(); $('#modal').close(); render(); return;
  }
  if (f.classList.contains('client-form')) {
    const c = clientById(f.dataset.id); if (!c) return;
    c.name = d.name.trim() || c.name; c.contact = d.contact; c.note = d.note; c.opening = round2(num(d.opening));
    c.postpay = !!d.postpay; c.ooo = !!d.ooo; c.kw = d.kw.split(',').map(s => s.trim()).filter(Boolean);
    save(); toast('Сохранено', 'ok'); openClient(c.id); render();
  }
});
// подсказка при наведении на столбики графика
document.addEventListener('mousemove', e => {
  const tip = $('#tip'); const h = e.target.closest && e.target.closest('[data-tip]');
  if (!h) { tip.hidden = true; return; }
  tip.hidden = false; tip.textContent = h.dataset.tip;
  tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
});

// ---------- старт ----------
S = load() || freshState();
// разовая миграция: Догма платит через РА «Тренд-Юг» (подтверждено 21.10.2026)
if (clientById('trend') && clientById('dogma')) { mergeClients('trend', 'dogma'); clientById('dogma').name = 'Догма (платит через РА «Тренд-Юг»)'; save(); }
{ const pn = (window.SEED_PRIVATE || {}).dogma; if (clientById('dogma') && !clientById('dogma').note && pn && pn.note) { clientById('dogma').note = pn.note; save(); } }
render();
