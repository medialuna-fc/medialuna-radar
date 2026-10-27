# medialuna-radar
Radar de noticias de fútbol de Medialuna: lee feeds RSS (`fuentes.json`), agrupa las noticias que se repiten en varios medios, las puntúa (`temas.json`) y redacta borradores con una IA gratuita (Groq / Gemini) con reglas anti-invención y comprobaciones. **No publica nada**: una persona revisa y decide.

- `node radar.mjs` — tendencias de las últimas horas.
- `node redactar.mjs <url>` — borrador de publicación con comprobaciones.
- Claves (solo en `.env` local o en *Secrets* de GitHub, nunca en el repositorio): `GROQ_API_KEY`, `GEMINI_API_KEY`.
