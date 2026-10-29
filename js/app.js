import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

// =====================================================================
//  Utilidades
// =====================================================================
const $ = (sel, raiz = document) => raiz.querySelector(sel);

// Crea elementos de forma segura (todo texto va como texto, nunca como HTML)
function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'hidden', 'selected', 'required'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const agregar = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) return c.forEach(agregar);
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  hijos.forEach(agregar);
  return el;
}

const fmtFecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Salta' });
const fecha = (iso) => (iso ? fmtFecha.format(new Date(iso)) : '—');

const ESTADOS_ACTA = { borrador: 'Borrador', en_firma: 'Esperando firmas', firmada: 'Firmada', rechazada: 'Rechazada', anulada: 'Anulada' };
const ESTADOS_SOL = { pendiente: 'Pendiente', firmada: 'Firmada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
const chip = (estado, textos = ESTADOS_ACTA) => h('span', { class: `chip ${estado}` }, textos[estado] || estado);

// Escalafones y jerarquías. [texto que se ve en la lista, cómo se guarda y sale en el acta]
const ESCALAFONES = {
  suboficial: {
    etiqueta: 'SUB-OFICIAL',
    grados: [
      ['AGENTE', 'AGENTE'], ['CABO', 'CABO'], ['SARGENTO', 'SARGENTO'], ['SARGENTO AYUDANTE', 'SARGENTO AYUDANTE'],
      ['PRINCIPAL', 'SUBOFICIAL PRINCIPAL'], ['MAYOR', 'SUBOFICIAL MAYOR'],
    ],
  },
  oficial: {
    etiqueta: 'OFICIAL',
    grados: [
      ['SUB-AYUDANTE', 'OFICIAL SUBAYUDANTE'], ['AYUDANTE', 'OFICIAL AYUDANTE'], ['AUXILIAR', 'OFICIAL AUXILIAR'],
      ['PRINCIPAL', 'OFICIAL PRINCIPAL'], ['SUB COMISARIO', 'SUBCOMISARIO'], ['COMISARIO', 'COMISARIO'],
      ['COMISARIO INSPECTOR', 'COMISARIO INSPECTOR'], ['COMISARIO MAYOR', 'COMISARIO MAYOR'], ['COMISARIO GENERAL', 'COMISARIO GENERAL'],
    ],
  },
};
const escalafonDe = (jerarquia) =>
  Object.keys(ESCALAFONES).find((k) => ESCALAFONES[k].grados.some(([, v]) => v === (jerarquia || '').toUpperCase())) || '';

// Pasa a MAYÚSCULAS mientras se escribe, sin mover el cursor
function mayusculas(input) {
  input.style.textTransform = 'uppercase';
  input.addEventListener('input', () => {
    const { selectionStart: a, selectionEnd: b } = input;
    const v = input.value.toLocaleUpperCase('es-AR');
    if (v !== input.value) { input.value = v; try { input.setSelectionRange(a, b); } catch {} }
  });
  return input;
}
const MAY = (t) => (t || '').toLocaleUpperCase('es-AR');

// Arma los dos desplegables: Funcionario → Jerarquía (la lista cambia según el funcionario)
function prepararJerarquia(selFunc, selJer, actual = '') {
  actual = MAY(actual);
  const opcion = (v, t, sel = false) => h('option', { value: v, selected: sel }, t);
  selFunc.replaceChildren(opcion('', 'Elegí una opción', true),
    ...Object.entries(ESCALAFONES).map(([k, e]) => opcion(k, e.etiqueta)));
  const llenar = (valor = '') => {
    const esc = ESCALAFONES[selFunc.value];
    selJer.disabled = !esc;
    selJer.replaceChildren(opcion('', esc ? 'Elegí la jerarquía' : 'Primero elegí funcionario', !valor),
      ...(esc ? esc.grados.map(([t, v]) => opcion(v, t, v === valor)) : []));
    // Jerarquía cargada antes de este cambio que no está en las listas: se conserva
    if (valor && !selJer.value) selJer.append(opcion(valor, valor, true));
  };
  selFunc.onchange = () => llenar();
  selFunc.value = escalafonDe(actual);
  llenar(actual);
}

const TIPOS = [
  'Acta de procedimiento', 'Acta de secuestro', 'Acta de inspección ocular', 'Acta de constatación',
  'Acta de notificación', 'Acta de entrega', 'Acta de detención', 'Acta de allanamiento',
  'Acta de declaración', 'Nota', 'Informe', 'Parte', 'Constancia', 'Certificado',
];

let toastTimer;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = tipo;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4200);
}

function mensajeError(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e || 'Error desconocido');
  if (/Invalid login credentials/i.test(m)) return 'Legajo o contraseña incorrectos.';
  if (/already registered|already been registered/i.test(m)) return 'Ese legajo ya tiene una cuenta.';
  if (/Database error saving new user/i.test(m)) return 'No se pudo crear la cuenta. Revisá los datos (puede que ese legajo ya esté registrado).';
  if (/Email not confirmed/i.test(m)) return 'La cuenta no está confirmada. El administrador debe desactivar "Confirm email" en Supabase.';
  if (/Password should be at least/i.test(m)) return 'La contraseña es muy corta.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Sin conexión con el servidor. Revisá internet.';
  if (/JWT expired/i.test(m)) return 'Tu sesión venció. Volvé a ingresar.';
  if (/PGRST116/i.test(m) || /0 rows/i.test(m)) return 'No tenés permiso para esa acción o el registro ya no existe.';
  return m;
}

function cargandoEn(cont) {
  cont.replaceChildren(h('p', { class: 'sutil' }, 'Cargando…'));
}

function descargarCSV(nombre, filas) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + filas.map((f) => f.map(esc).join(';')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: nombre });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Modal ----------
function abrirModal(titulo, cuerpo, { ancho } = {}) {
  const fondo = h('div', { class: 'modal-fondo', role: 'dialog', 'aria-modal': 'true' });
  const caja = h('div', { class: 'modal', style: ancho ? `max-width:${ancho}px` : null }, h('h2', {}, titulo), cuerpo);
  fondo.append(caja);
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') cerrar(); };
  fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', esc);
  document.body.append(fondo);
  const foco = caja.querySelector('input, textarea, select');
  if (foco) setTimeout(() => foco.focus(), 30);
  return { cerrar, caja };
}

function confirmar(titulo, texto, { boton = 'Confirmar', peligro = false } = {}) {
  return new Promise((resolver) => {
    let m;
    const ok = h('button', { class: `btn ${peligro ? 'peligro' : ''}`, type: 'button', onclick: () => { m.cerrar(); resolver(true); } }, boton);
    const no = h('button', { class: 'btn sec', type: 'button', onclick: () => { m.cerrar(); resolver(false); } }, 'Cancelar');
    m = abrirModal(titulo, h('div', {}, h('p', {}, texto), h('div', { class: 'acciones fin' }, no, ok)));
  });
}

// Pide un texto (motivo) en un modal
function pedirTexto(titulo, etiqueta, { boton = 'Aceptar', peligro = false, minimo = 5 } = {}) {
  return new Promise((resolver) => {
    let m;
    const ta = h('textarea', { style: 'min-height:110px', maxlength: '500' });
    const enviar = (e) => {
      e.preventDefault();
      if (ta.value.trim().length < minimo) return toast(`Escribí al menos ${minimo} letras.`, 'error');
      m.cerrar(); resolver(ta.value.trim());
    };
    m = abrirModal(titulo, h('form', { onsubmit: enviar },
      h('div', { class: 'campo' }, h('label', {}, etiqueta), ta),
      h('div', { class: 'acciones fin' },
        h('button', { class: 'btn sec', type: 'button', onclick: () => { m.cerrar(); resolver(null); } }, 'Cancelar'),
        h('button', { class: `btn ${peligro ? 'peligro' : ''}`, type: 'submit' }, boton))));
  });
}

// =====================================================================
//  Arranque y sesión
// =====================================================================
const configurado = !CONFIG.SUPABASE_URL.includes('TU-PROYECTO') && !CONFIG.SUPABASE_ANON_KEY.includes('PEGAR');

let almacen;
try { almacen = window.sessionStorage; sessionStorage.setItem('_p', '1'); sessionStorage.removeItem('_p'); } catch { almacen = undefined; }

const sb = configurado
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      // La sesión se guarda solo en esta pestaña: al cerrar el navegador se cierra la sesión
      auth: { storage: almacen, persistSession: !!almacen, autoRefreshToken: true },
    })
  : null;

const estado = { usuario: null, perfil: null, tieneFirma: false, cargandoSesion: null };
const emailDe = (legajo) => `${legajo.trim().toLowerCase()}@${CONFIG.DOMINIO_USUARIOS}`;
const legajoValido = (l) => /^[0-9A-Za-z]{3,15}$/.test(l.trim());

function mostrar(vista) {
  $('#cargando').hidden = true;
  $('#vista-acceso').hidden = vista !== 'acceso';
  $('#vista-app').hidden = vista !== 'app';
}

function iniciar() {
  if (!configurado) {
    $('#cargando').querySelector('p').textContent =
      'Falta configurar la conexión: completá SUPABASE_URL y SUPABASE_ANON_KEY en js/config.js (ver README).';
    return;
  }
  prepararAcceso();
  sb.auth.onAuthStateChange((evento, sesion) => {
    // No llamar a Supabase dentro del callback (puede trabar el cliente)
    if (evento === 'TOKEN_REFRESHED' || evento === 'USER_UPDATED') return;
    setTimeout(() => manejarSesion(sesion), 0);
  });
}

async function manejarSesion(sesion) {
  const uid = sesion?.user?.id || null;
  if (!uid) {
    estado.usuario = null; estado.perfil = null;
    detenerVigilancia();
    mostrarAcceso();
    return;
  }
  if (estado.usuario?.id === uid && estado.perfil) return;
  estado.usuario = sesion.user;

  const { data: perfil, error } = await sb.from('perfiles').select('*').eq('id', uid).maybeSingle();
  if (error || !perfil) {
    mostrarAcceso();
    mostrarEstadoCuenta('No se encontró tu perfil', 'Tu usuario existe pero no tiene perfil cargado. Avisale al administrador.');
    return;
  }
  estado.perfil = perfil;
  if (perfil.estado === 'pendiente') {
    mostrarAcceso();
    mostrarEstadoCuenta('Cuenta pendiente de aprobación',
      `Hola ${perfil.nombre}. Tu cuenta (legajo ${perfil.legajo}) fue creada y espera que un administrador verifique tus datos y la active. Probá ingresar más tarde.`);
    return;
  }
  if (perfil.estado === 'suspendido') {
    mostrarAcceso();
    mostrarEstadoCuenta('Cuenta suspendida', 'Tu cuenta está suspendida. Consultá con el administrador del sistema.');
    return;
  }

  $('#u-nombre').textContent = `${perfil.jerarquia} ${perfil.apellido}, ${perfil.nombre}`;
  $('#u-detalle').textContent = `Legajo ${perfil.legajo} · ${perfil.dependencia}`;
  $('#menu-admin').hidden = perfil.rol !== 'admin';
  mostrar('app');
  iniciarVigilancia();
  await actualizarFirmaPropia();
  actualizarInsignia();
  if (!location.hash || location.hash === '#') location.hash = '#/inicio';
  else rutear();
}

async function salir(motivo) {
  await sb.auth.signOut();
  if (motivo) toast(motivo);
}

// ---------- Cierre por inactividad + aviso de pendientes ----------
let timerInactivo, timerInsignia;
const reiniciarInactividad = () => {
  clearTimeout(timerInactivo);
  timerInactivo = setTimeout(() => salir('Se cerró la sesión por inactividad.'), CONFIG.MINUTOS_INACTIVIDAD * 60000);
};
function iniciarVigilancia() {
  ['click', 'keydown', 'pointermove', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, reiniciarInactividad, { passive: true }));
  reiniciarInactividad();
  clearInterval(timerInsignia);
  timerInsignia = setInterval(actualizarInsignia, 60000);
}
function detenerVigilancia() {
  clearTimeout(timerInactivo);
  clearInterval(timerInsignia);
}

async function actualizarInsignia() {
  if (!estado.perfil) return;
  const { count } = await sb.from('solicitudes_firma').select('id', { count: 'exact', head: true })
    .eq('firmante_id', estado.perfil.id).eq('estado', 'pendiente');
  const b = $('#insignia-pend');
  b.textContent = count || 0;
  b.hidden = !count;
  if (estado.perfil.rol === 'admin') {
    const r = await sb.from('perfiles').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    const a = $('#insignia-admin');
    a.textContent = r.count || 0;
    a.hidden = !r.count;
  }
}

async function actualizarFirmaPropia() {
  const { data } = await sb.rpc('mi_firma');
  const fila = Array.isArray(data) ? data[0] : data;
  estado.tieneFirma = !!fila?.tiene;
  return fila;
}

// =====================================================================
//  Pantalla de acceso
// =====================================================================
function prepararAcceso() {
  prepararJerarquia($('#re-funcionario'), $('#re-jerarquia'));
  ['#re-legajo', '#re-apellido', '#re-nombre', '#re-dependencia', '#re-cargo'].forEach((id) => mayusculas($(id)));
  const pest = document.querySelectorAll('.pestanas button');
  pest.forEach((b) => b.addEventListener('click', () => {
    pest.forEach((x) => x.classList.toggle('activo', x === b));
    $('#form-ingresar').hidden = b.dataset.pestana !== 'ingresar';
    $('#form-registro').hidden = b.dataset.pestana !== 'registro';
  }));

  $('#form-ingresar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const legajo = $('#in-legajo').value;
    if (!legajoValido(legajo)) return toast('Ingresá un legajo válido.', 'error');
    const btn = e.submitter || $('#form-ingresar button[type=submit]');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email: emailDe(legajo), password: $('#in-clave').value });
    btn.disabled = false;
    if (error) return toast(mensajeError(error), 'error');
    $('#in-clave').value = '';
  });

  $('#form-registro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => $(id).value.trim();
    const legajo = v('#re-legajo');
    if (!legajoValido(legajo)) return toast('El legajo debe tener entre 3 y 15 letras o números, sin espacios ni puntos.', 'error');
    if (!$('#re-funcionario').value) return toast('Elegí si sos Sub-oficial u Oficial.', 'error');
    if (!$('#re-jerarquia').value) return toast('Elegí tu jerarquía.', 'error');
    if ($('#re-clave').value !== $('#re-clave2').value) return toast('Las contraseñas no coinciden.', 'error');
    if ($('#re-clave').value.length < 8) return toast('La contraseña debe tener al menos 8 caracteres.', 'error');
    const btn = e.submitter || $('#form-registro button[type=submit]');
    btn.disabled = true;
    const { data, error } = await sb.auth.signUp({
      email: emailDe(legajo),
      password: $('#re-clave').value,
      options: {
        data: {
          legajo: MAY(legajo), apellido: MAY(v('#re-apellido')), nombre: MAY(v('#re-nombre')),
          jerarquia: MAY(v('#re-jerarquia')), dependencia: MAY(v('#re-dependencia')), cargo: MAY(v('#re-cargo')),
        },
      },
    });
    btn.disabled = false;
    if (error) return toast(mensajeError(error), 'error');
    if (!data.session) {
      toast('Cuenta creada. Ya podés ingresar con tu legajo y contraseña.');
      document.querySelector('[data-pestana="ingresar"]').click();
      $('#in-legajo').value = legajo;
    }
    e.target.reset();
    prepararJerarquia($('#re-funcionario'), $('#re-jerarquia'));
  });
}

function mostrarAcceso() {
  mostrar('acceso');
  const tarjeta = $('#vista-acceso .tarjeta');
  $('#acceso-estado')?.remove();
  tarjeta.hidden = false;
}

function mostrarEstadoCuenta(titulo, texto) {
  const tarjeta = $('#vista-acceso .tarjeta');
  tarjeta.hidden = true;
  $('#acceso-estado')?.remove();
  tarjeta.after(h('div', { class: 'tarjeta', id: 'acceso-estado' },
    h('h2', {}, titulo), h('p', {}, texto),
    h('button', { class: 'btn sec', type: 'button', onclick: () => salir() }, 'Volver')));
}

// =====================================================================
//  Rutas
// =====================================================================
let turno = 0; // evita que una vista vieja pise a una nueva
const contenido = () => $('#contenido');

async function rutear() {
  if (!estado.perfil || estado.perfil.estado !== 'activo') return;
  const partes = location.hash.replace(/^#\/?/, '').split('/');
  const ruta = partes[0] || 'inicio';
  const id = partes[1];
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('activo', a.dataset.ruta === ruta));
  const miTurno = ++turno;
  const cont = contenido();
  cargandoEn(cont);
  window.scrollTo(0, 0);
  try {
    const vistas = {
      inicio: vistaInicio, 'por-firmar': vistaPorFirmar, actas: vistaActas, nueva: () => vistaEditor(null),
      editar: () => vistaEditor(id), acta: () => vistaActa(id), historial: vistaHistorial, firma: vistaFirma,
      admin: vistaAdmin,
    };
    const nodo = await (vistas[ruta] || vistaInicio)();
    if (miTurno === turno && nodo) cont.replaceChildren(nodo);
  } catch (e) {
    console.error(e);
    if (miTurno === turno) cont.replaceChildren(h('div', { class: 'aviso error' }, h('p', {}, mensajeError(e))));
  }
}
window.addEventListener('hashchange', rutear);
const ir = (ruta) => { if (location.hash === ruta) rutear(); else location.hash = ruta; };

// =====================================================================
//  Vistas
// =====================================================================
async function vistaInicio() {
  const p = estado.perfil;
  const [pend, actas] = await Promise.all([
    sb.from('solicitudes_firma').select('id', { count: 'exact', head: true }).eq('firmante_id', p.id).eq('estado', 'pendiente'),
    sb.from('actas').select('estado').eq('autor_id', p.id),
  ]);
  const cuenta = (e) => (actas.data || []).filter((a) => a.estado === e).length;

  return h('div', {},
    h('div', { class: 'encabezado' }, h('h1', {}, `Hola, ${p.nombre}`)),
    !estado.tieneFirma && h('div', { class: 'aviso alerta' }, h('div', {},
      h('p', {}, h('b', {}, 'Todavía no registraste tu firma. '), 'Sin firma registrada no vas a poder firmar las actas que te envíen.'),
      h('a', { class: 'btn chico', href: '#/firma' }, 'Registrar mi firma'))),
    h('div', { class: 'grilla' },
      tarjetaDato(pend.count || 0, 'actas esperan tu firma', '#/por-firmar'),
      tarjetaDato(cuenta('en_firma'), 'de mis actas están esperando firmas', '#/actas'),
      tarjetaDato(cuenta('firmada'), 'de mis actas ya están firmadas', '#/actas'),
      tarjetaDato(cuenta('borrador'), 'borradores sin enviar', '#/actas')),
    h('div', { class: 'tarjeta', style: 'margin-top:14px' },
      h('h2', {}, '¿Cómo funciona?'),
      h('ol', { style: 'margin:0;padding-left:20px' },
        h('li', {}, 'Redactás el acta en ', h('a', { href: '#/nueva' }, 'Nueva acta'), '.'),
        h('li', {}, 'La enviás a firma eligiendo a tu jefe (y si querés, sumás tu propia firma).'),
        h('li', {}, 'Tu jefe la ve en "Por firmar", la lee y la firma con su PIN. Su firma vale solo para esa acta.'),
        h('li', {}, 'El acta firmada se imprime o se guarda en PDF con un código y QR para verificarla.'),
        h('li', {}, 'Cada jefe tiene en "Historial de mi firma" quién le pidió la firma y en qué acta.'))));
}

function tarjetaDato(num, texto, href) {
  return h('a', { class: 'tarjeta dato', href }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, texto));
}

// ---------- Por firmar ----------
async function vistaPorFirmar() {
  const { data, error } = await sb.from('solicitudes_firma')
    .select('id, mensaje, creada_at, actas(id, codigo, tipo, titulo, autor_nombre, autor_jerarquia, autor_legajo, dependencia)')
    .eq('firmante_id', estado.perfil.id).eq('estado', 'pendiente').order('creada_at', { ascending: true });
  if (error) throw error;
  actualizarInsignia();
  const propia = (s) => s.actas && s.actas.autor_legajo === estado.perfil.legajo;
  return h('div', {},
    h('div', { class: 'encabezado' }, h('h1', {}, 'Actas por firmar')),
    !estado.tieneFirma && h('div', { class: 'aviso alerta' }, h('p', {}, 'Para firmar primero registrá tu firma en ', h('a', { href: '#/firma' }, 'Mi firma y cuenta'), '.')),
    h('div', { class: 'tarjeta' },
      data.length === 0
        ? h('div', { class: 'vacio' }, 'No tenés actas esperando tu firma.')
        : h('ul', { class: 'lista' }, data.map((s) => h('li', {},
          h('a', { class: 'item', href: `#/acta/${s.actas.id}` },
            h('div', {},
              h('div', { class: 'tit' }, `${s.actas.tipo} — ${s.actas.titulo}`),
              h('div', { class: 'meta' }, propia(s) ? 'Tu propia acta (agregaste tu firma)' :
                `Pedido por ${s.actas.autor_jerarquia} ${s.actas.autor_nombre} (Leg. ${s.actas.autor_legajo}) · ${s.actas.dependencia}`),
              s.mensaje && h('div', { class: 'meta' }, `“${s.mensaje}”`)),
            h('div', { class: 'der' }, chip('pendiente', ESTADOS_SOL), h('small', {}, fecha(s.creada_at)))))))));
}

// ---------- Mis actas ----------
async function vistaActas() {
  const { data, error } = await sb.from('actas').select('id, codigo, tipo, titulo, estado, creada_at, enviada_at')
    .eq('autor_id', estado.perfil.id).order('creada_at', { ascending: false }).limit(300);
  if (error) throw error;

  let filtro = 'todas';
  const lista = h('div');
  const pintar = () => {
    const filas = data.filter((a) => filtro === 'todas' || a.estado === filtro);
    lista.replaceChildren(filas.length === 0
      ? h('div', { class: 'vacio' }, 'No hay actas para mostrar.')
      : h('ul', { class: 'lista' }, filas.map((a) => h('li', {},
        h('a', { class: 'item', href: `#/acta/${a.id}` },
          h('div', {}, h('div', { class: 'tit' }, `${a.tipo} — ${a.titulo}`), h('div', { class: 'meta' }, `Código ${a.codigo} · creada ${fecha(a.creada_at)}`)),
          h('div', { class: 'der' }, chip(a.estado)))))));
  };
  const filtros = h('div', { class: 'filtros' }, [['todas', 'Todas'], ...Object.entries(ESTADOS_ACTA)].map(([k, t]) =>
    h('button', { class: `filtro ${k === filtro ? 'activo' : ''}`, type: 'button', onclick: (e) => {
      filtro = k; filtros.querySelectorAll('.filtro').forEach((b) => b.classList.toggle('activo', b === e.currentTarget)); pintar();
    } }, t)));
  pintar();
  return h('div', {},
    h('div', { class: 'encabezado' }, h('h1', {}, 'Mis actas'), h('a', { class: 'btn', href: '#/nueva' }, '+ Nueva acta')),
    filtros, h('div', { class: 'tarjeta' }, lista));
}

// ---------- Editor de acta ----------
async function vistaEditor(id) {
  let acta = { tipo: '', titulo: '', lugar: 'Salta, Capital', contenido: '' };
  if (id) {
    const { data, error } = await sb.from('actas').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || data.autor_id !== estado.perfil.id) return h('div', { class: 'aviso error' }, h('p', {}, 'Acta no encontrada.'));
    if (data.estado !== 'borrador') return h('div', { class: 'aviso alerta' }, h('p', {}, 'Esta acta ya fue enviada a firma y no se puede editar.'));
    acta = data;
  }
  const dlTipos = h('datalist', { id: 'tipos-acta' }, TIPOS.map((t) => h('option', { value: t })));
  const tipo = h('input', { list: 'tipos-acta', required: true, maxlength: '80', value: acta.tipo, placeholder: 'Elegí o escribí el tipo' });
  const titulo = h('input', { required: true, maxlength: '200', value: acta.titulo, placeholder: 'Ej.: Secuestro de motocicleta en Bº Juan Pablo II' });
  const lugar = h('input', { maxlength: '200', value: acta.lugar || '' });
  const texto = h('textarea', { required: true, maxlength: '60000', value: acta.contenido });

  const insertarInicio = () => {
    const ahora = new Date();
    const zona = { timeZone: 'America/Argentina/Salta' };
    const dia = ahora.toLocaleString('es-AR', { ...zona, day: 'numeric' });
    const mes = ahora.toLocaleString('es-AR', { ...zona, month: 'long' });
    const anio = ahora.toLocaleString('es-AR', { ...zona, year: 'numeric' });
    const hora = ahora.toLocaleString('es-AR', { ...zona, hour: '2-digit', minute: '2-digit', hour12: false });
    const p = estado.perfil;
    const inicio = `En la ciudad de Salta, Capital de la Provincia del mismo nombre, República Argentina, a los ${dia} días del mes de ${mes} del año ${anio}, siendo las ${hora} horas, el/la suscripto/a ${p.jerarquia} ${p.nombre} ${p.apellido}, Legajo ${p.legajo}, perteneciente a ${p.dependencia}, `;
    texto.value = inicio + texto.value;
    texto.focus();
    texto.setSelectionRange(inicio.length, inicio.length);
  };

  const guardar = async (despues) => {
    if (!tipo.value.trim() || titulo.value.trim().length < 3 || texto.value.trim().length < 10) {
      return toast('Completá tipo, título (3+ letras) y el texto del acta (10+ letras).', 'error');
    }
    const datos = { tipo: tipo.value.trim(), titulo: titulo.value.trim(), lugar: lugar.value.trim() || null, contenido: texto.value.trim() };
    const consulta = id ? sb.from('actas').update(datos).eq('id', id) : sb.from('actas').insert(datos);
    const { data, error } = await consulta.select('id').single();
    if (error) return toast(mensajeError(error), 'error');
    toast('Acta guardada.');
    if (despues === 'enviar') {
      location.hash = `#/acta/${data.id}`;
      setTimeout(() => modalEnviarAFirma(data.id), 400);
    } else ir(`#/acta/${data.id}`);
  };

  return h('div', {},
    dlTipos,
    h('div', { class: 'encabezado' }, h('h1', {}, id ? 'Editar borrador' : 'Nueva acta')),
    h('form', { class: 'tarjeta', onsubmit: (e) => { e.preventDefault(); guardar(); } },
      h('div', { class: 'fila' },
        h('div', { class: 'campo' }, h('label', {}, 'Tipo de documento'), tipo),
        h('div', { class: 'campo' }, h('label', {}, 'Lugar'), lugar)),
      h('div', { class: 'campo' }, h('label', {}, 'Título / asunto'), titulo),
      h('div', { class: 'campo' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:end;gap:8px;flex-wrap:wrap;margin-bottom:4px' },
          h('label', { style: 'margin:0' }, 'Texto del acta'),
          h('button', { class: 'btn sec chico', type: 'button', onclick: insertarInicio }, 'Insertar fórmula de inicio')),
        texto,
        h('small', { class: 'sutil' }, 'Cuando la envíes a firma, el texto queda bloqueado: nadie (ni vos) lo podrá cambiar.')),
      h('div', { class: 'acciones fin' },
        h('a', { class: 'btn sec', href: id ? `#/acta/${id}` : '#/actas' }, 'Cancelar'),
        h('button', { class: 'btn sec', type: 'submit' }, 'Guardar borrador'),
        h('button', { class: 'btn', type: 'button', onclick: () => guardar('enviar') }, 'Guardar y enviar a firma'))));
}

// ---------- Ver acta ----------
async function vistaActa(id) {
  const [ra, rs] = await Promise.all([
    sb.from('actas').select('*').eq('id', id).maybeSingle(),
    sb.from('solicitudes_firma').select('id, firmante_id, orden, estado, mensaje, motivo_rechazo, hash_firmado, firma_imagen, firmante_nombre, firmante_jerarquia, firmante_cargo, firmante_dependencia, firmante_legajo, creada_at, resuelta_at, firmante:perfiles!solicitudes_firma_firmante_id_fkey(apellido, nombre, jerarquia, cargo, legajo, dependencia)')
      .eq('acta_id', id).order('orden'),
  ]);
  if (ra.error) throw ra.error;
  if (rs.error) throw rs.error;
  const acta = ra.data;
  if (!acta) return h('div', { class: 'aviso error' }, h('p', {}, 'Acta no encontrada o sin permiso para verla.'));
  const sols = rs.data || [];
  const yo = estado.perfil.id;
  const soyAutor = acta.autor_id === yo;
  const miSol = sols.find((s) => s.firmante_id === yo);

  const acciones = h('div', { class: 'doc-acciones' },
    h('a', { class: 'btn sec chico', href: soyAutor ? '#/actas' : '#/por-firmar' }, '← Volver'),
    chip(acta.estado),
    h('span', { style: 'flex:1' }),
    h('button', { class: 'btn sec chico', type: 'button', onclick: () => window.print() }, 'Imprimir / Guardar PDF'));

  if (soyAutor) {
    if (acta.estado === 'borrador') {
      acciones.append(
        h('a', { class: 'btn sec chico', href: `#/editar/${acta.id}` }, 'Editar'),
        h('button', { class: 'btn peligro chico', type: 'button', onclick: () => eliminarBorrador(acta) }, 'Eliminar'),
        h('button', { class: 'btn chico', type: 'button', onclick: () => modalEnviarAFirma(acta.id) }, 'Enviar a firma'));
    }
    if (acta.estado === 'en_firma') {
      acciones.append(h('button', { class: 'btn sec chico', type: 'button', onclick: () => modalEnviarAFirma(acta.id, sols.map((s) => s.firmante_id)) }, 'Sumar firmante'));
    }
    if (['rechazada', 'anulada', 'firmada'].includes(acta.estado)) {
      acciones.append(h('button', { class: 'btn sec chico', type: 'button', onclick: () => duplicar(acta) }, 'Copiar como nuevo borrador'));
    }
    if (acta.estado !== 'anulada' && acta.estado !== 'borrador') {
      acciones.append(h('button', { class: 'btn peligro chico', type: 'button', onclick: () => anular(acta) }, 'Anular'));
    }
  }

  const avisos = [];
  if (miSol && miSol.estado === 'pendiente' && acta.estado === 'en_firma') {
    avisos.push(h('div', { class: 'aviso info no-imprimir' }, h('div', { style: 'flex:1' },
      h('p', {}, h('b', {}, soyAutor ? 'Agregaste tu propia firma a esta acta.' : `${acta.autor_jerarquia} ${acta.autor_nombre} te pide tu firma para esta acta.`),
        ' Leela completa antes de firmar. Tu firma se aplicará solo a este documento y quedará registrada en tu historial.'),
      miSol.mensaje && h('p', {}, `Mensaje: “${miSol.mensaje}”`),
      h('div', { class: 'acciones' },
        h('button', { class: 'btn ok', type: 'button', onclick: () => modalFirmar(acta, miSol) }, 'Firmar con mi PIN'),
        h('button', { class: 'btn peligro', type: 'button', onclick: () => rechazar(miSol) }, 'Rechazar')))));
  }
  const rech = sols.find((s) => s.estado === 'rechazada');
  if (rech) avisos.push(h('div', { class: 'aviso error no-imprimir' }, h('p', {},
    h('b', {}, `Rechazada por ${nombreFirmante(rech)}: `), rech.motivo_rechazo || '')));
  if (acta.estado === 'anulada') avisos.push(h('div', { class: 'aviso error no-imprimir' }, h('p', {}, h('b', {}, 'Acta anulada: '), acta.motivo_anulacion || '')));
  if (soyAutor && acta.estado === 'en_firma') {
    const faltan = sols.filter((s) => s.estado === 'pendiente').map(nombreFirmante);
    if (faltan.length) avisos.push(h('div', { class: 'aviso alerta no-imprimir' }, h('p', {}, `Esperando la firma de: ${faltan.join(' · ')}`)));
  }

  return h('div', {}, acciones, avisos, renderHoja(acta, sols));
}

function nombreFirmante(s) {
  if (s.firmante_nombre) return `${s.firmante_jerarquia} ${s.firmante_nombre}`;
  const f = s.firmante;
  return f ? `${f.jerarquia} ${f.apellido}, ${f.nombre}` : 'Firmante';
}

function renderHoja(acta, sols) {
  const urlVerificar = new URL(`verificar.html?c=${encodeURIComponent(acta.codigo)}`, location.href.split('#')[0]).href;
  const qrCaja = h('div', { class: 'qr' });
  try {
    if (window.qrcode) {
      const q = window.qrcode(0, 'M');
      q.addData(urlVerificar);
      q.make();
      qrCaja.append(h('img', { src: q.createDataURL(4, 0), alt: 'QR de verificación' }));
    }
  } catch (e) { console.warn('QR', e); }

  const marca = {
    borrador: ['borrador', 'Borrador — sin validez'],
    en_firma: ['borrador', 'En proceso de firma — sin validez hasta completar las firmas'],
    rechazada: ['', 'Rechazada — sin validez'],
    anulada: ['', 'Anulada — sin validez'],
  }[acta.estado];

  const visibles = sols.filter((s) => s.estado !== 'cancelada');
  const bloques = visibles.map((s) => {
    const f = s.firmante || {};
    const valida = s.estado === 'firmada' && s.hash_firmado === acta.hash;
    return h('div', { class: 'firma-bloque' },
      h('div', { class: 'img' }, s.estado === 'firmada' && s.firma_imagen
        ? h('img', { src: s.firma_imagen, alt: 'Firma' })
        : h('div', { class: 'estado' }, s.estado === 'rechazada' ? 'Firma rechazada' : 'Pendiente de firma')),
      h('div', { class: 'linea' }),
      h('b', {}, s.firmante_nombre ? `${s.firmante_jerarquia} ${s.firmante_nombre}` : `${f.jerarquia || ''} ${f.apellido || ''}, ${f.nombre || ''}`),
      h('div', { class: 'det' }, s.firmante_cargo || f.cargo || ''),
      h('div', { class: 'det' }, `Legajo ${s.firmante_legajo || f.legajo || ''} · ${s.firmante_dependencia || f.dependencia || ''}`),
      s.estado === 'firmada' && h('div', { class: 'sello' }, valida ? `✓ Firmado electrónicamente el ${fecha(s.resuelta_at)}` : '⚠ La huella no coincide'));
  });

  return h('article', { class: 'hoja' },
    marca && h('div', { class: `marca-agua ${marca[0]}` }, marca[1]),
    h('div', { class: 'hoja-cab' },
      h('img', { src: 'img/escudo.svg', alt: '' }),
      h('div', { class: 'inst' }, h('b', {}, CONFIG.INSTITUCION), h('span', {}, acta.dependencia || ''))),
    h('p', { class: 'hoja-tipo' }, acta.tipo),
    h('p', { class: 'hoja-titulo' }, acta.titulo),
    acta.lugar && h('div', { class: 'hoja-lugar' }, `${acta.lugar}, ${fecha(acta.enviada_at || acta.creada_at).split(',')[0]}`),
    h('div', { class: 'hoja-cuerpo' }, acta.contenido),
    bloques.length > 0 && h('div', { class: 'hoja-firmas' }, bloques),
    h('div', { class: 'hoja-autor' }, `Labrada por: ${acta.autor_jerarquia} ${acta.autor_nombre} (Legajo ${acta.autor_legajo}).`),
    h('div', { class: 'hoja-pie' }, qrCaja, h('div', {},
      h('div', {}, h('b', {}, `Código de verificación: ${acta.codigo}`)),
      h('div', {}, 'Documento firmado electrónicamente en el Sistema de Firma Electrónica. Verificá su autenticidad escaneando el QR o ingresando el código en:'),
      h('div', {}, urlVerificar.split('?')[0]),
      h('div', {}, 'Huella SHA-256: ', h('code', {}, acta.hash || '')))));
}

// ---------- Acciones sobre actas ----------
async function eliminarBorrador(acta) {
  if (!(await confirmar('Eliminar borrador', `¿Eliminar "${acta.titulo}"? No se puede deshacer.`, { boton: 'Eliminar', peligro: true }))) return;
  const { error } = await sb.from('actas').delete().eq('id', acta.id);
  if (error) return toast(mensajeError(error), 'error');
  toast('Borrador eliminado.');
  ir('#/actas');
}

async function duplicar(acta) {
  const { data, error } = await sb.from('actas')
    .insert({ tipo: acta.tipo, titulo: acta.titulo, lugar: acta.lugar, contenido: acta.contenido }).select('id').single();
  if (error) return toast(mensajeError(error), 'error');
  toast('Se creó un nuevo borrador para corregir.');
  ir(`#/editar/${data.id}`);
}

async function anular(acta) {
  const motivo = await pedirTexto('Anular acta', 'Motivo de la anulación', { boton: 'Anular acta', peligro: true });
  if (!motivo) return;
  const { data, error } = await sb.rpc('anular_acta', { p_acta: acta.id, p_motivo: motivo });
  if (error || !data?.ok) return toast(mensajeError(error || data?.error), 'error');
  toast('Acta anulada.');
  rutear();
}

async function rechazar(sol) {
  const motivo = await pedirTexto('Rechazar firma', 'Motivo (lo verá quien te pidió la firma)', { boton: 'Rechazar', peligro: true });
  if (!motivo) return;
  const { data, error } = await sb.rpc('rechazar_solicitud', { p_solicitud: sol.id, p_motivo: motivo });
  if (error || !data?.ok) return toast(mensajeError(error || data?.error), 'error');
  toast('Rechazaste la solicitud de firma.');
  actualizarInsignia();
  rutear();
}

function modalFirmar(acta, sol) {
  if (!estado.tieneFirma) {
    toast('Primero registrá tu firma en "Mi firma y cuenta".', 'error');
    return ir('#/firma');
  }
  let m;
  const pin = h('input', { class: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', pattern: '[0-9]{6}', required: true });
  const btn = h('button', { class: 'btn ok', type: 'submit' }, 'Firmar');
  const enviar = async (e) => {
    e.preventDefault();
    if (!/^[0-9]{6}$/.test(pin.value)) return toast('El PIN tiene 6 números.', 'error');
    btn.disabled = true;
    const { data, error } = await sb.rpc('firmar_solicitud', { p_solicitud: sol.id, p_pin: pin.value });
    btn.disabled = false;
    if (error || !data?.ok) { pin.value = ''; return toast(mensajeError(error || data?.error), 'error'); }
    m.cerrar();
    toast(data.acta_completa ? 'Firmaste el acta. Ya tiene todas las firmas.' : 'Firmaste el acta.');
    actualizarInsignia();
    rutear();
  };
  m = abrirModal('Firmar acta', h('form', { onsubmit: enviar },
    h('p', {}, 'Vas a firmar: ', h('b', {}, `${acta.tipo} — ${acta.titulo}`), ` (código ${acta.codigo}).`),
    h('p', { class: 'sutil' }, 'Tu firma se aplicará únicamente a esta acta, con el texto tal como está ahora. Quedará registrado en tu historial.'),
    h('div', { class: 'campo' }, h('label', {}, 'Tu PIN de firma'), pin),
    h('div', { class: 'acciones fin' }, h('button', { class: 'btn sec', type: 'button', onclick: () => m.cerrar() }, 'Cancelar'), btn)));
}

function modalEnviarAFirma(actaId, yaAgregados = []) {
  let m;
  const yo = estado.perfil;
  const elegidos = new Map();
  const caja = h('div', { class: 'elegidos' });
  const resultados = h('div', { class: 'resultados' }, h('div', { class: 'vacio' }, 'Escribí apellido, legajo o dependencia.'));
  const buscar = h('input', { placeholder: 'Buscar por apellido, legajo o dependencia…', autocomplete: 'off' });
  const incluirme = h('input', { type: 'checkbox', checked: !yaAgregados.includes(yo.id), disabled: yaAgregados.includes(yo.id), style: 'width:auto' });
  const mensaje = h('textarea', { style: 'min-height:70px', maxlength: '500', placeholder: 'Ej.: Jefe, le envío el acta de secuestro del procedimiento de hoy.' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Enviar solicitud');

  const pintarElegidos = () => caja.replaceChildren(...[...elegidos.values()].map((p) =>
    h('span', { class: 'elegido' }, `${p.jerarquia} ${p.apellido}`,
      h('button', { type: 'button', title: 'Quitar', onclick: () => { elegidos.delete(p.id); pintarElegidos(); } }, '×'))));

  let espera;
  buscar.addEventListener('input', () => {
    clearTimeout(espera);
    espera = setTimeout(async () => {
      const t = buscar.value.trim();
      if (t.length < 2) return resultados.replaceChildren(h('div', { class: 'vacio' }, 'Escribí al menos 2 letras.'));
      const { data, error } = await sb.rpc('buscar_personal', { p_texto: t });
      if (error) return resultados.replaceChildren(h('div', { class: 'vacio' }, mensajeError(error)));
      const filas = (data || []).filter((p) => p.id !== yo.id && !yaAgregados.includes(p.id));
      resultados.replaceChildren(filas.length === 0
        ? h('div', { class: 'vacio' }, 'Sin resultados.')
        : h('ul', { class: 'lista' }, filas.map((p) => h('li', {},
          h('div', { class: 'item', role: 'button', tabindex: '0', onclick: () => { elegidos.set(p.id, p); pintarElegidos(); } },
            h('div', {}, h('div', { class: 'tit' }, `${p.jerarquia} ${p.apellido}, ${p.nombre}`),
              h('div', { class: 'meta' }, `Leg. ${p.legajo} · ${p.dependencia}${p.cargo ? ' · ' + p.cargo : ''}`),
              !p.tiene_firma && h('div', { class: 'meta', style: 'color:var(--ambar)' }, 'Todavía no registró su firma')),
            h('span', { class: 'btn sec chico' }, 'Agregar'))))));
    }, 300);
  });

  const enviar = async (e) => {
    e.preventDefault();
    const ids = [...elegidos.keys()];
    if (incluirme.checked && !incluirme.disabled) ids.push(yo.id);
    if (ids.length === 0) return toast('Elegí al menos un firmante.', 'error');
    btn.disabled = true;
    const { data, error } = await sb.rpc('enviar_a_firma', { p_acta: actaId, p_firmantes: ids, p_mensaje: mensaje.value.trim() || null });
    btn.disabled = false;
    if (error) return toast(mensajeError(error), 'error');
    m.cerrar();
    toast(`Solicitud enviada (${data.solicitudes}). El texto del acta quedó bloqueado.`);
    actualizarInsignia();
    ir(`#/acta/${actaId}`);
  };

  m = abrirModal(yaAgregados.length ? 'Sumar firmante' : 'Enviar a firma', h('form', { onsubmit: enviar },
    h('div', { class: 'campo' }, h('label', {}, '¿A quién le pedís la firma?'), buscar),
    resultados, caja,
    h('label', { style: 'display:flex;gap:8px;align-items:center;font-weight:400;margin-bottom:12px' }, incluirme,
      yaAgregados.includes(yo.id) ? 'Tu firma ya está incluida' : 'Incluir también mi firma (como autor del acta)'),
    h('div', { class: 'campo' }, h('label', {}, 'Mensaje (opcional)'), mensaje),
    h('p', { class: 'sutil', style: 'font-size:.88rem' }, 'Al enviar, el texto del acta queda bloqueado y cada firmante la verá en "Por firmar".'),
    h('div', { class: 'acciones fin' }, h('button', { class: 'btn sec', type: 'button', onclick: () => m.cerrar() }, 'Cancelar'), btn)), { ancho: 620 });
}

// ---------- Historial de mi firma ----------
async function vistaHistorial() {
  const { data, error } = await sb.from('solicitudes_firma')
    .select('id, estado, mensaje, motivo_rechazo, creada_at, resuelta_at, actas(id, codigo, tipo, titulo, autor_nombre, autor_jerarquia, autor_legajo, dependencia, estado)')
    .eq('firmante_id', estado.perfil.id).order('creada_at', { ascending: false }).limit(500);
  if (error) throw error;

  let filtro = 'todas';
  const lista = h('div');
  const pintar = () => {
    const filas = data.filter((s) => filtro === 'todas' || s.estado === filtro);
    lista.replaceChildren(filas.length === 0
      ? h('div', { class: 'vacio' }, 'Sin registros.')
      : h('ul', { class: 'lista' }, filas.map((s) => {
        const a = s.actas || {};
        const propia = a.autor_legajo === estado.perfil.legajo;
        return h('li', {}, h('a', { class: 'item', href: `#/acta/${a.id}` },
          h('div', {},
            h('div', { class: 'tit' }, `${a.tipo} — ${a.titulo}`),
            h('div', { class: 'meta' }, propia ? 'Acta propia' : `Solicitó: ${a.autor_jerarquia} ${a.autor_nombre} (Leg. ${a.autor_legajo}) · ${a.dependencia}`),
            h('div', { class: 'meta' }, `Código ${a.codigo} · pedido ${fecha(s.creada_at)}${s.resuelta_at ? ' · resuelto ' + fecha(s.resuelta_at) : ''}`),
            s.motivo_rechazo && h('div', { class: 'meta' }, `Motivo del rechazo: ${s.motivo_rechazo}`)),
          h('div', { class: 'der' }, chip(s.estado, ESTADOS_SOL))));
      })));
  };
  const filtros = h('div', { class: 'filtros' }, [['todas', 'Todas'], ...Object.entries(ESTADOS_SOL)].map(([k, t]) =>
    h('button', { class: `filtro ${k === filtro ? 'activo' : ''}`, type: 'button', onclick: (e) => {
      filtro = k; filtros.querySelectorAll('.filtro').forEach((b) => b.classList.toggle('activo', b === e.currentTarget)); pintar();
    } }, t)));
  pintar();

  const exportar = () => descargarCSV(`historial-firma-${estado.perfil.legajo}.csv`, [
    ['Estado', 'Código', 'Tipo', 'Título', 'Solicitante', 'Legajo solicitante', 'Dependencia', 'Fecha pedido', 'Fecha resolución', 'Motivo rechazo'],
    ...data.map((s) => [ESTADOS_SOL[s.estado], s.actas?.codigo, s.actas?.tipo, s.actas?.titulo,
      `${s.actas?.autor_jerarquia} ${s.actas?.autor_nombre}`, s.actas?.autor_legajo, s.actas?.dependencia,
      fecha(s.creada_at), fecha(s.resuelta_at), s.motivo_rechazo || '']),
  ]);

  const firmadas = data.filter((s) => s.estado === 'firmada').length;
  return h('div', {},
    h('div', { class: 'encabezado' }, h('h1', {}, 'Historial de mi firma'),
      h('button', { class: 'btn sec', type: 'button', onclick: exportar, disabled: data.length === 0 }, 'Descargar Excel (CSV)')),
    h('p', { class: 'sutil' }, `Todas las veces que te pidieron la firma, quién la pidió y en qué acta. Firmaste ${firmadas} ${firmadas === 1 ? 'acta' : 'actas'}.`),
    filtros, h('div', { class: 'tarjeta' }, lista));
}

// ---------- Mi firma y cuenta ----------
async function vistaFirma() {
  const actual = await actualizarFirmaPropia();
  const p = estado.perfil;
  const zonaPad = h('div');

  const mostrarPad = () => {
    const canvas = h('canvas');
    const pinNuevo = h('input', { class: 'pin', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'new-password', required: true });
    const pinNuevo2 = h('input', { class: 'pin', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'new-password', required: true });
    const pinActual = actual?.tiene ? h('input', { class: 'pin', type: 'password', inputmode: 'numeric', maxlength: '6', autocomplete: 'current-password', required: true }) : null;
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Guardar mi firma');
    let pad;

    const enviar = async (e) => {
      e.preventDefault();
      if (pad.vacio()) return toast('Dibujá tu firma en el recuadro.', 'error');
      if (!/^[0-9]{6}$/.test(pinNuevo.value)) return toast('El PIN debe tener exactamente 6 números.', 'error');
      if (pinNuevo.value !== pinNuevo2.value) return toast('Los PIN no coinciden.', 'error');
      if (/^(\d)\1{5}$/.test(pinNuevo.value) || ['123456', '654321', '012345'].includes(pinNuevo.value)) return toast('Elegí un PIN menos obvio.', 'error');
      btn.disabled = true;
      const { data, error } = await sb.rpc('guardar_firma', { p_imagen: pad.exportar(), p_pin_nuevo: pinNuevo.value, p_pin_actual: pinActual ? pinActual.value : null });
      btn.disabled = false;
      if (error || !data?.ok) return toast(mensajeError(error || data?.error), 'error');
      toast('Tu firma quedó registrada.');
      rutear();
    };

    zonaPad.replaceChildren(h('form', { onsubmit: enviar },
      h('label', {}, 'Dibujá tu firma (con el dedo, lápiz o mouse)'),
      h('div', { class: 'pad-caja' }, canvas, h('div', { class: 'pad-linea' }), h('div', { class: 'pad-ayuda' }, 'Firmá sobre la línea')),
      h('div', { class: 'acciones', style: 'margin:8px 0 16px' }, h('button', { class: 'btn sec chico', type: 'button', onclick: () => pad.limpiar() }, 'Borrar y empezar de nuevo')),
      h('div', { class: 'fila' },
        h('div', { class: 'campo' }, h('label', {}, 'PIN de firma (6 números)'), pinNuevo),
        h('div', { class: 'campo' }, h('label', {}, 'Repetir PIN'), pinNuevo2),
        pinActual && h('div', { class: 'campo' }, h('label', {}, 'PIN actual'), pinActual)),
      h('p', { class: 'sutil', style: 'font-size:.9rem' }, 'El PIN se te pedirá cada vez que firmes. No lo compartas con nadie: es lo que garantiza que la firma la ponés vos. Tras 5 intentos fallidos la firma se bloquea 15 minutos.'),
      h('div', { class: 'acciones fin' }, actual?.tiene && h('button', { class: 'btn sec', type: 'button', onclick: () => rutear() }, 'Cancelar'), btn)));
    requestAnimationFrame(() => { pad = crearPad(canvas); });
  };

  const seccionFirma = h('div', { class: 'tarjeta' }, h('h2', {}, 'Mi firma'));
  if (actual?.tiene) {
    seccionFirma.append(
      h('div', { class: 'firma-actual' }, h('img', { src: actual.imagen, alt: 'Mi firma' })),
      h('p', { class: 'sutil', style: 'margin-top:8px' }, `Registrada/actualizada el ${fecha(actual.actualizada_at)}. Las actas ya firmadas conservan la firma que tenían en ese momento.`),
      actual.bloqueada_hasta && new Date(actual.bloqueada_hasta) > new Date() && h('div', { class: 'aviso error' }, h('p', {}, `Firma bloqueada por intentos fallidos hasta ${fecha(actual.bloqueada_hasta)}.`)),
      zonaPad);
    zonaPad.append(h('button', { class: 'btn sec', type: 'button', onclick: mostrarPad }, 'Cambiar mi firma o PIN'));
  } else {
    seccionFirma.append(h('div', { class: 'aviso info' }, h('p', {}, 'Registrá tu firma una sola vez. Solo vos podés cambiarla.')), zonaPad);
    setTimeout(mostrarPad, 0);
  }

  // Cambio de contraseña
  const c1 = h('input', { type: 'password', minlength: '8', autocomplete: 'new-password', required: true });
  const c2 = h('input', { type: 'password', minlength: '8', autocomplete: 'new-password', required: true });
  const cambiarClave = async (e) => {
    e.preventDefault();
    if (c1.value.length < 8) return toast('Mínimo 8 caracteres.', 'error');
    if (c1.value !== c2.value) return toast('Las contraseñas no coinciden.', 'error');
    const { error } = await sb.auth.updateUser({ password: c1.value });
    if (error) return toast(mensajeError(error), 'error');
    e.target.reset();
    toast('Contraseña actualizada.');
  };

  return h('div', {},
    h('div', { class: 'encabezado' }, h('h1', {}, 'Mi firma y cuenta')),
    seccionFirma,
    h('div', { class: 'tarjeta' },
      h('h2', {}, 'Mis datos'),
      h('div', { class: 'fila' },
        dato('Legajo', p.legajo), dato('Apellido y nombre', `${p.apellido}, ${p.nombre}`), dato('Jerarquía', p.jerarquia),
        dato('Dependencia', p.dependencia), dato('Cargo', p.cargo || '—')),
      h('p', { class: 'sutil', style: 'font-size:.9rem' }, 'Si algún dato cambió (ascenso, pase de destino), pedile al administrador que lo actualice.')),
    h('form', { class: 'tarjeta', onsubmit: cambiarClave },
      h('h2', {}, 'Cambiar contraseña'),
      h('div', { class: 'fila' }, h('div', { class: 'campo' }, h('label', {}, 'Nueva contraseña'), c1), h('div', { class: 'campo' }, h('label', {}, 'Repetir'), c2)),
      h('div', { class: 'acciones fin' }, h('button', { class: 'btn sec', type: 'submit' }, 'Cambiar contraseña'))));
}

const dato = (lbl, val) => h('div', { class: 'campo' }, h('label', {}, lbl), h('div', {}, val));

// Pad de firma sobre canvas
function crearPad(canvas) {
  const ctx = canvas.getContext('2d');
  let dibujando = false, vacio = true, ultimo = null;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const preparar = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1f6b'; ctx.fillStyle = '#0b1f6b'; ctx.lineWidth = 2.6;
  };
  preparar();
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dibujando = true; vacio = false; ultimo = pos(e);
    ctx.beginPath(); ctx.arc(ultimo.x, ultimo.y, 1.3, 0, Math.PI * 2); ctx.fill();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const p = pos(e);
    const medio = { x: (ultimo.x + p.x) / 2, y: (ultimo.y + p.y) / 2 };
    ctx.beginPath(); ctx.moveTo(ultimo.x, ultimo.y); ctx.quadraticCurveTo(ultimo.x, ultimo.y, medio.x, medio.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo = p;
  });
  const fin = () => { dibujando = false; };
  canvas.addEventListener('pointerup', fin);
  canvas.addEventListener('pointercancel', fin);
  canvas.addEventListener('pointerleave', fin);

  return {
    vacio: () => vacio,
    limpiar() { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); preparar(); vacio = true; },
    // Recorta los bordes vacíos y achica la imagen para que pese poco
    exportar() {
      const { width: w, height: hgt } = canvas;
      const px = ctx.getImageData(0, 0, w, hgt).data;
      let x0 = w, y0 = hgt, x1 = 0, y1 = 0;
      for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const m = 8 * dpr;
      x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w, x1 + m); y1 = Math.min(hgt, y1 + m);
      const cw = x1 - x0, ch = y1 - y0;
      const escala = Math.min(1, 600 / cw, 200 / ch);
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(cw * escala)); out.height = Math.max(1, Math.round(ch * escala));
      out.getContext('2d').drawImage(canvas, x0, y0, cw, ch, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    },
  };
}

// ---------- Administración ----------
const ESTADOS_USR = { pendiente: 'Pendiente', activo: 'Activo', suspendido: 'Suspendido' };
const ACCIONES = {
  firma_registrada: 'Registró su firma',
  firma_actualizada: 'Cambió su firma o PIN',
  acta_enviada_a_firma: 'Envió un acta a firma',
  acta_firmada: 'Firmó un acta',
  firma_rechazada: 'Rechazó una solicitud de firma',
  acta_anulada: 'Anuló un acta',
  pin_incorrecto: 'Ingresó un PIN incorrecto',
  admin_usuario_actualizado: 'Modificó una cuenta',
  admin_firma_reseteada: 'Borró la firma de un agente',
  admin_clave_restablecida: 'Restableció una contraseña',
};
const iniciales = (u) => `${(u.apellido || '?')[0]}${(u.nombre || '')[0] || ''}`.toUpperCase();
const avatar = (u) => h('span', { class: 'avatar', 'aria-hidden': 'true' }, iniciales(u));

async function vistaAdmin() {
  if (estado.perfil.rol !== 'admin') return h('div', { class: 'aviso error' }, h('p', {}, 'Solo administradores.'));

  let filtro = 'pendiente';
  let pestana = 'personal';
  let filas = [];
  const stats = h('div', { class: 'stats' });
  const cuerpo = h('div');
  const tabla = h('div', { class: 'tabla-caja' });
  const buscar = h('input', { type: 'search', placeholder: 'Buscar apellido o legajo…', 'aria-label': 'Buscar personal por apellido, legajo o dependencia' });
  const mostrar = h('select', { 'aria-label': 'Mostrar' }, [
    ['pendiente', 'Pendientes de aprobación'], ['activo', 'Personal activo'], ['suspendido', 'Suspendidos'],
    ['admin', 'Administradores'], ['todos', 'Todo el personal'],
  ].map(([v, t]) => h('option', { value: v }, t)));

  const contar = (campos) => {
    let q = sb.from('perfiles').select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(campos)) q = q.eq(k, v);
    return q;
  };

  const pintarStats = async () => {
    const [p, a, s, ad] = await Promise.all([
      contar({ estado: 'pendiente' }), contar({ estado: 'activo' }), contar({ estado: 'suspendido' }), contar({ rol: 'admin', estado: 'activo' }),
    ]);
    const tarjeta = (num, texto, clave, tono) => h('button', {
      type: 'button', class: `stat ${tono} ${pestana === 'personal' && filtro === clave ? 'activo' : ''}`,
      onclick: () => { filtro = clave; pestana = 'personal'; render(); },
    }, h('span', { class: 'stat-num' }, num ?? 0), h('span', { class: 'stat-lbl' }, texto));
    stats.replaceChildren(
      tarjeta(p.count, 'Pendientes de aprobación', 'pendiente', 'ambar'),
      tarjeta(a.count, 'Personal activo', 'activo', 'verde'),
      tarjeta(s.count, 'Cuentas suspendidas', 'suspendido', 'rojo'),
      tarjeta(ad.count, 'Administradores', 'admin', 'azul'));
  };

  const recargar = () => { pintarStats(); cargarTabla(); actualizarInsignia(); };

  const aprobar = async (u) => {
    const ok = await confirmar('Aprobar cuenta',
      `¿Activar la cuenta de ${MAY(`${u.jerarquia} ${u.apellido}, ${u.nombre}`)} (legajo ${u.legajo}, ${MAY(u.dependencia)})? Verificá antes su identidad.`,
      { boton: 'Aprobar' });
    if (!ok) return;
    const { error } = await sb.rpc('admin_actualizar_usuario', {
      p_id: u.id, p_estado: 'activo', p_rol: u.rol, p_jerarquia: u.jerarquia, p_dependencia: u.dependencia, p_cargo: u.cargo,
    });
    if (error) return toast(mensajeError(error), 'error');
    toast(`Cuenta de ${u.apellido} aprobada.`);
    recargar();
  };

  const cargarTabla = async () => {
    tabla.replaceChildren(h('div', { class: 'vacio' }, 'Cargando…'));
    const est = ESTADOS_USR[filtro] ? filtro : null;
    const { data, error } = await sb.rpc('admin_usuarios', { p_estado: est, p_texto: buscar.value.trim() || null });
    if (error) return tabla.replaceChildren(h('div', { class: 'aviso error' }, h('p', {}, mensajeError(error))));
    filas = filtro === 'admin' ? data.filter((u) => u.rol === 'admin') : data;
    if (filas.length === 0) {
      return tabla.replaceChildren(h('div', { class: 'vacio' },
        filtro === 'pendiente' && !buscar.value.trim() ? 'No hay solicitudes de cuenta pendientes.' : 'Sin resultados.'));
    }
    tabla.replaceChildren(h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Agente', 'Legajo', 'Dependencia', 'Firma', 'Estado', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, filas.map((u) => h('tr', {},
        h('td', { 'data-label': 'Agente' }, h('div', { class: 'agente' }, avatar(u),
          h('div', {}, h('b', {}, MAY(`${u.apellido}, ${u.nombre}`)), h('small', {}, MAY(u.jerarquia))))),
        h('td', { 'data-label': 'Legajo' }, h('span', { class: 'mono' }, u.legajo), h('small', { class: 'bloque' }, `Alta ${fecha(u.creado_at).split(',')[0]}`)),
        h('td', { 'data-label': 'Dependencia' }, MAY(u.dependencia), u.cargo && h('small', { class: 'bloque' }, MAY(u.cargo))),
        h('td', { 'data-label': 'Firma' }, h('span', { class: `punto ${u.tiene_firma ? 'si' : 'no'}` }, u.tiene_firma ? 'Registrada' : 'Sin registrar')),
        h('td', { 'data-label': 'Estado' }, h('div', { class: 'chips' }, chip(u.estado, ESTADOS_USR), u.rol === 'admin' && chip('admin', { admin: 'Admin' }))),
        h('td', { class: 'acc' },
          u.estado === 'pendiente' && h('button', { class: 'btn ok chico', type: 'button', onclick: () => aprobar(u) }, 'Aprobar'),
          h('button', { class: 'btn sec chico', type: 'button', onclick: () => modalUsuario(u, recargar) }, u.estado === 'pendiente' ? 'Revisar' : 'Editar')))))));
  };

  const exportar = () => descargarCSV(`personal-${filtro}.csv`, [
    ['Legajo', 'Apellido', 'Nombre', 'Jerarquía', 'Dependencia', 'Cargo', 'Estado', 'Rol', 'Firma registrada', 'Alta'],
    ...filas.map((u) => [u.legajo, u.apellido, u.nombre, u.jerarquia, u.dependencia, u.cargo || '', ESTADOS_USR[u.estado], u.rol, u.tiene_firma ? 'Sí' : 'No', fecha(u.creado_at)]),
  ]);

  const cargarActividad = async (caja) => {
    caja.replaceChildren(h('div', { class: 'vacio' }, 'Cargando…'));
    const [ev, pers] = await Promise.all([
      sb.from('auditoria').select('id, accion, fecha, detalle, usuario_id').order('fecha', { ascending: false }).limit(150),
      sb.from('perfiles').select('id, apellido, nombre, legajo, jerarquia'),
    ]);
    if (ev.error) return caja.replaceChildren(h('div', { class: 'aviso error' }, h('p', {}, mensajeError(ev.error))));
    const mapa = new Map((pers.data || []).map((p) => [p.id, p]));
    const nombre = (id) => { const p = mapa.get(id); return p ? MAY(`${p.jerarquia} ${p.apellido}, ${p.nombre}`) : '—'; };
    const detalle = (e) => {
      const d = e.detalle || {};
      if (e.accion.startsWith('admin_')) return `Cuenta: ${nombre(d.usuario)}${d.estado ? ` · estado ${ESTADOS_USR[d.estado] || d.estado}` : ''}${d.rol ? ` · rol ${d.rol === 'admin' ? 'Administrador' : 'Agente'}` : ''}`;
      if (e.accion === 'acta_enviada_a_firma') return `${(d.firmantes || []).length} firmante(s)`;
      if (d.motivo) return `Motivo: ${d.motivo}`;
      if (e.accion === 'pin_incorrecto') return d.en === 'firma' ? 'Al intentar firmar un acta' : 'Al intentar cambiar la firma';
      return '';
    };
    if (!ev.data.length) return caja.replaceChildren(h('div', { class: 'vacio' }, 'Todavía no hay actividad registrada.'));
    caja.replaceChildren(h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Fecha y hora', 'Agente', 'Acción', 'Detalle'].map((t) => h('th', {}, t)))),
      h('tbody', {}, ev.data.map((e) => h('tr', { class: e.accion === 'pin_incorrecto' ? 'fila-alerta' : null },
        h('td', { 'data-label': 'Fecha' }, h('span', { class: 'mono' }, fecha(e.fecha))),
        h('td', { 'data-label': 'Agente' }, nombre(e.usuario_id)),
        h('td', { 'data-label': 'Acción' }, ACCIONES[e.accion] || e.accion),
        h('td', { 'data-label': 'Detalle' }, h('small', {}, detalle(e))))))));
  };

  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const render = () => {
    tabs.replaceChildren(...[['personal', 'Personal'], ['actividad', 'Registro de actividad']].map(([k, t]) =>
      h('button', { type: 'button', role: 'tab', class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; render(); } }, t)));
    if (pestana === 'personal') {
      mostrar.value = filtro;
      cuerpo.replaceChildren(h('section', { class: 'panel' },
        h('div', { class: 'panel-barra' },
          h('div', { class: 'buscador' }, buscar),
          mostrar,
          h('button', { class: 'btn sec', type: 'button', onclick: exportar }, 'Exportar CSV')),
        filtro === 'pendiente' && h('div', { class: 'nota' }, 'Antes de aprobar, verificá que legajo, apellido, nombre y jerarquía coincidan con la credencial del agente.'),
        tabla));
      cargarTabla();
    } else {
      const caja = h('div', { class: 'tabla-caja' });
      cuerpo.replaceChildren(h('section', { class: 'panel' },
        h('div', { class: 'panel-barra' }, h('div', {}, h('b', {}, 'Últimos movimientos del sistema'), h('small', { class: 'bloque sutil' }, 'Los PIN incorrectos se marcan en rojo.')),
          h('button', { class: 'btn sec', type: 'button', onclick: () => cargarActividad(caja) }, 'Actualizar')),
        caja));
      cargarActividad(caja);
    }
    pintarStats();
  };

  let espera;
  buscar.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(cargarTabla, 350); });
  mostrar.addEventListener('change', () => { filtro = mostrar.value; pintarStats(); cargarTabla(); });
  render();

  return h('div', {},
    h('div', { class: 'admin-cab' },
      h('div', {},
        h('span', { class: 'sobretitulo' }, 'Administración del sistema'),
        h('h1', {}, 'Panel de administración'),
        h('p', { class: 'sutil' }, 'Alta, verificación y control del personal habilitado para la firma electrónica.'))),
    stats, tabs, cuerpo);
}

function modalUsuario(u, recargar) {
  let m;
  const sel = (opciones, valor) => h('select', {}, opciones.map(([v, t]) => h('option', { value: v, selected: v === valor }, t)));
  const est = sel([['pendiente', 'Pendiente'], ['activo', 'Activo'], ['suspendido', 'Suspendido']], u.estado);
  const rol = sel([['agente', 'Agente'], ['admin', 'Administrador']], u.rol);
  const func = h('select', { required: true });
  const jer = h('select', { required: true });
  prepararJerarquia(func, jer, u.jerarquia);
  const dep = mayusculas(h('input', { value: MAY(u.dependencia), required: true, maxlength: '120' }));
  const car = mayusculas(h('input', { value: MAY(u.cargo), maxlength: '120' }));

  const guardar = async (e) => {
    e.preventDefault();
    if (!jer.value) return toast('Elegí funcionario y jerarquía.', 'error');
    const { error } = await sb.rpc('admin_actualizar_usuario', {
      p_id: u.id, p_estado: est.value, p_rol: rol.value, p_jerarquia: MAY(jer.value), p_dependencia: MAY(dep.value), p_cargo: MAY(car.value),
    });
    if (error) return toast(mensajeError(error), 'error');
    m.cerrar(); toast('Cuenta actualizada.'); recargar();
  };
  const resetFirma = async () => {
    if (!(await confirmar('Borrar firma', `Se borrará la firma y el PIN de ${u.apellido}. Deberá registrarla de nuevo. Las actas ya firmadas no cambian.`, { boton: 'Borrar firma', peligro: true }))) return;
    const { error } = await sb.rpc('admin_resetear_firma', { p_id: u.id });
    if (error) return toast(mensajeError(error), 'error');
    m.cerrar(); toast('Firma borrada.'); recargar();
  };
  const resetClave = async () => {
    const nueva = await pedirTexto('Contraseña provisoria', `Escribí una contraseña provisoria para ${u.apellido} (mín. 8). Entregásela en persona y pedile que la cambie.`, { boton: 'Restablecer', minimo: 8 });
    if (!nueva) return;
    const { error } = await sb.rpc('admin_restablecer_clave', { p_id: u.id, p_clave: nueva });
    if (error) return toast(mensajeError(error), 'error');
    toast('Contraseña restablecida.');
  };

  m = abrirModal(MAY(`${u.apellido}, ${u.nombre}`), h('form', { onsubmit: guardar },
    h('div', { class: 'ficha' }, avatar(u), h('div', {},
      h('b', {}, MAY(u.jerarquia)),
      h('small', { class: 'bloque' }, `Legajo ${u.legajo} · alta ${fecha(u.creado_at)}`),
      h('div', { class: 'chips' }, chip(u.estado, ESTADOS_USR), u.rol === 'admin' && chip('admin', { admin: 'Admin' }),
        h('span', { class: `punto ${u.tiene_firma ? 'si' : 'no'}` }, u.tiene_firma ? 'Firma registrada' : 'Sin firma')))),
    h('h3', { class: 'seccion' }, 'Cuenta'),
    h('div', { class: 'fila' }, h('div', { class: 'campo' }, h('label', {}, 'Estado'), est), h('div', { class: 'campo' }, h('label', {}, 'Rol'), rol)),
    h('h3', { class: 'seccion' }, 'Datos del agente'),
    h('div', { class: 'fila' }, h('div', { class: 'campo' }, h('label', {}, 'Funcionario'), func), h('div', { class: 'campo' }, h('label', {}, 'Jerarquía'), jer)),
    h('div', { class: 'campo' }, h('label', {}, 'Dependencia'), dep),
    h('div', { class: 'campo' }, h('label', {}, 'Cargo'), car),
    h('h3', { class: 'seccion' }, 'Seguridad'),
    h('div', { class: 'acciones', style: 'margin-bottom:18px' },
      h('button', { class: 'btn sec chico', type: 'button', onclick: resetClave }, 'Restablecer contraseña'),
      u.tiene_firma && h('button', { class: 'btn peligro chico', type: 'button', onclick: resetFirma }, 'Borrar firma / PIN')),
    h('div', { class: 'acciones fin pie-modal' }, h('button', { class: 'btn sec', type: 'button', onclick: () => m.cerrar() }, 'Cancelar'), h('button', { class: 'btn', type: 'submit' }, 'Guardar cambios'))), { ancho: 620 });
}

// =====================================================================
$('#btn-salir').addEventListener('click', () => salir());
iniciar();
