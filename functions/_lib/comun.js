// Utilidades compartidas de las Functions de monvel.mx (LEADS, 14-oct-2026).
//
// Este archivo NO define rutas (no exporta onRequest*); sólo lo importan las
// Functions de /api y /panel. Aquí no vive ningún secreto: las llaves llegan
// por `env` (variables cifradas del proyecto de Pages), nunca en el código.

export const ZONA = 'America/Mexico_City';

// Días que se conserva cada cosa en el KV (expirationTtl). Lo mismo que dice el
// aviso de privacidad; si cambias uno, cambia el otro.
// Decisión de Irvin (14-oct): 12 meses para todo (sesiones, prospectos, consumo).
export const TTL_DIAS = 365;
export const TTL_LEAD_DIAS = TTL_DIAS;
export const TTL_VISITA_DIAS = TTL_DIAS;

export function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      ...extra,
    },
  });
}

// Fecha y hora de la Ciudad de México, sin depender de la zona del servidor.
export function ahoraMX(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  const hora = p.hour === '24' ? '00' : p.hour;
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    mes: `${p.year}-${p.month}`,
    hhmm: `${hora}:${p.minute}`,
    compacto: `${p.year.slice(2)}${p.month}${p.day}`,
    iso: d.toISOString(),
  };
}

// El KV de los leads. Si Irvin no crea uno aparte (`LEADS`), se usa el del
// contador que ya existe (`CLICS`, monvel-landing-clics) con prefijos propios.
// Todo vive en el KV que YA está enlazado al proyecto de Pages como `CLICS`
// (monvel-landing-clics, BITACORA #1017), con prefijos:
//   s:<día>:<sesión>  la sesión anónima con su recorrido (eventos adentro)
//   l:<folio>         el prospecto que dejó sus datos en el chat
//   ia:<mes>          el consumo de Velia (IA) del chat
export function kv(env) {
  return env.CLICS || null;
}

// Texto limpio: sin caracteres de control, sin espacios de sobra y con tope.
export function limpio(valor, max = 200) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function esBot(ua) {
  return /bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|pingdom|uptime/i.test(ua || '');
}

// Sólo aceptamos envíos desde la propia página. No es seguridad fuerte (un
// script puede falsificar Origin), pero corta el abuso casual desde otro sitio.
export function origenValido(request, env) {
  const origen = request.headers.get('origin');
  if (!origen) return true; // sendBeacon de algunos navegadores no lo manda
  let host = '';
  try { host = new URL(origen).hostname; } catch (e) { return false; }
  const extra = String(env.ORIGENES_EXTRA || '').split(',').map((s) => s.trim()).filter(Boolean);
  const permitidos = ['monvel.mx', 'www.monvel.mx', 'localhost', '127.0.0.1', ...extra];
  return permitidos.includes(host) || host.endsWith('.monvel.pages.dev');
}

export async function leerJSON(request, maxBytes = 8192) {
  const texto = await request.text();
  if (texto.length > maxBytes) throw new Error('demasiado grande');
  return JSON.parse(texto || '{}');
}

// Folio corto, fácil de dictar: MV-AAMMDD-XXXX (sin 0/O/1/I/L).
const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function folioNuevo(compacto) {
  const r = new Uint8Array(4);
  crypto.getRandomValues(r);
  let s = '';
  for (const b of r) s += ALFABETO[b % ALFABETO.length];
  return `MV-${compacto}-${s}`;
}
export function folioValido(f) {
  return typeof f === 'string' && /^MV-\d{6}-[2-9A-HJKMNP-Z]{4}$/.test(f);
}

// Familia de sistema y navegador, a grandes rasgos (no es huella del equipo).
export function sistemaYNavegador(ua) {
  ua = String(ua || '');
  const so = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /CrOS/i.test(ua) ? 'ChromeOS' : /Linux/i.test(ua) ? 'Linux' : 'otro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'otro';
  return { so, nav };
}

// Comparación de secretos sin atajos por longitud ni por posición.
async function resumen(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return new Uint8Array(b);
}
export async function iguales(a, b) {
  const [x, y] = await Promise.all([resumen(a), resumen(b)]);
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x[i] ^ y[i];
  return dif === 0;
}

// Candado del tablero (lo lee Monvel Central). El token NO está aquí: sólo su
// SHA-256. El token vive en D:\Monvel\MonvelLicencias\leads_token.txt (sólo
// para el usuario de Irvin) y viaja en el encabezado X-Monvel-Token. Para
// rotarlo: generar otro, poner aquí su hash y publicar. TABLERO_TOKEN_SHA256 (si
// existe como variable de Pages) gana sobre la constante; las pruebas la usan.
export const TOKEN_SHA256 = '85af0234741d3eb4477359b29a7a995b76cf23d7408802e47772a0c4b6c207d6';

async function sha256hex(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Devuelve null si el token es bueno; si no, la Response 401.
export async function candadoToken(request, env) {
  const esperado = String(env.TABLERO_TOKEN_SHA256 || TOKEN_SHA256).toLowerCase();
  const token = request.headers.get('x-monvel-token') || '';
  if (token.length >= 32 && await iguales(await sha256hex(token), esperado)) return null;
  return json({ error: 'no autorizado' }, 401);
}
