// POST /api/lead — registra al prospecto que terminó el chat de bienvenida
// (LEADS, 14-oct-2026).
//
// Dos acciones:
//   { accion: 'registrar', ... }  → guarda el lead y regresa su folio.
//   { accion: 'wa', folio }       → marca que el prospecto abrió WhatsApp.
//
// El lead se guarda en el KV `CLICS` como `l:<folio>` (12 meses) y sus datos
// básicos van también en los metadatos, para que el panel liste sin leer uno
// por uno. Nada de esto sale de Cloudflare salvo el aviso por correo, que está
// APAGADO hasta que Irvin lo decida (AVISO_CORREO=1 + llave de Brevo).

import { json, ahoraMX, kv, limpio, origenValido, leerJSON, folioNuevo, folioValido, TTL_LEAD_DIAS } from '../_lib/comun.js';

const CAMPOS = { nombre: 80, despacho: 100, clientes: 40, busca: 120, conocio: 80, nota: 400 };

function armarRespuestas(r) {
  const out = {};
  for (const [k, max] of Object.entries(CAMPOS)) out[k] = limpio(r && r[k], max);
  return out;
}

function armarConversacion(lista) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  let total = 0;
  for (const m of lista.slice(-40)) {
    const t = limpio(m && m.t, 600);
    if (!t) continue;
    total += t.length;
    if (total > 6000) break;
    const o = { de: m.de === 'v' ? 'v' : 'm', t };
    if (m.mo === 'ia' || m.mo === 'guiado') o.mo = m.mo; // quién contestó: Velia (IA) o el modo guiado
    out.push(o);
  }
  return out;
}

export async function onRequestPost(contexto) {
  const { request, env } = contexto;
  const almacen = kv(env);
  if (!almacen) return json({ ok: false, error: 'sin almacenamiento' }, 503);
  if (!origenValido(request, env)) return json({ ok: false }, 403);

  let d;
  try { d = await leerJSON(request, 16384); } catch (e) { return json({ ok: false, error: 'datos inválidos' }, 400); }

  if (d.accion === 'wa') return marcarWhatsApp(almacen, d.folio);
  if (d.accion !== 'registrar') return json({ ok: false, error: 'acción desconocida' }, 400);

  // Sin el «sí» al aviso de privacidad no se guarda nada.
  if (d.consentimiento !== true) return json({ ok: false, error: 'falta el consentimiento' }, 400);

  const respuestas = armarRespuestas(d.respuestas);
  if (!respuestas.nombre) return json({ ok: false, error: 'falta el nombre' }, 400);

  const t = ahoraMX();
  let folio = folioValido(d.folio) ? d.folio : folioNuevo(t.compacto);
  // Si el folio que propuso la página ya existe (o es de otro día), se emite otro.
  if (!folio.includes(`-${t.compacto}-`) || await almacen.get(`l:${folio}`)) folio = folioNuevo(t.compacto);

  const origen = d.origen && typeof d.origen === 'object' ? d.origen : {};
  const utm = origen.utm && typeof origen.utm === 'object' ? origen.utm : {};
  const lead = {
    folio,
    fecha: t.iso,
    fecha_mx: `${t.dia} ${t.hhmm}`,
    respuestas,
    origen: {
      referente: limpio(origen.ref, 60).toLowerCase(),
      utm: {
        source: limpio(utm.source, 40), medium: limpio(utm.medium, 30), campaign: limpio(utm.campaign, 50),
        term: limpio(utm.term, 50), content: limpio(utm.content, 50),
      },
      boton: limpio(origen.boton, 24),
      pais: limpio((request.cf && request.cf.country) || '', 2),
      ciudad: limpio((request.cf && request.cf.city) || '', 40),
    },
    secciones: (Array.isArray(d.secciones) ? d.secciones : []).map((x) => limpio(x, 24)).filter(Boolean).slice(0, 25),
    segundos: Math.max(0, Math.min(86400, Math.round(Number(d.segundos) || 0))),
    movil: !!d.movil,
    ia: !!d.ia,                       // true si Velia (IA) contestó al menos una vez; false = modo guiado
    sid: /^[a-z0-9]{10,24}$/.test(String(d.sid || '')) ? String(d.sid) : '',
    sesion_dia: /^\d{4}-\d{2}-\d{2}$/.test(String(d.dia || '')) ? String(d.dia) : '',
    conversacion: armarConversacion(d.conversacion),
    whatsapp_abierto: null,
    expira: Date.now() + TTL_LEAD_DIAS * 86400 * 1000,
    aviso_privacidad: limpio(d.aviso_version, 20) || '2026-10-14',
  };

  try {
    await almacen.put(`l:${folio}`, JSON.stringify(lead), {
      expiration: Math.floor(lead.expira / 1000),
      metadata: resumenLead(lead),
    });
  } catch (e) {
    console.error('lead: no se pudo guardar', String(e && e.message || e));
    return json({ ok: false, folio, error: 'no se pudo guardar' }, 502);
  }

  // Aviso a ventas@ — sólo si Irvin lo enciende. Va después de guardar y en
  // segundo plano: si el correo falla, el prospecto no se entera ni se pierde.
  if (env.AVISO_CORREO === '1' && env.BREVO_API_KEY) {
    const tarea = avisarPorCorreo(env, lead).catch((e) => console.error('lead: aviso por correo falló', String(e && e.message || e)));
    if (contexto.waitUntil) contexto.waitUntil(tarea);
  }

  return json({ ok: true, folio });
}

export function resumenLead(lead) {
  return {
    f: lead.fecha_mx,
    n: lead.respuestas.nombre.slice(0, 60),
    d: lead.respuestas.despacho.slice(0, 60),
    k: lead.respuestas.clientes.slice(0, 30),
    b: lead.respuestas.busca.slice(0, 60),
    c: lead.respuestas.conocio.slice(0, 40),
    r: lead.origen.referente.slice(0, 40),
    us: lead.origen.utm.source.slice(0, 30),
    s: lead.segundos,
    wa: lead.whatsapp_abierto ? 1 : 0,
    ia: lead.ia ? 1 : 0,
    sid: lead.sid,
    sd: lead.sesion_dia,
  };
}

async function marcarWhatsApp(almacen, folio) {
  if (!folioValido(folio)) return json({ ok: false }, 400);
  const crudo = await almacen.get(`l:${folio}`);
  if (!crudo) return json({ ok: false }, 404);
  const lead = JSON.parse(crudo);
  if (!lead.whatsapp_abierto) {
    lead.whatsapp_abierto = ahoraMX().iso;
    await almacen.put(`l:${folio}`, JSON.stringify(lead), {
      expiration: Math.floor(lead.expira / 1000),
      metadata: resumenLead(lead),
    });
  }
  return json({ ok: true });
}

// Correo de aviso por la API de Brevo (la misma ruta transaccional de Monvel,
// #387). El remitente y el destino salen de variables; nada fijo en el código.
async function avisarPorCorreo(env, lead) {
  const r = lead.respuestas;
  const filas = [
    ['Folio', lead.folio], ['Fecha', lead.fecha_mx], ['Nombre', r.nombre], ['Despacho', r.despacho],
    ['Clientes / RFC', r.clientes], ['Busca', r.busca], ['Nos conoció por', r.conocio], ['Nota', r.nota],
    ['Llegó de', [lead.origen.referente || 'directo', lead.origen.utm.source, lead.origen.utm.campaign].filter(Boolean).join(' · ')],
    ['Tiempo en la página', `${Math.round(lead.segundos / 60)} min`],
  ];
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<p>Nuevo prospecto desde monvel.mx</p><table>${filas.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table><p>Detalle completo en monvel.mx/panel</p>`;
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: env.AVISO_REMITENTE || 'no-reply@monvel.mx', name: 'Monvel · prospectos' },
      to: [{ email: env.AVISO_DESTINO || 'ventas@monvel.mx' }],
      subject: `Prospecto ${lead.folio}: ${r.nombre}${r.despacho ? ' · ' + r.despacho : ''}`,
      htmlContent: html,
    }),
  });
  if (!resp.ok) throw new Error(`Brevo respondió ${resp.status}`);
}

export function onRequest() {
  return json({ error: 'Método no permitido' }, 405, { allow: 'POST' });
}
