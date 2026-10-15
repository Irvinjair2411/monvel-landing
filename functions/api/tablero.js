// /api/tablero — lo que lee Monvel Central (pestaña «Visitas y prospectos»).
// LEADS, 14-oct-2026. TODO exige el encabezado X-Monvel-Token (ver comun.js):
// sin token no sale ni un conteo.
//
// GET  ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   resúmenes de sesiones y prospectos
//                                           del periodo (máx. 62 días) + consumo de la IA
// GET  ?sesion=s:AAAA-MM-DD:<sid>           una sesión con su recorrido completo
// GET  ?folio=MV-AAMMDD-XXXX                un prospecto completo + su sesión
// POST { accion: 'borrar', folio }          cancelación (derecho ARCO): borra el
//                                           prospecto y la sesión ligada

import { json, ahoraMX, kv, candadoToken, folioValido } from '../_lib/comun.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const SESION = /^s:\d{4}-\d{2}-\d{2}:[a-z0-9]{10,24}$/;

async function listarTodo(almacen, prefix, tope) {
  const out = [];
  let cursor;
  do {
    const r = await almacen.list({ prefix, cursor, limit: 1000 });
    for (const k of r.keys) out.push(k);
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor && out.length < tope);
  return out.slice(0, tope);
}

function diasEntre(desde, hasta) {
  const out = [];
  let d = Date.parse(desde + 'T12:00:00Z');
  const fin = Date.parse(hasta + 'T12:00:00Z');
  while (d <= fin && out.length < 62) { out.push(new Date(d).toISOString().slice(0, 10)); d += 86400000; }
  return out;
}

function num(v, def) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : def; }

export async function onRequestGet({ request, env }) {
  const negado = await candadoToken(request, env);
  if (negado) return negado;
  const almacen = kv(env);
  if (!almacen) return json({ error: 'No hay KV enlazado como CLICS.' }, 503);
  const url = new URL(request.url);

  const sesion = url.searchParams.get('sesion');
  if (sesion) {
    if (!SESION.test(sesion)) return json({ error: 'sesión inválida' }, 400);
    const crudo = await almacen.get(sesion);
    return crudo ? json(JSON.parse(crudo)) : json({ error: 'no existe' }, 404);
  }

  const folio = url.searchParams.get('folio');
  if (folio) {
    if (!folioValido(folio)) return json({ error: 'folio inválido' }, 400);
    const crudo = await almacen.get(`l:${folio}`);
    if (!crudo) return json({ error: 'no existe' }, 404);
    const lead = JSON.parse(crudo);
    let ses = null;
    if (lead.sid && lead.sesion_dia) {
      const s = await almacen.get(`s:${lead.sesion_dia}:${lead.sid}`);
      ses = s ? JSON.parse(s) : null;
    }
    return json({ lead, sesion: ses });
  }

  const t = ahoraMX();
  let hasta = url.searchParams.get('hasta') || t.dia;
  let desde = url.searchParams.get('desde') || hasta;
  if (!DIA.test(desde) || !DIA.test(hasta) || desde > hasta) return json({ error: 'periodo inválido' }, 400);
  const dias = diasEntre(desde, hasta);
  desde = dias[0]; hasta = dias[dias.length - 1];

  const sesiones = [];
  for (const d of dias) {
    for (const k of await listarTodo(almacen, `s:${d}:`, 5000)) sesiones.push({ llave: k.name, dia: d, ...(k.metadata || {}) });
  }
  const leads = (await listarTodo(almacen, 'l:', 5000))
    .map((k) => ({ folio: k.name.slice(2), ...(k.metadata || {}) }))
    .filter((l) => { const f = String(l.f || '').slice(0, 10); return f >= desde && f <= hasta; })
    .sort((a, b) => String(b.f).localeCompare(String(a.f)));

  const ia = {};
  const meses = [...new Set(dias.map((d) => d.slice(0, 7)).concat([t.mes]))];
  for (const m of meses) {
    const crudo = await almacen.get(`ia:${m}`);
    ia[m] = crudo ? JSON.parse(crudo) : null;
  }

  return json({
    generado: `${t.dia} ${t.hhmm}`,
    desde, hasta,
    sesiones, leads, ia,
    velia: {
      llave_configurada: !!env.VELIA_API_KEY,
      activa: env.VELIA_ACTIVA !== '0' && !!env.VELIA_API_KEY,
      modelo: env.VELIA_MODELO || 'claude-haiku-4-5',
      tope_dia: num(env.VELIA_TOPE_DIA, 150),
      tope_usd_mes: num(env.VELIA_TOPE_USD_MES, 5),
    },
    retencion_dias: 365,
  });
}

export async function onRequestPost({ request, env }) {
  const negado = await candadoToken(request, env);
  if (negado) return negado;
  const almacen = kv(env);
  if (!almacen) return json({ error: 'sin KV' }, 503);
  let d = {};
  try { d = await request.json(); } catch (e) { return json({ error: 'datos' }, 400); }
  if (d.accion !== 'borrar' || !folioValido(d.folio)) return json({ error: 'acción inválida' }, 400);
  const crudo = await almacen.get(`l:${d.folio}`);
  let sesionBorrada = false;
  if (crudo) {
    const lead = JSON.parse(crudo);
    if (lead.sid && lead.sesion_dia) { await almacen.delete(`s:${lead.sesion_dia}:${lead.sid}`); sesionBorrada = true; }
  }
  await almacen.delete(`l:${d.folio}`);
  return json({ ok: true, existia: !!crudo, sesion_borrada: sesionBorrada });
}

export function onRequest() {
  return json({ error: 'Método no permitido' }, 405, { allow: 'GET, POST' });
}
