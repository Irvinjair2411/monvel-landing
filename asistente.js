/* Monvel · recorrido de la visita y chat de bienvenida (LEADS, 14-oct-2026; LEADS44, 21-oct-2026).
 *
 * 1. RECORRIDO ANÓNIMO DE LA SESIÓN (para Monvel Central):
 *    de dónde llegó (dominio del referente y UTM), tipo de equipo, qué secciones
 *    vio y cuánto tiempo en cada una, hasta dónde bajó, qué botones tocó (y en
 *    WhatsApp, desde qué sección y con qué texto), si abrió el chat y qué
 *    respondió. Todo con la hora de cada paso.
 *    - Sin cookies ni huella del equipo. El id de sesión es un número al azar en
 *      el sessionStorage de esta pestaña: muere al cerrarla.
 *    - La IP no se guarda (el servidor sólo anota país y ciudad aproximados).
 *    - Se manda a /api/visita al ocultar o cerrar la página (una escritura).
 *    - Si el navegador pide «no rastrear» (GPC o DNT), no se manda nada.
 * 2. CHAT DE BIENVENIDA (Velia): los botones de WhatsApp abren primero el chat,
 *    que pregunta el nombre y qué busca de Monvel (obligatorias) y, si la persona
 *    quiere, cuántos clientes o RFC lleva (se puede omitir). Al final se guarda el
 *    prospecto (/api/lead), la sesión queda ligada a su folio y WhatsApp se abre
 *    con las respuestas y el folio ya escritos.
 *    - Modo guiado (preguntas fijas) siempre disponible.
 *    - Modo IA: si /api/velia responde (hay llave en el servidor), Velia entiende
 *      respuestas libres y contesta dudas. A la primera falla o al acabarse el
 *      cupo, el chat sigue en modo guiado. Nunca se pierde al prospecto.
 *    - Sin JavaScript, los enlaces siguen yendo directo a WhatsApp (href intacto).
 * 3. CÓDIGO DE REFERENCIA (LEADS44): quien va a WhatsApp SIN pasar por el chat (el
 *    enlace discreto «Prefiero ir directo a WhatsApp», Ctrl/clic medio, mantener
 *    pulsado el enlace) manda un texto que termina en «(ref. K7P3)»: 4 caracteres sin
 *    0/O/1/I/L que salen del id al azar de la sesión, sin datos personales. El mismo
 *    código viaja en el recorrido (/api/visita) y Monvel Central lo busca en
 *    /api/tablero?ref=. Con «no rastrear» (GPC/DNT) no se agrega, porque no se registra.
 */
(function () {
  'use strict';

  var WA_NUMERO = '522201207439';
  var AVISO_VERSION = '2026-10-21'; // el aviso cambió el 21-oct (preguntas del chat y código de referencia)
  var hayIA = true; // se apaga sola a la primera falla de /api/velia

  function guardarLocal(almacen, k, v) { try { window[almacen].setItem(k, v); return true; } catch (e) { return false; } }
  function leerLocal(almacen, k) { try { return window[almacen].getItem(k); } catch (e) { return null; } }

  function diaMX(d) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d || new Date()).forEach(function (x) { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day;
    } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function azar(n) {
    var abc = 'abcdefghijkmnpqrstuvwxyz23456789', s = '', r = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < n; i++) s += abc[r[i] % abc.length];
    return s;
  }
  // LEADS44: código corto de referencia de la visita. DEBE dar lo mismo que refDeSid
  // de functions/_lib/comun.js (una prueba lo compara): el servidor lo recalcula.
  var ABC_REF = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function refDeSid(sid) {
    var h = 2166136261, i;
    sid = String(sid || '');
    for (i = 0; i < sid.length; i++) { h ^= sid.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
    h ^= h >>> 16; h >>>= 0;
    var r = '';
    for (i = 0; i < 4; i++) { r += ABC_REF[h % ABC_REF.length]; h = Math.floor(h / ABC_REF.length); }
    return r;
  }

  /* ================================================== recorrido de la sesión */
  var noRastrear = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  var ses = null;
  try { ses = JSON.parse(leerLocal('sessionStorage', 'mv_ses') || 'null'); } catch (e) { ses = null; }
  if (!ses || typeof ses !== 'object' || !ses.sid || !Array.isArray(ses.ev)) {
    ses = { sid: azar(16), t0: Date.now(), dia: diaMX(), r: '', utm: {}, ev: [], secs: {}, bajo: 0, s: 0, folio: '', envios: 0 };
    try {
      var ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.hostname !== location.hostname) ses.r = ref.hostname.replace(/^www\./, '');
    } catch (e) { ses.r = ''; }
    var q = new URLSearchParams(location.search);
    ['source', 'medium', 'campaign', 'term', 'content'].forEach(function (k) { var v = q.get('utm_' + k); if (v) ses.utm[k] = v.slice(0, 50); });
    if (!ses.utm.source && q.get('gclid')) ses.utm.source = 'google-ads';
    if (!ses.utm.source && q.get('fbclid')) ses.utm.source = 'facebook';
    ses.ev.push({ k: 'llego', t: 0 });
  }
  var ancho = window.innerWidth || 1024;
  var tactil = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  var equipo = ancho < 768 ? 'movil' : (tactil && ancho < 1200 ? 'tableta' : 'escritorio');

  // Código de la visita; vacío si el navegador pidió «no rastrear» (no se registraría).
  function refVisita() { return noRastrear ? '' : refDeSid(ses.sid); }
  var TEXTO_BASE = 'Hola, me interesa saber más de Monvel';
  var RX_REF = /\(ref\. ([2-9A-HJKMNP-Z]{4})\)\s*$/;
  // Agrega « (ref. K7P3)» al texto prellenado de un enlace de wa.me (si ya lo trae, no repite).
  function conRef(href) {
    var rc = refVisita();
    if (!rc) return href;
    try {
      var u = new URL(href, location.href);
      if (u.hostname !== 'wa.me') return href;
      var t = u.searchParams.get('text') || TEXTO_BASE;
      if (RX_REF.test(t)) return href;
      return u.origin + u.pathname + '?text=' + encodeURIComponent(t + ' (ref. ' + rc + ')');
    } catch (e) { return href; }
  }
  function textoDe(href) { try { return new URL(href).searchParams.get('text') || ''; } catch (e) { return ''; } }
  // Los enlaces de WhatsApp de la página llevan el código desde que carga: así también lo
  // llevan si la persona los abre con Ctrl/clic medio o manteniéndolos pulsados (en el
  // celular), caminos que no pasan por el chat. Sin JavaScript el href queda como estaba.
  function marcarEnlacesWa() {
    Array.prototype.forEach.call(document.querySelectorAll('a[href*="wa.me/' + WA_NUMERO + '"]'), function (a) {
      var h = a.getAttribute('href'), n = conRef(h);
      if (n !== h) a.setAttribute('href', n);
    });
  }

  function persistir() { guardarLocal('sessionStorage', 'mv_ses', JSON.stringify(ses)); }
  function evento(k, extra) {
    if (ses.ev.length >= 200) return;
    var e = { k: k, t: Date.now() - ses.t0 };
    if (extra) for (var x in extra) if (Object.prototype.hasOwnProperty.call(extra, x) && extra[x] !== undefined && extra[x] !== '') e[x] = extra[x];
    ses.ev.push(e);
    persistir();
  }

  // Tiempo por sección: cada segundo con la página a la vista se le suma a la
  // sección que más ocupa la pantalla. Al cambiar de sección se anota el tramo.
  var visibles = {};
  var tramo = { id: '', t: 0, seg: 0 };
  function seccionActual() {
    var mejor = '', max = 0.2;
    for (var id in visibles) if (visibles[id] > max) { max = visibles[id]; mejor = id; }
    return mejor;
  }
  function cerrarTramo() {
    if (tramo.id && tramo.seg >= 2) evento('seccion', { id: tramo.id, seg: tramo.seg, t: tramo.t });
    tramo = { id: '', t: 0, seg: 0 };
  }
  if ('IntersectionObserver' in window) {
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) { visibles[e.target.id] = e.isIntersecting ? e.intersectionRect.height / (window.innerHeight || 1) : 0; });
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    document.querySelectorAll('section[id]').forEach(function (s) { obs.observe(s); });
  }
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    ses.s += 1;
    var actual = seccionActual();
    if (actual !== tramo.id) { cerrarTramo(); tramo = { id: actual, t: Date.now() - ses.t0, seg: 0 }; }
    if (actual) { tramo.seg += 1; ses.secs[actual] = (ses.secs[actual] || 0) + 1; }
    if (ses.s % 15 === 0) persistir();
  }, 1000);

  var marcas = [25, 50, 75, 100];
  function medirBajada() {
    var alto = document.documentElement.scrollHeight || 1;
    var pct = Math.min(100, Math.round(((window.scrollY || 0) + window.innerHeight) / alto * 100));
    if (pct > ses.bajo) {
      marcas.forEach(function (m) { if (pct >= m && ses.bajo < m) evento('bajo', { pct: m }); });
      ses.bajo = pct;
    }
  }
  var esperaBajada = null;
  window.addEventListener('scroll', function () { if (!esperaBajada) esperaBajada = setTimeout(function () { esperaBajada = null; medirBajada(); }, 400); }, { passive: true });

  function seccionDe(nodo) {
    var s = nodo && nodo.closest ? nodo.closest('section[id], footer, header') : null;
    if (!s) return nodo && nodo.classList && nodo.classList.contains('wa') ? 'flotante' : '';
    return s.id || s.tagName.toLowerCase();
  }
  function nombreDe(a) {
    if (a.dataset.clic) return a.dataset.clic;
    var h = a.getAttribute('href') || '';
    if (h.indexOf('wa.me') >= 0) return 'wa';
    if (h.indexOf('aula.monvel.mx') >= 0) return 'aula';
    if (h.indexOf('mailto:') === 0) return 'correo';
    if (h === '#demo') return 'ir-demo';
    if (h === '#planes') return 'ir-planes';
    if (h === '#privacidad' || h === '#privacidad-chat') return 'aviso';
    if (h.indexOf('privacy-policy') >= 0) return 'aviso-extension';
    if (h.charAt(0) === '#') return 'ir-' + h.slice(1, 20);
    if (a.getAttribute('role') === 'tab') return 'pestana';
    if (a.id === 'menuButton') return 'menu';
    return '';
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a, button') : null;
    if (!a || a.closest('.mvc')) return; // los clics dentro del chat se anotan como respuestas
    var id = nombreDe(a);
    if (!id) return;
    var extra = { id: id, txt: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), sec: seccionDe(a) };
    var h = a.getAttribute('href') || '';
    if (h.indexOf('wa.me') >= 0) {
      try { extra.wa = (new URL(h).searchParams.get('text') || '(sin texto)').slice(0, 160); } catch (er) { extra.wa = ''; }
      var mref = RX_REF.exec(extra.wa || '');
      if (mref) extra.rc = mref[1];
    }
    evento('clic', extra);
  }, true);

  function enviarSesion(urgente) {
    if (noRastrear || ses.envios >= 40) return;
    ses.envios += 1;
    persistir();
    var datos = JSON.stringify({
      sid: ses.sid, t0: ses.t0, ahora: Date.now(), dia: ses.dia, pagina: location.pathname,
      r: ses.r, utm: ses.utm, eq: equipo, s: ses.s, bajo: ses.bajo, secs: ses.secs, ev: ses.ev, folio: ses.folio, rc: refVisita()
    });
    try {
      if (!urgente && navigator.sendBeacon) navigator.sendBeacon('/api/visita', new Blob([datos], { type: 'application/json' }));
      else fetch('/api/visita', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: datos }).catch(function () { /* medir nunca rompe la página */ });
    } catch (e) { /* medir nunca rompe la página */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      cerrarTramo();
      var u = ses.ev[ses.ev.length - 1];
      if (!u || u.k !== 'oculta') evento('oculta');
      enviarSesion(false);
    } else {
      evento('vuelve');
    }
  });
  window.addEventListener('pagehide', function () { cerrarTramo(); enviarSesion(false); });

  // Aviso discreto de la medición (una vez por navegador).
  function avisoDiscreto() {
    if (leerLocal('localStorage', 'mv_aviso_ok') === '1') return;
    var d = document.createElement('div');
    d.className = 'mv-aviso';
    d.setAttribute('role', 'note');
    d.appendChild(document.createTextNode('Usamos analítica propia y anónima, sin cookies, para mejorar la página. '));
    var a = document.createElement('a'); a.href = '#privacidad'; a.textContent = 'Aviso de privacidad'; d.appendChild(a);
    var b = document.createElement('button'); b.type = 'button'; b.textContent = 'Entendido'; b.setAttribute('aria-label', 'Cerrar el aviso de analítica');
    b.addEventListener('click', function () { guardarLocal('localStorage', 'mv_aviso_ok', '1'); d.parentNode.removeChild(d); });
    d.appendChild(b);
    document.body.appendChild(d);
  }
  avisoDiscreto();
  marcarEnlacesWa();

  /* ================================================== el chat */
  // LEADS44: dos preguntas obligatorias (nombre y qué busca) y una opcional (cuántos RFC).
  var PASOS = ['nombre', 'busca', 'clientes'];
  var OPCIONALES = { clientes: true };
  var OMITIR = 'Prefiero no decirlo';
  var PREGUNTAS = {
    nombre: function () { return '¿Cómo te llamas?'; },
    busca: function (c) { return 'Mucho gusto, ' + primerNombre(c.nombre) + '. ¿Qué te gustaría de Monvel?'; },
    clientes: function () { return '¿Cuántos clientes o RFC llevas hoy? Es opcional.'; }
  };
  var OPCIONES = {
    nombre: [],
    busca: ['Resolver dudas', 'Probarlo en el Aula Virtual', 'Conocer precios y planes', 'Ser despacho fundador', 'Migrar de CONTPAQi', 'Migrar de otro sistema', 'Otra cosa'],
    clientes: ['1 a 10', '11 a 30', '31 a 100', 'Más de 100', OMITIR]
  };
  var MARCADOR = {
    nombre: 'Tu nombre', busca: 'Escribe lo que buscas', clientes: 'Por ejemplo, 25 (opcional)'
  };
  // Lo que cada botón de la página ya dice del interés del visitante.
  var CONTEXTO = {
    'plan-basico': 'El plan Básico', 'plan-profesional': 'El plan Profesional', 'plan-plus': 'El plan Despacho Plus',
    'demo': 'Resolver dudas',
    'fundador': 'Ser despacho fundador' // FUND43: así el prospecto sale marcado en Monvel Central
  };

  var estado = { iniciado: false, paso: -1, campos: {}, conv: [], boton: 'fab', hrefOriginal: '', folio: '', listo: false, ocupado: false, iaUsada: false, iaNueva: true, consentimiento: false, guardado: false };
  var ui = {};
  var lanzador = null;

  function primerNombre(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function el(tag, cls, txt) { var x = document.createElement(tag); if (cls) x.className = cls; if (txt != null) x.textContent = txt; return x; }

  function construir() {
    if (ui.raiz) return;
    var raiz = el('div', 'mvc');
    raiz.id = 'mv-chat';
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'false');
    raiz.setAttribute('aria-labelledby', 'mvc-titulo');
    raiz.hidden = true;

    var cab = el('div', 'mvc-cab');
    var logo = el('img');
    logo.src = 'logo-monvel-mark-48.png';
    logo.srcset = 'logo-monvel-mark-72.png 1.5x, logo-monvel-mark-96.png 2x';
    logo.width = 34; logo.height = 34; logo.alt = '';
    var tit = el('div', 'mvc-tit');
    var h = el('strong', null, 'Velia');
    h.id = 'mvc-titulo';
    tit.appendChild(h);
    tit.appendChild(el('small', null, 'Asistente de Monvel'));
    var cerrar = el('button', 'mvc-cerrar');
    cerrar.type = 'button';
    cerrar.setAttribute('aria-label', 'Cerrar el chat');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', cerrarChat);
    cab.appendChild(logo); cab.appendChild(tit); cab.appendChild(cerrar);

    var log = el('div', 'mvc-log');
    log.setAttribute('aria-live', 'polite');
    var chips = el('div', 'mvc-chips');
    var form = el('form', 'mvc-form');
    var input = el('input');
    input.type = 'text';
    input.maxLength = 300;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Tu respuesta');
    var enviar = el('button', 'mvc-enviar', 'Enviar');
    enviar.type = 'submit';
    form.appendChild(input); form.appendChild(enviar);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = input.value.trim();
      if (t) { input.value = ''; responder(t, false); }
      else if (OPCIONALES[PASOS[estado.paso]] && !estado.ocupado && !estado.listo) omitirPaso(); // vacío en un paso opcional = omitirlo
    });

    // La salida directa a WhatsApp no se quita: queda como enlace discreto bajo el chat, en todo momento.
    var salida = el('p', 'mvc-salida');
    var dir = el('a', 'mvc-directo', 'Prefiero ir directo a WhatsApp');
    dir.href = conRef('https://wa.me/' + WA_NUMERO);
    dir.target = '_blank';
    dir.rel = 'noopener';
    dir.addEventListener('click', function () {
      // El enlace sigue su camino (pestaña nueva); aquí sólo se anota y se manda la sesión YA,
      // porque en el celular la página pasa a segundo plano y el aviso de salida puede no salir.
      evento('clic', { id: 'wa-directo', txt: 'Prefiero ir directo a WhatsApp', sec: 'chat', paso: estado.listo ? 'fin' : (PASOS[estado.paso] || 'inicio'), wa: (textoDe(dir.href) || '(sin texto)').slice(0, 160), rc: refVisita() });
      enviarSesion(true);
    });
    salida.appendChild(dir);

    var pie = el('p', 'mvc-pie');
    pie.appendChild(document.createTextNode('Tus respuestas se guardan para atenderte. '));
    var av = el('a', null, 'Aviso de privacidad');
    av.href = '#privacidad-chat';
    av.addEventListener('click', function () { cerrarChat(); });
    pie.appendChild(av);

    raiz.appendChild(cab); raiz.appendChild(log); raiz.appendChild(chips); raiz.appendChild(form); raiz.appendChild(salida); raiz.appendChild(pie);
    document.body.appendChild(raiz);
    raiz.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrarChat(); });
    ui = { raiz: raiz, log: log, chips: chips, form: form, input: input, enviar: enviar, salida: salida, directo: dir };
  }

  // de: 'v' visitante, 'm' Monvel. mo: quién contestó ('ia' o 'guiado').
  function burbuja(de, texto, mo) {
    var b = el('p', 'mvc-b ' + (de === 'v' ? 'mvc-v' : 'mvc-m'), texto);
    ui.log.appendChild(b);
    ui.log.scrollTop = ui.log.scrollHeight;
    if (texto) estado.conv.push(de === 'v' ? { de: 'v', t: texto } : { de: 'm', t: texto, mo: mo || 'guiado' });
    return b;
  }

  function ponerChips(lista, alElegir) {
    ui.chips.innerHTML = '';
    lista.forEach(function (o) {
      var b = el('button', 'mvc-chip', o.texto || o);
      b.type = 'button';
      if (o.clase) b.className += ' ' + o.clase;
      b.addEventListener('click', function () { (o.accion || alElegir)(o.texto || o); });
      ui.chips.appendChild(b);
    });
  }

  function escribiendo(si) {
    if (si) {
      if (!ui.puntos) { ui.puntos = el('p', 'mvc-b mvc-m mvc-puntos'); ui.puntos.setAttribute('aria-label', 'Velia está escribiendo'); ui.puntos.innerHTML = '<span></span><span></span><span></span>'; }
      ui.log.appendChild(ui.puntos);
      ui.log.scrollTop = ui.log.scrollHeight;
    } else if (ui.puntos && ui.puntos.parentNode) {
      ui.puntos.parentNode.removeChild(ui.puntos);
    }
  }

  function bloquear(si) {
    estado.ocupado = si;
    ui.input.disabled = si; ui.enviar.disabled = si;
    Array.prototype.forEach.call(ui.chips.querySelectorAll('button'), function (b) { b.disabled = si; });
  }

  function abrirChat(boton, href) {
    construir();
    lanzador = document.activeElement;
    evento('chat_abre', { id: boton || 'wa' });
    if (!estado.iniciado) {
      estado.boton = boton || 'fab';
      estado.hrefOriginal = href || ('https://wa.me/' + WA_NUMERO);
      estado.iniciado = true;
      saludo();
    } else if (CONTEXTO[boton] && !estado.listo && estado.paso < PASOS.indexOf('busca')) {
      // Chat ya empezado desde otro botón: si todavía no llega a «qué buscas», manda el interés más reciente.
      estado.boton = boton;
      estado.hrefOriginal = href || estado.hrefOriginal;
    }
    ui.directo.href = conRef(estado.hrefOriginal);
    ui.raiz.hidden = false;
    document.documentElement.classList.add('mvc-abierto');
    setTimeout(function () { var f = ui.chips.querySelector('button') || ui.input; if (f && !f.disabled) f.focus(); }, 30);
  }

  function cerrarChat() {
    if (!ui.raiz || ui.raiz.hidden) return;
    ui.raiz.hidden = true;
    evento('chat_cierra', { paso: estado.listo ? 'fin' : (PASOS[estado.paso] || 'inicio') });
    document.documentElement.classList.remove('mvc-abierto');
    if (lanzador && lanzador.focus) lanzador.focus();
  }

  function saludo() {
    // FUND43: quien llega desde «Quiero ser despacho fundador» ve su motivo desde el saludo.
    var motivo = estado.boton === 'fundador' ? ' Qué gusto que quieras ser despacho fundador con el plan Básico.' : '';
    burbuja('m', 'Hola, soy Velia, la asistente de Monvel.' + motivo + ' Antes de pasarte con Irvin por WhatsApp te hago un par de preguntas rápidas, para que llegues con todo listo y no tengas que repetir nada.');
    var nota = burbuja('m', '');
    nota.className += ' mvc-legal';
    nota.appendChild(document.createTextNode('Guardamos tus respuestas para darte seguimiento; cuando está disponible, Velia usa inteligencia artificial para entender lo que escribes. Detalles en el '));
    var a = el('a', null, 'aviso de privacidad');
    a.href = '#privacidad-chat';
    a.addEventListener('click', cerrarChat);
    nota.appendChild(a);
    nota.appendChild(document.createTextNode('.'));
    ui.form.hidden = true;
    ponerChips([
      { texto: 'Sí, empecemos', clase: 'mvc-chip-oro', accion: function () { estado.consentimiento = true; burbuja('v', 'Sí, empecemos'); evento('chat_resp', { paso: 'inicio', val: 'empezar', modo: 'opcion' }); siguiente(); } }
    ]);
  }

  function siguiente() {
    estado.paso += 1;
    if (estado.paso >= PASOS.length) return terminar();
    var p = PASOS[estado.paso];
    burbuja('m', PREGUNTAS[p](estado.campos));
    var ops = OPCIONES[p].slice();
    // El interés del botón tocado sale primero (si ya estaba en la lista, se sube; no se repite).
    if (p === 'busca' && CONTEXTO[estado.boton]) {
      var ya = ops.indexOf(CONTEXTO[estado.boton]);
      if (ya >= 0) ops.splice(ya, 1);
      ops.unshift(CONTEXTO[estado.boton]);
    }
    ponerChips(ops, function (t) { responder(t, true); });
    ui.form.hidden = false;
    ui.input.placeholder = MARCADOR[p];
    ui.input.value = '';
    // Al aparecer las opciones y la caja de texto, el registro se encoge: se vuelve al fondo para que la
    // pregunta nueva quede a la vista (en 853×533 se quedaba escondida detrás de las opciones).
    ui.log.scrollTop = ui.log.scrollHeight;
    setTimeout(function () { ui.log.scrollTop = ui.log.scrollHeight; if (p === 'nombre') ui.input.focus(); }, 30);
  }

  // Un paso opcional que se omite no guarda nada (el prospecto sigue siendo válido).
  function omitirPaso() {
    var p = PASOS[estado.paso];
    evento('chat_resp', { paso: p, val: 'omitido', modo: 'opcion' });
    siguiente();
  }

  function guardarCampo(valor, modo) {
    var p = PASOS[estado.paso];
    estado.campos[p] = String(valor).trim().slice(0, 120);
    evento('chat_resp', { paso: p, val: estado.campos[p].slice(0, 160), modo: modo });
    siguiente();
  }

  // Una opción (chip) se toma tal cual y no gasta IA. El texto libre pasa por
  // Velia si está disponible; si no, se toma tal cual (modo guiado).
  function responder(texto, esChip) {
    if (estado.ocupado || estado.listo) return;
    if (esChip && texto === OMITIR && OPCIONALES[PASOS[estado.paso]]) { burbuja('v', texto); return omitirPaso(); }
    burbuja('v', texto);
    if (esChip) return guardarCampo(texto, 'opcion');
    if (!hayIA) return guardarCampo(texto, 'guiado');
    preguntarAVelia(texto);
  }

  function preguntarAVelia(texto) {
    bloquear(true);
    escribiendo(true);
    var cuerpo = {
      paso: PASOS[estado.paso], campos: estado.campos, texto: texto,
      historial: estado.conv.slice(-9, -1), nueva: estado.iaNueva
    };
    var ctrl = window.AbortController ? new AbortController() : null;
    var reloj = setTimeout(function () { if (ctrl) ctrl.abort(); }, 16000);
    function aGuiado() { clearTimeout(reloj); escribiendo(false); bloquear(false); hayIA = false; guardarCampo(texto, 'guiado'); }
    fetch('/api/velia', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json().catch(function () { return { fallback: true }; }); })
      .then(function (d) {
        if (!d || !d.ok) return aGuiado();
        clearTimeout(reloj);
        escribiendo(false);
        bloquear(false);
        estado.iaUsada = true;
        estado.iaNueva = false;
        if (d.respuesta) burbuja('m', d.respuesta, 'ia');
        if (d.valor) return guardarCampo(d.valor, 'ia');
        // Fue una duda o no traía el dato: se vuelve a la misma pregunta.
        var p = PASOS[estado.paso];
        if (d.es_pregunta) burbuja('m', 'Y para seguir: ' + PREGUNTAS[p](estado.campos).replace(/^Mucho gusto, [^.]*\. /, ''));
        ui.input.focus();
      })
      .catch(aGuiado);
  }

  function folioLocal() {
    var dia = diaMX().replace(/-/g, '').slice(2);
    var abc = '23456789ABCDEFGHJKMNPQRSTUVWXYZ', s = '', r = new Uint8Array(4);
    (window.crypto || window.msCrypto).getRandomValues(r);
    for (var i = 0; i < 4; i++) s += abc[r[i] % abc.length];
    return 'MV-' + dia + '-' + s;
  }

  function mensajeWhatsApp() {
    var c = estado.campos;
    var lineas = ['Hola, soy ' + c.nombre + '.'];
    if (c.clientes) lineas.push('Llevo ' + c.clientes + ' clientes o RFC.');
    if (c.busca) lineas.push('Me interesa: ' + c.busca + '.');
    lineas.push('Folio ' + estado.folio);
    return lineas.join('\n');
  }

  function terminar() {
    estado.listo = true;
    ui.chips.innerHTML = '';
    ui.form.hidden = true;
    ui.salida.hidden = true; // ya viene el botón «Enviar por WhatsApp», con folio
    estado.folio = folioLocal();
    escribiendo(true);
    cerrarTramo();
    var datos = {
      accion: 'registrar', folio: estado.folio, consentimiento: estado.consentimiento === true, aviso_version: AVISO_VERSION,
      respuestas: estado.campos,
      origen: { ref: ses.r, utm: ses.utm, boton: estado.boton },
      secciones: Object.keys(ses.secs), segundos: ses.s, movil: equipo === 'movil', ia: estado.iaUsada,
      sid: noRastrear ? '' : ses.sid, dia: ses.dia,
      conversacion: estado.conv
    };
    fetch('/api/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(datos) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.folio) estado.folio = d.folio; estado.guardado = !!(d && d.ok); })
      .catch(function () { estado.guardado = false; /* el folio local viaja igual en el WhatsApp */ })
      .then(function () {
        escribiendo(false);
        // La sesión deja de ser anónima: queda ligada al folio que la persona aceptó dar.
        ses.folio = estado.guardado ? estado.folio : '';
        evento('lead', { folio: estado.guardado ? estado.folio : undefined });
        enviarSesion(true);
        resumen();
      });
  }

  function resumen() {
    var c = estado.campos;
    burbuja('m', 'Gracias, ' + primerNombre(c.nombre) + '. Tu folio es ' + estado.folio + '. Al tocar el botón se abre WhatsApp con tus respuestas ya escritas; sólo falta que lo envíes.');
    var tarjeta = el('div', 'mvc-resumen');
    [['Nombre', c.nombre], ['Busca', c.busca], ['Clientes o RFC', c.clientes]].forEach(function (f) {
      if (!f[1]) return;
      var fila = el('div');
      fila.appendChild(el('span', null, f[0]));
      fila.appendChild(el('b', null, f[1]));
      tarjeta.appendChild(fila);
    });
    var texto = mensajeWhatsApp();
    var wa = el('a', 'mvc-wa', 'Enviar por WhatsApp →');
    wa.href = 'https://wa.me/' + WA_NUMERO + '?text=' + encodeURIComponent(texto);
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.addEventListener('click', function () {
      evento('clic', { id: 'wa-chat', txt: 'Enviar por WhatsApp', sec: 'chat', wa: texto.slice(0, 160) });
      if (estado.guardado) {
        var b = JSON.stringify({ accion: 'wa', folio: estado.folio });
        try { if (navigator.sendBeacon) navigator.sendBeacon('/api/lead', new Blob([b], { type: 'application/json' })); } catch (e) { /* el clic a WhatsApp no depende de esto */ }
      }
    });
    tarjeta.appendChild(wa);
    ui.log.appendChild(tarjeta);
    ui.log.scrollTop = ui.log.scrollHeight;
    ui.wa = wa;
    wa.focus();
  }

  // Los enlaces de WhatsApp de la página abren el chat. El href se queda como
  // está: sin JavaScript, o con Ctrl/clic medio, siguen yendo directo.
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href*="wa.me/' + WA_NUMERO + '"]') : null;
    if (!a || a.closest('.mvc')) return; // los enlaces del propio chat (resumen y «directo») siguen su camino
    // Ctrl/Cmd/Shift/clic medio abren WhatsApp sin chat: el texto ya lleva el código, y la sesión se manda ya.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) { enviarSesion(true); return; }
    e.preventDefault();
    abrirChat(a.dataset.clic || 'wa', a.getAttribute('href'));
  });

  // Para las pruebas automáticas (no expone nada sensible).
  window.__mvAsistente = { estado: estado, sesion: function () { return ses; }, mensaje: function () { return mensajeWhatsApp(); }, abrir: abrirChat, enviarSesion: enviarSesion, refDeSid: refDeSid, ref: refVisita };
})();
