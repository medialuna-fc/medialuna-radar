// Lee una noticia: titular, descripción, medio, imagen principal y el texto (párrafos) para que la IA tenga de dónde sacar los datos.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
export const decode = (s = '') => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();
const meta = (html, ...names) => { for (const n of names) { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, 'i')) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, 'i')); if (m) return decode(m[1]); } return ''; };

export const leerArticulo = async (url) => {
  const res = await fetch(url, {headers: {'user-agent': UA, 'accept-language': 'es-419,es;q=0.9'}, redirect: 'follow', signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error(`No se pudo abrir la noticia (${res.status})`);
  const html = await res.text();
  const titulo = meta(html, 'og:title', 'twitter:title') || decode((html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
  const desc = meta(html, 'og:description', 'description', 'twitter:description');
  const medio = meta(html, 'og:site_name') || new URL(res.url).hostname.replace(/^www\./, '');
  const imagen = meta(html, 'og:image', 'twitter:image');
  // Párrafos del cuerpo: los <p> con texto de cierta longitud, sin scripts ni menús.
  const limpio = html.replace(/<(script|style|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const parrafos = [...limpio.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' '))).filter((p) => p.length > 60);
  return {titulo, desc, medio, imagen: imagen ? new URL(imagen, res.url).href : '', texto: parrafos.join('\n').slice(0, 6000), url: res.url};
};
