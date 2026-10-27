// Radar de noticias de Medialuna: lee los feeds de `fuentes.json`, agrupa las noticias que hablan de lo mismo y avisa de las que son tendencia.
// NO publica nada ni usa IA: solo código. Tú ves el aviso y decides (luego `node tarjeta.mjs <url> "PALABRA"`).
// Uso: node radar.mjs [--top 8] [--horas 8] [--min-medios 2] [--no-telegram] [--sin-estado]
// Telegram (opcional): TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en `.env` de la raíz (nunca en el código ni en Git). Sin ellos, solo imprime y escribe cm/alertas.md.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[i + 1]); };
const TOP = Number(arg('--top', 8));
const fuentes = JSON.parse(readFileSync(join(DIR, 'fuentes.json'), 'utf8'));
const temas = JSON.parse(readFileSync(join(DIR, 'temas.json'), 'utf8'));
const HORAS = Number(arg('--horas', fuentes.ventana_horas ?? 8));
const MIN_MEDIOS = Number(arg('--min-medios', 2));

// .env de la raíz (solo lectura; no se imprime)
for (const envFile of [join(DIR, '.env'), join(DIR, '..', '.env')]) if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }

const decode = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (b, t) => { const m = b.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, 'i')); return m ? decode(m[1]) : ''; };
const attr = (b, re) => { const m = b.match(re); return m ? m[1] : ''; };

const parse = (xml, medio) => [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => {
  const b = m[0];
  let title = tag(b, 'title');
  let fuente = medio;
  const gm = title.match(/^(.*) - ([^-]{2,40})$/); // Google Noticias: «Titular - Medio»
  if (medio === 'Google Noticias' && gm) { title = gm[1]; fuente = gm[2]; }
  const link = (tag(b, 'link') || attr(b, /<link[^>]*href="([^"]+)"/i)).trim();
  const date = new Date(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published'));
  const img = attr(b, /<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) || attr(b, /<enclosure[^>]*url="([^"]+)"/i);
  return {title, link, fuente, date, resumen: tag(b, 'description').slice(0, 300), img};
}).filter((x) => x.title && !isNaN(x.date));

const sinTildesBase = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const get = async (url) => { try { const r = await fetch(url, {headers: {'user-agent': 'Mozilla/5.0'}, signal: AbortSignal.timeout(15000)}); return r.ok ? await r.text() : ''; } catch { return ''; } };

const urls = [
  ...fuentes.rss.map((f) => ({medio: f.medio, url: f.url})),
  ...fuentes.gnews.map((q) => ({medio: 'Google Noticias', url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:1d')}&${fuentes.gnews_params}`})),
];
const lotes = await Promise.all(urls.map(async (u) => parse(await get(u.url), u.medio)));
const desde = Date.now() - HORAS * 3600e3;
const puerta = fuentes.puerta_futbol.map((w) => sinTildesBase(w));
let items = lotes.flat().filter((i) => i.date.getTime() >= desde && !fuentes.ruido.some((w) => sinTildesBase(i.title).includes(sinTildesBase(w))) && (fuentes.solo_futbol.includes(i.fuente) || (fuentes.rss.every((f) => f.medio !== i.fuente) ? puerta.some((w) => sinTildesBase(i.title).includes(w)) : true)));
// duplicados exactos (mismo medio y titular)
const visto = new Set();
items = items.filter((i) => { const k = `${i.fuente}|${i.title.toLowerCase()}`; if (visto.has(k)) return false; visto.add(k); return true; });

// ---- Rasgos: nombres propios y cifras (valen entre idiomas) ----
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'a', 'al', 'por', 'para', 'con', 'que', 'se', 'su', 'sus', 'es', 'the', 'of', 'and', 'in', 'to', 'for', 'on', 'a', 'is', 'how', 'why', 'what', 'tras', 'ante', 'sobre', 'como', 'más', 'mas', 'sin', 'ya', 'no', 'si']);
const rasgos = (t) => {
  const ws = t.replace(/[“”"«»:,.;!?¿¡()'’]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set();
  ws.forEach((w, i) => {
    const k = sinTildes(w);
    if (STOP.has(k) || k.length < 3) return;
    if (/^\d{2,}$/.test(k)) set.add(k);
    else if (/^[A-ZÁÉÍÓÚÑ]/.test(w) && (i > 0 || temas.grandes.concat(temas.estrellas).some((n) => sinTildes(n) === k))) set.add(k);
  });
  return set;
};
items.forEach((i) => { i.f = rasgos(i.title); i.t = new Set(sinTildes(i.title).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !STOP.has(w))); });

// ---- Agrupar (voraz, sin cadenas): cada titular entra en el grupo cuyo titular guía comparta ≥2 rasgos (o 1 rasgo y ≥3 palabras largas) ----
const inter = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const grupos = [];
for (const it of items.slice().sort((a, b) => a.date - b.date)) {
  let mejor = null, mp = 0;
  for (const g of grupos) {
    const f = inter(it.f, g[0].f), t = inter(it.t, g[0].t);
    if (((f >= 2 && (t >= 1 || f >= 3)) || (f >= 1 && t >= 3)) && f * 2 + t > mp) { mejor = g; mp = f * 2 + t; }
  }
  if (mejor) mejor.push(it); else grupos.push([it]);
}

// ---- Puntuación ----
const contiene = (txt, lista) => lista.filter((n) => sinTildes(txt).includes(sinTildes(n)));
const etiquetas = (txt) => Object.entries(temas.palabras).filter(([, ws]) => contiene(txt, ws).length).map(([k]) => k);
const alertas = grupos.map((g) => {
  const medios = [...new Set(g.map((x) => x.fuente))];
  const txt = g.map((x) => x.title).join(' | ');
  const grandes = contiene(txt, temas.grandes), estrellas = contiene(txt, temas.estrellas), sel = contiene(txt, temas.selecciones);
  const edadMin = Math.max(0, (Date.now() - Math.max(...g.map((x) => x.date.getTime()))) / 60000);
  const tags = etiquetas(`${g[0].title} ${g[0].resumen}`);
  const puntos = medios.length * 4 + Math.min(grandes.length, 3) * 1.5 + Math.min(estrellas.length, 2) * 2 + (sel.length ? 1 : 0) + tags.length * 1 + Math.max(0, 3 - edadMin / 60);
  const directo = (x) => (fuentes.rss.some((f) => f.medio === x.fuente) ? 1 : 0);
  const rep0 = g[0];
  const rep = g.slice().sort((a, b) => directo(b) - directo(a) || (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.title.length - b.title.length)[0];
  return {puntos, medios, n: g.length, tags, edadMin: Math.round(edadMin), titular: rep.title, link: directo(rep) ? rep.link : '', gnews: !directo(rep), img: g.find((x) => x.img)?.img ?? '', titulares: [...new Set(g.map((x) => `${x.title} (${x.fuente})`))].slice(0, 8), enlaces: g.slice(0, 5).map((x) => `${x.fuente}: ${x.link}`), clave: [...rep.f].slice(0, 4).join('-')};
}).filter((a) => a.medios.length >= MIN_MEDIOS).sort((a, b) => b.puntos - a.puntos);

// ---- Estado: no repetir avisos ----
const estadoFile = join(DIR, process.env.RADAR_ESTADO ?? 'estado.json');
const estado = arg('--sin-estado', false) || !existsSync(estadoFile) ? {avisadas: {}} : JSON.parse(readFileSync(estadoFile, 'utf8'));
const nuevas = alertas.filter((a) => !estado.avisadas[a.clave]).slice(0, TOP);

const emoji = {fichaje: '✍️', lesion: '🩹', sancion: '🟥', entrenador: '👔', polemica: '🔥'};
const msg = (a) => {
  const conf = a.medios.length >= 3 ? `✅ ${a.medios.length} medios` : `⚠️ ${a.medios.length} medios (verifica)`;
  return `${a.tags.map((t) => emoji[t]).join('') || '📰'} ${a.titular}\n${conf} · hace ${a.edadMin} min · ${a.medios.slice(0, 4).join(', ')}\n${a.link}\n→ node tarjeta.mjs "${a.link}" "PALABRA"`;
};
const texto = nuevas.length ? nuevas.map(msg).join('\n\n') : 'Sin noticias nuevas en tendencia.';
console.log(`Radar · ${items.length} noticias de las últimas ${HORAS} h · ${grupos.length} temas · ${alertas.length} con ≥${MIN_MEDIOS} medios · ${nuevas.length} nuevas\n`);
console.log(texto);
writeFileSync(join(DIR, 'alertas.md'), `# Alertas (${new Date().toLocaleString('es-CO')})\n\n${texto}\n`);

if (nuevas.length && !arg('--no-telegram', false) && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
  for (const a of nuevas) {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chat_id: process.env.TELEGRAM_CHAT_ID, text: msg(a), disable_web_page_preview: false})}).catch(() => {});
  }
  console.log('\n(Avisos enviados a Telegram)');
}
if (!arg('--sin-estado', false)) { nuevas.forEach((a) => { estado.avisadas[a.clave] = Date.now(); }); for (const k of Object.keys(estado.avisadas)) if (Date.now() - estado.avisadas[k] > 48 * 3600e3) delete estado.avisadas[k]; writeFileSync(estadoFile, JSON.stringify(estado, null, 1)); }
