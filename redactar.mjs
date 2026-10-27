// Reescribe una noticia con una IA gratuita (Gemini, Google AI Studio) con las reglas de Medialuna. No publica nada.
// Uso: node redactar.mjs <url de la noticia>        (imprime el texto y las comprobaciones)
// Clave: GEMINI_API_KEY en `.env` de la raíz (nunca en el código ni en Git). Modelo: GEMINI_MODEL (opcional); por defecto, el «flash» más reciente disponible.
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {leerArticulo} from './articulo.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
for (const envFile of [join(DIR, '.env'), join(DIR, '..', '.env')]) if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const API = 'https://generativelanguage.googleapis.com/v1beta';

const REGLAS = `Eres el editor de redes de Medialuna, una página de fútbol en español neutro (Latinoamérica). Reescribes una noticia para Facebook con TUS PALABRAS, sin copiar frases del medio.
REGLAS ESTRICTAS:
1. Usa SOLO los datos que aparecen en el texto de la noticia. No inventes cifras, fechas, nombres, citas ni contexto. Si un dato no está, no lo pongas.
2. Si la noticia es un rumor, una negociación sin cerrar o depende de una sola fuente, di claramente «según [medio]», «podría» o «se habla de» y marca es_rumor=true.
3. No exageres ni afirmes lo que el texto no afirma. No añadas valoraciones, adjetivos ni interpretaciones que no estén en el texto («reñida», «sorprendente», «histórico»…). Nada de insultos, burlas a personas ni acusaciones sin fuente. Atribuye cada declaración a quien la dijo.
3b. El gancho debe decir QUÉ pasó, con nombres propios y datos concretos. Prohibido el clickbait vago («por este motivo», «no vas a creer», «lo que pasó»). Las viñetas llevan hechos concretos (nombres, cifras, fechas, equipos) del texto, no generalidades. Revisa la ortografía de cada palabra antes de responder.
4. Estilo: gancho en MAYÚSCULAS con signos de exclamación (máx. 80 caracteres), seguido de 2 o 3 viñetas cortas (cada una una sola frase de máx. 150 caracteres) y una pregunta final que invite a comentar.
5. «palabra» es UNA sola palabra en mayúsculas (máx. 12 letras) que resuma el titular para la imagen (ej.: TIEMPO, HOMENAJE, CASTIGO, FIRMADO, BAJA, POLÉMICA).
6. «emojis» son un emoji por viñeta, coherente con su contenido (📄 📌 ⚠️ ✅ 🟥 🩹 ✍️ 🔥 📊 🏆).
Responde SOLO con el JSON pedido.`;

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    palabra: {type: 'STRING'}, gancho: {type: 'STRING'}, emoji_gancho: {type: 'STRING'},
    vinetas: {type: 'ARRAY', items: {type: 'STRING'}}, emojis: {type: 'ARRAY', items: {type: 'STRING'}},
    pregunta: {type: 'STRING'}, es_rumor: {type: 'BOOLEAN'}, tipo: {type: 'STRING', enum: ['fichaje', 'lesion', 'sancion', 'entrenador', 'resultado', 'polemica', 'seleccion', 'otro']},
  },
  required: ['palabra', 'gancho', 'emoji_gancho', 'vinetas', 'emojis', 'pregunta', 'es_rumor', 'tipo'],
};

// Modelos «flash» disponibles con tu clave, del más ligero y reciente al más pesado. Los gratuitos se saturan a menudo (503/429): se prueba el siguiente.
let candidatos;
const listaModelos = async (key) => {
  if (candidatos) return candidatos;
  const r = await fetch(`${API}/models?pageSize=200`, {headers: {'x-goog-api-key': key}});
  if (!r.ok) throw new Error(`Gemini: no se pudo listar los modelos (${r.status}). ¿Clave válida?`);
  const todos = (await r.json()).models.filter((m) => /flash/.test(m.name) && !/(preview|exp|image|tts|audio|omni|thinking|live)/.test(m.name) && m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name.replace('models/', ''));
  const num = (a, b) => b.localeCompare(a, undefined, {numeric: true});
  const lite = todos.filter((m) => /lite/.test(m) && !/latest/.test(m)).sort(num), flash = todos.filter((m) => !/lite/.test(m) && !/latest/.test(m)).sort(num), latest = todos.filter((m) => /latest/.test(m)).sort(num);
  candidatos = [...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []), ...flash, ...latest, ...lite]; // primero los de más calidad; si están saturados, los ligeros
  if (!candidatos.length) throw new Error('Gemini: no hay modelo «flash» disponible con tu clave.');
  return candidatos;
};

// ---- Proveedores de IA (todos con plan gratuito). Orden: IA_ORDEN en .env (por defecto «groq,gemini»); se usa el primero que responda. ----
const JSON_PEDIDO = 'Responde SOLO con un JSON con estas claves: palabra (string), gancho (string), emoji_gancho (string), vinetas (array de 2 o 3 strings), emojis (array con un emoji por viñeta), pregunta (string), es_rumor (boolean), tipo (uno de: fichaje, lesion, sancion, entrenador, resultado, polemica, seleccion, otro).';
const pedido = ({titulo, texto, desc, medio, contexto = []}) => [`MEDIO: ${medio}`, `TITULAR: ${titulo}`, `DESCRIPCIÓN: ${desc}`, `TEXTO DE LA NOTICIA:\n${texto || '(no disponible; usa solo titular y descripción)'}`, ...(contexto.length ? [`OTROS TITULARES DE OTROS MEDIOS SOBRE LO MISMO (sirven para entender el contexto y comprobar; un dato que solo aparezca aquí y no en el texto no lo uses):\n- ${contexto.join('\n- ')}`] : [])].join('\n\n');

const conTiempo = (url, init, ms = 45000) => fetch(url, {...init, signal: AbortSignal.timeout(ms)}).catch((e) => ({ok: false, status: 599, text: async () => String(e), json: async () => ({})}));

const groq = async (p) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) return {saltar: 'sin GROQ_API_KEY'};
  const errores = [];
  for (const modelo of (process.env.GROQ_MODELOS ?? 'openai/gpt-oss-120b,llama-3.3-70b-versatile').split(',')) {
    const r = await conTiempo('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'},
      body: JSON.stringify({model: modelo, temperature: 0.4, response_format: {type: 'json_object'}, messages: [{role: 'system', content: `${REGLAS}\n${JSON_PEDIDO}`}, {role: 'user', content: pedido(p)}]})});
    if (!r.ok) { errores.push(`${modelo}: ${r.status}`); continue; }
    const t = (await r.json()).choices?.[0]?.message?.content;
    if (t) return {modelo: `groq/${modelo}`, json: t};
    errores.push(`${modelo}: sin texto`);
  }
  return {errores};
};

const gemini = async (p) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return {saltar: 'sin GEMINI_API_KEY'};
  const cuerpo = {systemInstruction: {parts: [{text: REGLAS}]}, contents: [{role: 'user', parts: [{text: pedido(p)}]}], generationConfig: {responseMimeType: 'application/json', responseSchema: ESQUEMA, temperature: 0.4}};
  const errores = [];
  for (const modelo of (await listaModelos(key)).slice(0, 5)) {
    const r = await conTiempo(`${API}/models/${modelo}:generateContent`, {method: 'POST', headers: {'x-goog-api-key': key, 'content-type': 'application/json'}, body: JSON.stringify(cuerpo)}, 60000);
    if (!r.ok) { errores.push(`${modelo}: ${r.status}`); continue; }
    const j = await r.json();
    const t = j.candidates?.[0]?.content?.parts?.find((x) => x.text && !x.thought)?.text;
    if (t) return {modelo: `gemini/${modelo}`, json: t};
    errores.push(`${modelo}: sin texto`);
  }
  return {errores};
};

export const redactar = async (p) => {
  const orden = (process.env.IA_ORDEN ?? 'groq,gemini').split(',').map((x) => x.trim());
  const fallos = [];
  for (const nombre of orden) {
    const r = await ({groq, gemini}[nombre])?.(p);
    if (!r) continue;
    if (r.saltar) { fallos.push(`${nombre}: ${r.saltar}`); continue; }
    if (r.json) { try { return {modelo: r.modelo, ...JSON.parse(r.json)}; } catch { fallos.push(`${r.modelo}: JSON no válido`); continue; } }
    fallos.push(`${nombre}: ${r.errores?.join(', ')}`);
  }
  throw new Error(`Ninguna IA respondió (${fallos.join(' | ')}): cuota agotada o servicio saturado; se reintentará más tarde.`);
};

// Segunda pasada con IA: ¿qué afirmaciones del texto NO están respaldadas por la noticia? (más barato que un error publicado)
export const verificar = async (r, fuenteTxt) => {
  const texto = [r.gancho, ...r.vinetas].join(' | ');
  const sistema = 'Eres un verificador de hechos. Recibes el TEXTO de una noticia y una PUBLICACIÓN que la resume. Lista cada afirmación de la PUBLICACIÓN (nombre, cifra, fecha, cita, causa o consecuencia) que NO esté respaldada de forma explícita por el TEXTO. No juzgues el estilo. Responde SOLO con JSON: {"no_respaldadas": ["afirmación 1", ...]} (lista vacía si todo está respaldado).';
  const usuario = `TEXTO DE LA NOTICIA:\n${fuenteTxt.slice(0, 7000)}\n\nPUBLICACIÓN:\n${texto}`;
  const key = process.env.GROQ_API_KEY;
  if (key) {
    const r1 = await conTiempo('https://api.groq.com/openai/v1/chat/completions', {method: 'POST', headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'}, body: JSON.stringify({model: (process.env.GROQ_MODELOS ?? 'openai/gpt-oss-120b').split(',')[0], temperature: 0, response_format: {type: 'json_object'}, messages: [{role: 'system', content: sistema}, {role: 'user', content: usuario}]})});
    if (r1.ok) { try { return JSON.parse((await r1.json()).choices[0].message.content).no_respaldadas ?? []; } catch { /* sigue */ } }
  }
  return null; // sin verificación (el aviso lo dirá)
};

// Distancia de edición (para detectar erratas: «miedo» → «mhiedo»).
const dist = (a, b) => { const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
// Comprobaciones sin IA: cifras que no están en la fuente, longitudes, erratas probables y palabras vagas.
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const comprobar = (r, fuenteTxt) => {
  const avisos = [];
  const fuente = sinTildes(fuenteTxt).replace(/(\d)[.,](\d{3})/g, '$1$2');
  const salida = [r.gancho, ...r.vinetas, r.pregunta].join(' ');
  const cifras = [...new Set((sinTildes(salida).replace(/(\d)[.,](\d{3})/g, '$1$2').match(/\d+/g) ?? []))];
  const falta = cifras.filter((c) => !new RegExp(`(^|\\D)${c}(\\D|$)`).test(fuente));
  if (falta.length) avisos.push(`Cifras que NO están en la noticia: ${falta.join(', ')}`);
  const vocab = new Set(sinTildes(fuenteTxt).split(/[^a-zñ0-9]+/).filter((w) => w.length >= 4));
  const raras = [...new Set(sinTildes(salida).split(/[^a-zñ0-9]+/).filter((w) => w.length >= 5 && !vocab.has(w)))].filter((w) => [...vocab].some((v) => v.length >= 4 && Math.abs(v.length - w.length) <= 1 && dist(v, w) === 1) && ![...vocab].some((v) => v.startsWith(w) || w.startsWith(v) || v === w + 's' || v + 's' === w || v === w + 'es' || v + 'es' === w));
  if (raras.length) avisos.push(`Posibles erratas: ${raras.join(', ')}`);
  if (/por este motivo|no vas a creer|lo que pas[oó]|nadie esperaba/i.test(salida)) avisos.push('Gancho vago (clickbait)');
  if (r.gancho.length > 90) avisos.push(`Gancho largo (${r.gancho.length})`);
  if (r.vinetas.length < 2 || r.vinetas.length > 3) avisos.push(`Viñetas: ${r.vinetas.length} (deben ser 2 o 3)`);
  r.vinetas.forEach((v) => v.length > 170 && avisos.push(`Viñeta larga (${v.length})`));
  if (!/^[A-ZÁÉÍÓÚÑÜ]{2,14}$/.test(r.palabra.toUpperCase())) avisos.push(`La palabra no es una sola palabra en mayúsculas: «${r.palabra}»`);
  return avisos;
};

export const armarTexto = (r, medio) => {
  const bullets = r.vinetas.map((v, i) => `${r.emojis[i] ?? '📌'} ${v}`);
  return `${r.emoji_gancho} ${r.gancho.toUpperCase()}\n\n${bullets.join('\n\n')}\n\nFuente: ${medio}\n\n${r.pregunta}`;
};

if (process.argv[1]?.endsWith('redactar.mjs')) {
  const url = process.argv[2];
  if (!url) { console.error('Uso: node redactar.mjs <url de la noticia>'); process.exit(1); }
  const a = await leerArticulo(url);
  console.log(`Noticia: ${a.titulo}\nMedio: ${a.medio} · texto leído: ${a.texto.length} caracteres\n`);
  const r = await redactar(a);
  const avisos = comprobar(r, `${a.titulo} ${a.desc} ${a.texto}`);
  const noResp = await verificar(r, `${a.titulo}. ${a.desc}. ${a.texto}`);
  if (noResp === null) avisos.push('Sin verificación de hechos (IA no disponible)'); else noResp.forEach((x) => avisos.push(`Sin respaldo en la noticia: ${x}`));
  console.log(`Modelo: ${r.modelo} · tipo: ${r.tipo} · rumor: ${r.es_rumor ? 'SÍ' : 'no'} · palabra de la tarjeta: ${r.palabra}\n`);
  console.log(armarTexto(r, a.medio));
  console.log(`\n${avisos.length ? '⚠️ ' + avisos.join('\n⚠️ ') : '✔ Comprobaciones: cifras presentes en la noticia, longitudes correctas'}`);
}
