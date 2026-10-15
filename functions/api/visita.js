// POST /api/visita — el recorrido anónimo de una sesión (LEADS, 14-oct-2026).
//
// La página manda el estado COMPLETO de la sesión cada vez que se oculta o se
// cierra (y al terminar el chat). Aquí se valida, se limpia y se guarda en una
// sola llave por sesión, `s:<día>:<sid>` del KV `CLICS`: cada aviso reemplaza al
// anterior, así que una sesión cuesta una escritura por aviso, sin carreras.
//
// Lo que NO se guarda: la IP (sólo país y ciudad aproximados que da la red de
// Cloudflare), cookies, ni nada que identifique al equipo. El `sid` es un número
// al azar que vive en el sessionStorage de esa pestaña. La sesión es anónima
// hasta que la persona deja sus datos en el chat: entonces trae su folio.

import { json, ahoraMX, kv, limpio, esBot, origenValido, leerJSON, sistemaYNavegador, folioValido, TTL_DIAS } from '../_lib/comun.js';

const ID = /^[a-z0-9_-]{1,32}$/;
const TIPOS = new Set(['llego', 'seccion', 'bajo', 'clic', 'chat_abre', 'chat_resp', 'chat_cierra', 'lead', 'oculta', 'vuelve']);
const MAX_EVENTOS = 200;

function ent(v, min, max) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }

export function limpiarEvento(e) {
  if (!e || typeof e !== 'object' || !TIPOS.has(e.k)) return null;
  const o = { k: e.k, t: ent(e.t, 0, 86400000) };
  if (e.id !== undefined) { const id = limpio(e.id, 32).toLowerCase(); if (ID.test(id)) o.id = id; }
  if (e.seg !== undefined) o.seg = ent(e.seg, 0, 86400);
  if (e.pct !== undefined) o.pct = ent(e.pct, 0, 100);
  if (e.sec !== undefined) { const s = limpio(e.sec, 32).toLowerCase(); if (ID.test(s)) o.sec = s; }
  if (e.txt !== undefined) o.txt = limpio(e.txt, 80);
  if (e.wa !== undefined) o.wa = limpio(e.wa, 160);
  if (e.paso !== undefined) o.paso = limpio(e.paso, 16);
  if (e.val !== undefined) o.val = limpio(e.val, 160);
  if (e.modo !== undefined) o.modo = ['ia', 'guiado', 'opcion'].includes(e.modo) ? e.modo : 'guiado';
  if (e.folio !== undefined && folioValido(e.folio)) o.folio = e.folio;
  return o;
}

export async function onRequestPost({ request, env }) {
  const almacen = kv(env);
  if (!almacen || env.VISITAS === '0') return new Response(null, { status: 204 });
  if (!origenValido(request, env)) return new Response(null, { status: 403 });
  const ua = request.headers.get('user-agent') || '';
  if (esBot(ua)) return new Response(null, { status: 204 });

  let d;
  try { d = await leerJSON(request, 49152); } catch (e) { return new Response(null, { status: 400 }); }

  const sid = limpio(d.sid, 24).toLowerCase();
  if (!/^[a-z0-9]{10,24}$/.test(sid)) return new Response(null, { status: 400 });
  const segundos = ent(d.s, 0, 86400);
  const eventos = (Array.isArray(d.ev) ? d.ev : []).slice(0, MAX_EVENTOS).map(limpiarEvento).filter(Boolean);
  // Rebote de 0-2 s sin ningún clic: no gasta escritura.
  if (segundos < 3 && !eventos.some((e) => e.k === 'clic' || e.k === 'chat_abre')) return new Response(null, { status: 204 });

  // La hora de inicio se corrige con el reloj del servidor (el del equipo puede
  // estar mal): inicio = ahora_servidor − (ahora_equipo − inicio_equipo).
  const ahora = Date.now();
  const transcurrido = ent(Number(d.ahora) - Number(d.t0), 0, 86400000);
  const inicio = ahora - transcurrido;
  const dia = limpio(d.dia, 10);
  const t = ahoraMX(new Date(inicio));
  // La sesión se guarda bajo el día en que EMPEZÓ (el que la página recuerda), para
  // que sus avisos posteriores pisen la misma llave aunque crucen la medianoche.
  const diaLlave = /^\d{4}-\d{2}-\d{2}$/.test(dia) && Math.abs(Date.parse(dia) - Date.parse(t.dia)) <= 86400000 ? dia : t.dia;

  const utm = d.utm && typeof d.utm === 'object' ? d.utm : {};
  const secs = {};
  if (d.secs && typeof d.secs === 'object') {
    for (const [k, v] of Object.entries(d.secs).slice(0, 40)) { const id = limpio(k, 32).toLowerCase(); if (ID.test(id)) secs[id] = ent(v, 0, 86400); }
  }
  const { so, nav } = sistemaYNavegador(ua);
  const cf = request.cf || {};
  const folio = folioValido(d.folio) ? d.folio : '';
  const sesion = {
    sid, dia: diaLlave, inicio: new Date(inicio).toISOString(), ultimo: new Date(ahora).toISOString(),
    pagina: limpio(d.pagina, 80) || '/',
    ref: limpio(d.r, 60).toLowerCase(),
    utm: { source: limpio(utm.source, 40), medium: limpio(utm.medium, 30), campaign: limpio(utm.campaign, 50), term: limpio(utm.term, 50), content: limpio(utm.content, 50) },
    pais: limpio(cf.country, 2), region: limpio(cf.region, 40), ciudad: limpio(cf.city, 40),
    equipo: ['movil', 'tableta', 'escritorio'].includes(d.eq) ? d.eq : 'escritorio', so, nav,
    segundos, scroll: ent(d.bajo, 0, 100), secciones: secs,
    clics: eventos.filter((e) => e.k === 'clic').length,
    chat: !!eventos.find((e) => e.k === 'chat_abre'),
    folio,
    eventos,
  };
  const enWa = eventos.filter((e) => e.k === 'clic' && /^wa|^plan-|^demo|^fab|^pie/.test(e.id || '')).length;
  const meta = {
    h: ahoraMX(new Date(inicio)).hhmm, r: sesion.ref.slice(0, 40), us: sesion.utm.source.slice(0, 30), uc: sesion.utm.campaign.slice(0, 30),
    p: sesion.pais, ci: sesion.ciudad.slice(0, 24), eq: sesion.equipo.slice(0, 1), s: segundos, b: sesion.scroll,
    c: sesion.clics, w: enWa, ch: sesion.chat ? 1 : 0, f: folio,
    top: Object.entries(secs).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]),
  };

  try {
    await almacen.put(`s:${diaLlave}:${sid}`, JSON.stringify(sesion), { metadata: meta, expirationTtl: TTL_DIAS * 86400 });
  } catch (e) {
    console.error('visita: no se pudo guardar', String(e && e.message || e));
    return json({ ok: false }, 202);
  }
  return new Response(null, { status: 204 });
}

export function onRequest() {
  return json({ error: 'Método no permitido' }, 405, { allow: 'POST' });
}
