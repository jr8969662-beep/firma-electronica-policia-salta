import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);
const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const fmt = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Salta' });
const fecha = (iso) => (iso ? fmt.format(new Date(iso)) : '—');

function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k === 'class' ? 'class' : k, v);
  hijos.flat().forEach((c) => c != null && c !== false && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return el;
}

const ESTADOS = {
  firmada: ['ok', 'Acta auténtica y completamente firmada'],
  en_firma: ['alerta', 'Acta registrada, pero todavía faltan firmas: aún no tiene validez'],
  borrador: ['alerta', 'Borrador sin enviar: no tiene validez'],
  rechazada: ['error', 'Acta rechazada por un firmante: no tiene validez'],
  anulada: ['error', 'Acta ANULADA: no tiene validez'],
};

async function verificar(codigo) {
  const res = $('#resultado');
  res.replaceChildren(h('p', { class: 'sutil' }, 'Verificando…'));
  const { data, error } = await sb.rpc('verificar_acta', { p_codigo: codigo });
  if (error) return res.replaceChildren(h('div', { class: 'aviso error' }, h('p', {}, 'No se pudo consultar. Revisá tu conexión.')));
  if (!data?.encontrada) {
    return res.replaceChildren(h('div', { class: 'aviso error' }, h('p', {}, h('b', {}, 'No existe ningún acta con ese código. '), 'El documento podría no ser auténtico.')));
  }
  const [tipo, texto] = ESTADOS[data.estado] || ['alerta', data.estado];
  const firmasOk = data.firmas.every((f) => f.estado === 'firmada' && f.huella_coincide);
  res.replaceChildren(
    h('div', { class: `aviso ${data.estado === 'firmada' && firmasOk ? 'ok' : tipo}` }, h('p', {}, h('b', {}, texto),
      data.motivo_anulacion ? ` Motivo: ${data.motivo_anulacion}` : '')),
    h('div', { class: 'tarjeta' },
      h('h2', {}, `${data.tipo} — ${data.titulo}`),
      h('p', {}, h('b', {}, 'Código: '), data.codigo),
      h('p', {}, h('b', {}, 'Dependencia: '), data.dependencia || '—'),
      data.lugar && h('p', {}, h('b', {}, 'Lugar: '), data.lugar),
      h('p', {}, h('b', {}, 'Labrada por: '), data.autor, ` · ${fecha(data.creada_at)}`),
      h('h3', { style: 'margin-top:16px' }, 'Firmas'),
      data.firmas.length === 0 ? h('p', { class: 'sutil' }, 'Sin firmas.') :
        h('ul', { class: 'lista' }, data.firmas.map((f) => h('li', { class: 'item', style: 'cursor:default' },
          h('div', {}, h('div', { class: 'tit' }, f.firmante), f.cargo && h('div', { class: 'meta' }, f.cargo),
            f.estado === 'firmada' && h('div', { class: 'meta' }, `Firmó el ${fecha(f.fecha)}${f.huella_coincide ? ' · huella verificada ✓' : ' · ⚠ la huella no coincide'}`)),
          h('span', { class: `chip ${f.estado}` }, { firmada: 'Firmada', pendiente: 'Pendiente', rechazada: 'Rechazada' }[f.estado] || f.estado)))),
      h('p', { class: 'sutil', style: 'margin-top:14px;font-size:.85rem' },
        'Huella SHA-256 registrada: ', h('code', { style: 'overflow-wrap:anywhere' }, data.hash),
        '. Compará que coincida con la impresa al pie del acta. Por seguridad, esta página no muestra el texto del acta.')));
}

$('#form').addEventListener('submit', (e) => {
  e.preventDefault();
  const c = $('#codigo').value.trim().toUpperCase();
  history.replaceState(null, '', `?c=${encodeURIComponent(c)}`);
  verificar(c);
});

const inicial = new URLSearchParams(location.search).get('c');
if (inicial) { $('#codigo').value = inicial.toUpperCase(); verificar(inicial.toUpperCase()); }
