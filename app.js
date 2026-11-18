// =====================================================================
//  MCD · PANEL WEB (Supabase) · la pantalla
// =====================================================================
//  - Entra con correo y contraseña (Supabase Auth). Solo ve datos quien esté
//    dado de alta en la tabla "usuarios" (lo comprueba la base de datos).
//  - Lee las tablas directamente (con permisos por fila) y escribe SOLO a
//    través de las funciones panel_* del servidor, que validan y auditan.
//  - Todo texto que viene de documentos se pinta como TEXTO, nunca como HTML.
// =====================================================================
'use strict';
var CFG = window.MCD_CONFIG || {};
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
  document.getElementById('vista').textContent = 'Falta config.js con la dirección del proyecto y la clave pública.';
  throw new Error('config');
}
var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function h(etiqueta, atributos, hijos) {
  var el = document.createElement(etiqueta);
  Object.keys(atributos || {}).forEach(function (k) {
    if (k === 'class') el.className = atributos[k];
    else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), atributos[k]);
    else if (atributos[k] !== null && atributos[k] !== undefined && atributos[k] !== false) el.setAttribute(k, atributos[k]);
  });
  [].concat(hijos === undefined ? [] : hijos).forEach(function (x) {
    if (x === null || x === undefined || x === false) return;
    el.appendChild(typeof x === 'object' ? x : document.createTextNode(String(x)));
  });
  return el;
}
function euros(v) {
  if (v === '' || v === null || v === undefined || isNaN(Number(v))) return v === undefined || v === null ? '' : String(v);
  return Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function costeEuros(v) { var n = Number(v) || 0; return n.toLocaleString('es-ES', { minimumFractionDigits: n < 1 ? 4 : 2, maximumFractionDigits: n < 1 ? 4 : 2 }) + ' €'; }
function fecha(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v === null || v === undefined ? '' : String(v)); }
function vence(v) { return v === null || v === undefined || v === '' ? 'No consta' : fecha(v); }
function hora(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('es-ES'); }
function tamano(b) { b = Number(b) || 0; return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB'; }
function mesActual() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
function texto(v) { return v === undefined || v === null ? '' : String(v); }
var DIAS_AVISO_ALBARAN = 45;   // lo confirma el servidor (panel_inicio.diasAvisoAlbaran)
function diasDesde(f) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); if (!m) return null; return Math.floor((new Date() - new Date(+m[1], +m[2] - 1, +m[3])) / 864e5); }
function pillEsperaFactura(a) {
  var dias = diasDesde(a.fecha); if (dias === null) dias = a.dias_sin_factura;
  if (dias !== null && dias !== undefined && dias > DIAS_AVISO_ALBARAN) return h('span', { class: 'pill error', title: 'Lo normal es menos de ' + DIAS_AVISO_ALBARAN + ' días' }, 'Sin factura · ' + dias + ' días');
  return h('span', { class: 'pill', title: 'Es normal: la factura suele llegar después del albarán' }, 'Esperando factura' + (dias !== null && dias !== undefined ? ' · ' + dias + ' días' : ''));
}
// Gasolinera que manda la tabla de precios: solo sus repostajes se comparan. Se pone en config.js
// (GASOLINERA_TABLA_NOMBRE y GASOLINERA_TABLA_TEXTO, el mismo texto que COMBUSTIBLE_GASOLINERA_CON_TABLA).
var NOMBRE_GASOLINERA_TABLA = CFG.GASOLINERA_TABLA_NOMBRE || 'la gasolinera de la tabla';
var TEXTO_GASOLINERA_TABLA = null;
try { TEXTO_GASOLINERA_TABLA = CFG.GASOLINERA_TABLA_TEXTO ? new RegExp(CFG.GASOLINERA_TABLA_TEXTO) : null; } catch (e) { TEXTO_GASOLINERA_TABLA = null; }
function esNieves() {          // (el nombre es histórico: "¿es de la gasolinera de la tabla?")
  if (!TEXTO_GASOLINERA_TABLA) return false;
  return Array.prototype.some.call(arguments, function (x) { return TEXTO_GASOLINERA_TABLA.test(String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()); });
}
function pillEstado(t) {
  t = texto(t);
  var c = /PENDIENTE|Sin factura|Faltan|≠|ERROR/.test(t) ? 'error' : /Revisar|revisar|Duplicado|revisión|Revisión/.test(t) ? 'aviso' : /Procesado|Facturado|recibidos/.test(t) ? 'ok' : /^(Anexo|Va con)/.test(t) ? 'marca' : '';
  return t ? h('span', { class: 'pill ' + c }, t) : '';
}
function mensajeError(e) {
  var m = String(e && (e.message || e.error_description || e.msg) || e || 'Error desconocido');
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Tu correo aún no está confirmado.';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
  if (/User already registered/i.test(m)) return 'Ese correo ya tiene cuenta. Entra con tu contraseña.';
  if (/rate limit/i.test(m)) return 'Demasiados intentos seguidos. Espera unos minutos.';
  return m;
}
// Peticiones a las funciones del servidor: devuelven el dato o lanzan un error con texto claro
function rpc(fn, args) {
  if (/^panel_(guardar|descartar|juntar|soltar|rechazar|reintentar|clase)/.test(fn)) DOCUMENTOS_VISTOS = {};   // van a cambiar datos: los nombres se vuelven a pedir
  return sb.rpc(fn, args || {}).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
}
function consulta(q) { return q.then(function (r) { if (r.error) throw new Error(r.error.message); return r; }); }

// ---------------------------------------------------------------------
// NOMBRE LEGIBLE DE UN DOCUMENTO (18-nov-2026)
// "VTX-0049" no le dice nada a quien revisa. En pantalla se enseña lo que la persona reconoce
// ("Almacenes Ejemplo · albarán 12345 · 16/11 · → Zaragoza") y el ID interno al lado, en pequeño.
// El nombre NUNCA sale del panel: ni a las funciones del servidor, ni al historial, ni a nombres de archivo.
// ---------------------------------------------------------------------
// sinTipo: no dice "albarán"/"factura" (para cuando ya lo dice el título): "Almacenes Ejemplo · nº 12345 · 16/11 · → Zaragoza"
function nombreDocumento(hoja, f, sinTipo) {
  if (!f) return '';                                            // sin datos: quien llama enseña el ID, como siempre
  function corto(v, n) { v = texto(v).replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; }
  function dia(v) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(v)); return !m ? '' : m[3] + '/' + m[2] + (m[1] === String(new Date().getFullYear()) ? '' : '/' + m[1].slice(2)); }
  function hay(v) { return v !== null && v !== undefined && v !== ''; }
  var p = [];
  if (hoja === 'facturas' || hoja === 'albaranes') {
    var fac = hoja === 'facturas', tipo = texto(fac ? f.tipo_factura : f.tipo_albaran), numero = corto(fac ? f.num_factura : f.num_albaran, 20);
    p.push(corto(f.nombre, 28) || (/^Emitid/.test(tipo) ? 'Cliente sin nombre' : /^Recibid/.test(tipo) ? 'Proveedor sin nombre' : 'Sin nombre'));
    p.push(sinTipo ? (numero ? 'nº ' + numero : 'sin número') : (fac ? 'factura ' : esOrdenDeCarga(f) ? 'orden de carga ' : 'albarán ') + (numero || 'sin número'));
    p.push(dia(f.fecha) || 'sin fecha');
    if (fac) { if (hay(f.total)) p.push(euros(f.total)); }
    else if (f.destino) p.push('→ ' + corto(f.destino, 24));
    else if (f.origen) p.push('desde ' + corto(f.origen, 24));
    else if (hay(f.importe)) p.push(euros(f.importe));
  } else if (hoja === 'tickets') {
    var gas = f.categoria === 'Combustible', de = f.categoria && f.categoria !== 'Otros' ? (gas ? 'gasolina' : String(f.categoria).toLowerCase()) : '';
    p.push(corto(gas ? f.estacion || f.comercio : f.comercio, 28) || 'Comercio sin nombre');
    p.push(sinTipo ? de : 'ticket' + (de ? ' de ' + de : ''));
    p.push(dia(f.fecha) || 'sin fecha');
    if (hay(f.total)) p.push(euros(f.total));
  } else if (hoja === 'revision') {
    p.push('Sin leer');
    if (f.archivo_original) p.push(corto(f.archivo_original, 36));
    if (dia(f.fecha_alta)) p.push('llegó ' + dia(f.fecha_alta));
  }
  return p.filter(Boolean).join(' · ');
}
// Nombre + ID en pequeño, como elemento (para títulos, celdas y enlaces). Sin datos, solo el ID.
function etiquetaDocumento(hoja, f, id, sinTipo) {
  var n = nombreDocumento(hoja, f, sinTipo); id = id || (f && f.id_doc) || '';
  return h('span', { class: 'nombre-doc' }, n ? [n, id ? h('small', { class: 'id-doc' }, id) : null] : (id || '—'));
}
// "VTX-0049 (Almacenes Ejemplo · albarán 12345 · 16/11)" para preguntas y avisos, que solo admiten texto
function idConNombre(hoja, f, id) { var n = nombreDocumento(hoja, f); return n ? id + ' (' + n + ')' : id; }
function tituloFicha(titulo, hoja, f) {
  var n = nombreDocumento(hoja, f, true), id = (f && f.id_doc) || '';
  return h('span', { class: 'nombre-doc' }, [titulo + (n ? ' · ' + n : ''), id ? h('small', { class: 'id-doc' }, id) : null]);
}
// Una orden de carga se guarda con los albaranes, pero aparte (supabase/ordenes_carga.sql): no cuenta como albarán ni espera factura
function esOrdenDeCarga(f) { return !!f && f.clase === 'orden_carga'; }
function numeroId(id) { var m = /(\d+)\D*$/.exec(texto(id)); return m ? Number(m[1]) : 0; }
var COLUMNAS_NOMBRE_ALBARAN = 'id_doc,num_albaran,nombre,fecha,origen,destino,importe,tipo_albaran,estado,clase';   // lo que hace falta para nombrar un albarán
// Datos mínimos de otros documentos de los que solo se tiene el ID (el principal de un pack, lo último que ha
// llegado...). Se guardan mientras no cambie nada. Si la consulta falla, se enseña el ID y ya está.
var DOCUMENTOS_VISTOS = {};                  // id -> { hoja, fila }
function buscarDocumentos(ids, hojas) {
  var faltan = [];
  (ids || []).forEach(function (i) { i = texto(i).trim(); if (i && !DOCUMENTOS_VISTOS[i] && faltan.indexOf(i) < 0) faltan.push(i); });
  function leer(hoja, columnas, lista) {
    if (!lista.length || (hojas && hojas.indexOf(hoja) < 0)) return Promise.resolve();
    return consulta(sb.from(hoja).select(columnas).in('id_doc', lista)).then(function (r) { (r.data || []).forEach(function (f) { DOCUMENTOS_VISTOS[f.id_doc] = { hoja: hoja, fila: f }; }); });
  }
  var tck = faltan.filter(function (i) { return /^TCK-/.test(i); }), rev = faltan.filter(function (i) { return /^REV-/.test(i); });
  var resto = faltan.filter(function (i) { return tck.indexOf(i) < 0 && rev.indexOf(i) < 0; });
  return Promise.all([
    leer('tickets', 'id_doc,fecha,comercio,estacion,categoria,total', tck),
    leer('revision', 'id_doc,archivo_original,fecha_alta', rev),
    leer('facturas', 'id_doc,empresa,tipo_factura,num_factura,fecha,nombre,total', resto),
    leer('albaranes', 'id_doc,empresa,tipo_albaran,num_albaran,fecha,nombre,origen,destino,importe,estado,clase', resto)
  ]).then(function () { return DOCUMENTOS_VISTOS; }, function () { return DOCUMENTOS_VISTOS; });
}
// Supabase devuelve como máximo 1000 filas por consulta: se piden por páginas hasta tenerlas todas.
// "crear" es una función que devuelve la consulta nueva cada vez (con su order para que las páginas no se mezclen).
async function consultaTodo(crear, maximo) {
  var todas = [], desde = 0, paso = 1000; maximo = maximo || 50000;
  while (true) {
    var r = await consulta(crear().range(desde, desde + paso - 1)), d = r.data || [];
    todas = todas.concat(d);
    if (d.length < paso || todas.length >= maximo) return { data: todas, error: null };
    desde += paso;
  }
}

// ---------------------------------------------------------------------
// Estado de la pantalla
// ---------------------------------------------------------------------
var EMPRESAS = [];
var S = { vista: 'inicio', empresa: null, todasEmpresas: true, buscar: '', filtro: 'Activos', periodo: '', periodoComb: 'mes', periodoTck: '', estadoTck: '', catTck: 'comidas', gasTck: 'nieves', tablaComb: '', sentido: 'recibidos', pagina: 1, carpeta: '', mes: mesActual(), datos: null, pendientes: 0, rol: null, usuario: null, denegado: false,
  periodoHis: 'mes', tipoHis: 'cambios', usuarioHis: '', empresaHis: '' };
var VISTAS = [['inicio', 'Inicio'], ['facturas', 'Facturas'], ['albaranes', 'Albaranes'], ['revision', 'Por revisar'], ['combustible', 'Combustible'], ['tickets', 'Tickets'], ['documentos', 'Archivos'], ['negocio', 'Vencimientos']];
var temporizadorBusqueda = null, secuenciaCarga = 0;

// ---------------------------------------------------------------------
// Periodos (para filtrar listas y Excel)
// ---------------------------------------------------------------------
var PERIODOS = [['', 'Cualquier fecha'], ['mes', 'Este mes'], ['mes-1', 'Mes pasado'], ['trimestre', 'Este trimestre'], ['anio', 'Este año'], ['anio-1', 'Año pasado']];
function rangoPeriodo(p) {
  var d = new Date(), a = d.getFullYear(), m = d.getMonth();
  function iso(y, mm) { var f = new Date(Date.UTC(y, mm, 1)); return f.toISOString().slice(0, 10); }
  if (p === 'mes') return [iso(a, m), iso(a, m + 1)];
  if (p === 'mes-1') return [iso(a, m - 1), iso(a, m)];
  if (p === 'trimestre') { var t = m - m % 3; return [iso(a, t), iso(a, t + 3)]; }
  if (p === 'anio') return [iso(a, 0), iso(a + 1, 0)];
  if (p === 'anio-1') return [iso(a - 1, 0), iso(a, 0)];
  if (/^\d{4}-\d{2}$/.test(p || '')) { var y = Number(p.slice(0, 4)), n = Number(p.slice(5, 7)) - 1; return [iso(y, n), iso(y, n + 1)]; }
  return null;
}
function nombrePeriodo(p) {
  var x = PERIODOS.filter(function (o) { return o[0] === p; })[0];
  return x ? x[1] : /^\d{4}-\d{2}$/.test(p || '') ? p.slice(5, 7) + '/' + p.slice(0, 4) : 'Cualquier fecha';
}

// ---------------------------------------------------------------------
// EXCEL: solo facturas y albaranes, columnas en español y formatos útiles
// ---------------------------------------------------------------------
var EUR = 'eur', FECHA = 'fecha', PCT = 'pct';
var COLUMNAS_EXCEL = {
  facturas: [['empresa', 'Empresa'], ['tipo_factura', 'Tipo'], ['num_factura', 'Número de factura'], ['fecha', 'Fecha', FECHA], ['nif', 'NIF'],
    ['nombre', 'Cliente / proveedor'], ['concepto', 'Concepto'], ['matricula', 'Matrícula'], ['categoria_gasto', 'Categoría'],
    ['base_imponible', 'Base imponible (€)', EUR], ['iva_porcentaje', 'IVA (%)', PCT], ['cuota_iva', 'Cuota IVA (€)', EUR], ['retencion_irpf', 'Retención IRPF (€)', EUR],
    ['otros_importes', 'Otros importes (€)', EUR], ['total', 'Total (€)', EUR], ['fecha_vencimiento', 'Vencimiento', FECHA], ['estado_cobro_pago', 'Cobro / pago'],
    ['importe_cobrado_pagado', 'Cobrado / pagado (€)', EUR], ['fecha_cobro_pago', 'Fecha cobro / pago', FECHA], ['estado', 'Estado'],
    ['comprobacion_albaranes', 'Albaranes'], ['observaciones', 'Observaciones'], ['id_doc', 'ID interno']],
  albaranes: [['empresa', 'Empresa'], ['tipo_albaran', 'Tipo'], ['num_albaran', 'Número de albarán'], ['fecha', 'Fecha', FECHA], ['nif', 'NIF'], ['nombre', 'Cliente / proveedor'],
    ['matricula', 'Matrícula'], ['origen', 'Origen'], ['destino', 'Destino'], ['concepto', 'Concepto'], ['importe', 'Importe (€)', EUR],
    ['estado_factura', 'Facturación'], ['factura_vinculada', 'Factura vinculada'], ['dias_sin_factura', 'Días sin factura'], ['estado', 'Estado'],
    ['va_con', 'Va con (pack)'], ['referencias', 'Otras referencias'], ['observaciones', 'Observaciones'], ['id_doc', 'ID interno']]
};
var TITULO_EXCEL = { facturas: 'Facturas', albaranes: 'Albaranes' };
var bibliotecaExcel;

// Número seguro para Excel: acepta "10,50" y nunca escribe NaN (un NaN estropea el archivo)
function numeroExcel(v) {
  if (v === null || v === undefined || v === '') return null;
  var s = String(v).replace(/\s/g, '');
  var n = typeof v === 'number' ? v : Number(s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.') : s);
  return isFinite(n) ? n : null;
}
function prepararExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!bibliotecaExcel) bibliotecaExcel = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
    script.crossOrigin = 'anonymous';
    script.onload = function () { resolve(window.ExcelJS); };
    script.onerror = function () {
      bibliotecaExcel = null; script.remove();
      reject(new Error('No se pudo cargar el generador de Excel. Comprueba la conexión y vuelve a intentarlo.'));
    };
    document.head.appendChild(script);
  });
  return bibliotecaExcel;
}

// Emitidos (los hace la empresa del grupo) y recibidos (los hace otro y nos llegan), por separado
var SENTIDOS = [['recibidos', 'Recibidas', 'Recibidos'], ['emitidos', 'Emitidas', 'Emitidos'], ['', 'Todas', 'Todos']];
function valorSentido(tabla, sentido) {
  if (!sentido) return '';
  return tabla === 'facturas' ? (sentido === 'emitidos' ? 'Emitida' : 'Recibida') : (sentido === 'emitidos' ? 'Emitido' : 'Recibido');
}
function nombreSentido(tabla, sentido) {
  var s = SENTIDOS.filter(function (x) { return x[0] === (sentido || ''); })[0] || SENTIDOS[2];
  return tabla === 'facturas' ? s[1] : s[2];
}

// Consulta de facturas o albaranes con los mismos filtros que la pantalla.
// f = { tabla, empresa ('' = todas), sentido ('emitidos' / 'recibidos' / '' = todos), filtro, buscar, periodo }
function consultaLista(f) {
  var tabla = f.tabla, campo = tabla === 'facturas' ? 'estado' : 'estado_factura';
  var q = sb.from(tabla).select('*', { count: 'exact' });
  if (f.empresa) q = q.eq('empresa', f.empresa);
  if (f.sentido) q = q.eq(tabla === 'facturas' ? 'tipo_factura' : 'tipo_albaran', valorSentido(tabla, f.sentido));
  // Albaranes: los anexos de un pack van dentro de su principal, no como filas sueltas. Al buscar sí salen,
  // para que el número de un anexo encuentre su pack.
  var sinAnexos = tabla === 'albaranes' && !f.conAnexos && !limpiarBusqueda(f.buscar || '');
  if (f.filtro === 'Activos') q = q.not('estado', 'in', sinAnexos ? '("Descartado","Duplicado","Anexo")' : '("Descartado","Duplicado")');
  else if (f.filtro === 'Descartado' || f.filtro === 'Duplicado' || f.filtro === 'Anexo') q = q.eq('estado', f.filtro);
  else if (f.filtro === 'Orden') q = q.eq('clase', 'orden_carga').not('estado', 'in', '("Descartado","Duplicado")');
  else if (f.filtro) q = q.eq(campo, f.filtro);
  // Las órdenes de carga no son albaranes: en la lista normal no salen (tienen su filtro). Al buscar sí, para encontrarlas por su número.
  if (tabla === 'albaranes' && f.filtro === 'Activos' && !limpiarBusqueda(f.buscar || '')) q = q.or('clase.is.null,clase.neq.orden_carga');
  var rango = rangoPeriodo(f.periodo);
  if (rango) q = q.gte('fecha', rango[0]).lt('fecha', rango[1]);
  var b = limpiarBusqueda(f.buscar || '');
  if (b) {
    var cols = tabla === 'facturas' ? ['id_doc', 'num_factura', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'albaranes']
                                    : ['id_doc', 'num_albaran', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'num_factura', 'origen', 'destino', 'referencias'];
    q = q.or(cols.map(function (c) { return c + '.ilike.%' + b + '%'; }).join(','));
  }
  return q.order('fecha', { ascending: false, nullsFirst: false }).order('empresa').order('id_doc', { ascending: false });
}
function filtrosPantalla() {
  return { tabla: S.vista, empresa: S.todasEmpresas ? '' : S.empresa, sentido: S.sentido, filtro: S.filtro, buscar: S.buscar, periodo: S.periodo };
}

async function leerTodo(f, progreso) {
  var desde = 0, total, filas = [], vistos = new Set();
  do {
    var r = await consulta(consultaLista(f).range(desde, desde + 499));
    if (total === undefined) total = r.count || 0;
    if (r.count !== total) throw new Error('Los datos han cambiado durante la descarga. Vuelve a intentarlo.');
    r.data.forEach(function (x) {
      var id = x.empresa + '|' + x.id_doc;
      if (!vistos.has(id)) { vistos.add(id); filas.push(x); }
    });
    desde += r.data.length;
    if (progreso) progreso(filas.length, total);
    if (!r.data.length) break;
  } while (desde < total);
  if (f.tabla === 'albaranes' && f.filtro === 'Activos') filas = await conAnexosDebajo(filas);
  return filas;
}
// PACKS: anexos de los albaranes dados, agrupados por su principal ({ 'empresa|id': [anexos] })
async function anexosDe(filas) {
  var ids = filas.filter(function (x) { return x.estado !== 'Anexo'; }).map(function (x) { return x.id_doc; }), mapa = {};
  for (var i = 0; i < ids.length; i += 150) {
    var r = await consulta(sb.from('albaranes').select('*').eq('estado', 'Anexo').in('va_con', ids.slice(i, i + 150)).order('id_doc'));
    (r.data || []).forEach(function (a) { var k = a.empresa + '|' + a.va_con; (mapa[k] = mapa[k] || []).push(a); });
  }
  return mapa;
}
// Para el Excel: cada pack junto, con sus anexos justo debajo del albarán principal
async function conAnexosDebajo(filas) {
  var mapa = await anexosDe(filas), ya = new Set(filas.map(function (x) { return x.empresa + '|' + x.id_doc; })), salida = [];
  filas.forEach(function (x) {
    salida.push(x);
    (mapa[x.empresa + '|' + x.id_doc] || []).forEach(function (a) { if (!ya.has(a.empresa + '|' + a.id_doc)) salida.push(a); });
  });
  return salida;
}

function hojaExcel(libro, tabla, filas) {
  var cols = COLUMNAS_EXCEL[tabla], hoja = libro.addWorksheet(TITULO_EXCEL[tabla], { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = cols.map(function (c) {
    var ancho = c[2] === EUR ? 16 : c[2] === FECHA ? 13 : c[2] === PCT ? 9 : /nombre|concepto|observaciones/.test(c[0]) ? 38 : Math.max(12, c[1].length + 2);
    return { header: c[1], key: c[0], width: ancho, style: c[2] === EUR ? { numFmt: '#,##0.00 "€"' } : c[2] === FECHA ? { numFmt: 'dd/mm/yyyy' } : {} };
  });
  filas.forEach(function (x) {
    var fila = {};
    cols.forEach(function (c) {
      var v = x[c[0]];
      if (c[0] === 'fecha_vencimiento' && (v === null || v === undefined || v === '')) v = 'No consta';
      else if (c[2] === FECHA && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) v = new Date(v.slice(0, 10) + 'T00:00:00Z');
      else if ((c[2] === EUR || c[2] === PCT) && v !== null && v !== undefined && v !== '') v = numeroExcel(v);
      else if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) v = "'" + v;            // evita fórmulas inyectadas desde un documento
      fila[c[0]] = v === undefined ? null : v;
    });
    hoja.addRow(fila);
  });
  var cab = hoja.getRow(1);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cab.height = 22; cab.alignment = { vertical: 'middle' };
  cab.eachCell(function (celda) { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; });
  if (filas.length) {
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    var totales = {}, ultima = filas.length + 1;
    var anexosEnLaHoja = tabla === 'albaranes' ? filas.filter(function (x) { return x.estado === 'Anexo'; }).length : 0;   // no cuentan como albaranes
    totales[cols[0][0]] = 'TOTAL (' + (filas.length - anexosEnLaHoja) + ')' + (anexosEnLaHoja ? ' + ' + anexosEnLaHoja + ' anexos' : '');
    cols.forEach(function (c, i) {
      if (c[2] === EUR) {
        var letra = hoja.getColumn(i + 1).letter;
        totales[c[0]] = { formula: 'SUBTOTAL(9,' + letra + '2:' + letra + ultima + ')' };
      }
    });
    var filaTotal = hoja.addRow(totales);
    filaTotal.font = { bold: true };
    filaTotal.eachCell(function (celda) { celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F0FF' } }; });
  }
  return hoja;
}

function hojaResumen(libro, facturas, albaranes, descripcion) {
  var hoja = libro.addWorksheet('Resumen');
  hoja.columns = [{ width: 18 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  hoja.addRow(['MCD · Resumen para la gestoría']).font = { bold: true, size: 14 };
  hoja.addRow([descripcion]).font = { color: { argb: 'FF5B6475' } };
  hoja.addRow(['Sin facturas descartadas ni duplicadas. Generado el ' + new Date().toLocaleString('es-ES')]).font = { color: { argb: 'FF5B6475' } };
  hoja.addRow([]);
  var cab = hoja.addRow(['Empresa', 'Emitidas', 'Base emitidas (€)', 'IVA repercutido (€)', 'Total emitidas (€)', 'Recibidas', 'Base recibidas (€)', 'IVA soportado (€)', 'Total recibidas (€)', 'Albaranes sin factura']);
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; c.alignment = { wrapText: true, vertical: 'middle' }; });
  cab.height = 32;
  var empresas = EMPRESAS.filter(function (e) { return facturas.some(function (f) { return f.empresa === e; }) || albaranes.some(function (a) { return a.empresa === e; }); });
  var primera = hoja.rowCount + 1;
  empresas.forEach(function (e) {
    function suma(tipo, campo) { return facturas.filter(function (f) { return f.empresa === e && f.tipo_factura === tipo; }).reduce(function (t, f) { return Math.round((t + (Number(f[campo]) || 0)) * 100) / 100; }, 0); }
    function cuenta(tipo) { return facturas.filter(function (f) { return f.empresa === e && f.tipo_factura === tipo; }).length; }
    hoja.addRow([e, cuenta('Emitida'), suma('Emitida', 'base_imponible'), suma('Emitida', 'cuota_iva'), suma('Emitida', 'total'),
      cuenta('Recibida'), suma('Recibida', 'base_imponible'), suma('Recibida', 'cuota_iva'), suma('Recibida', 'total'),
      albaranes.filter(function (a) { return a.empresa === e && a.estado_factura === 'PENDIENTE DE FACTURA'; }).length]);
  });
  var ultima = hoja.rowCount;
  if (empresas.length > 1) {
    var t = ['TOTAL'];
    'BCDEFGHIJ'.split('').forEach(function (l) { t.push({ formula: 'SUM(' + l + primera + ':' + l + ultima + ')' }); });
    hoja.addRow(t).font = { bold: true };
  }
  for (var r = primera; r <= hoja.rowCount; r++) [3, 4, 5, 7, 8, 9].forEach(function (c) { hoja.getRow(r).getCell(c).numFmt = '#,##0.00 "€"'; });
  if (!empresas.length) hoja.addRow(['No hay facturas ni albaranes en este periodo.']);
  return hoja;
}

function guardarLibro(libro, nombre) {
  return libro.xlsx.writeBuffer().then(function (buffer) {
    var url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var enlace = h('a', { href: url, download: nombre.replace(/[<>:"/\\|?*\s]+/g, '_') + '.xlsx' });
    document.body.appendChild(enlace); enlace.click(); enlace.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  });
}

// Botón "Descargar Excel" de las listas: descarga TODO lo que coincide con los filtros (todas las páginas).
function botonExcelLista(d) {
  var estado = h('span', { class: 'estado-excel', role: 'status' });
  var boton = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    var f = d.filtros; boton.disabled = true; estado.textContent = 'Preparando…';
    try {
      var excel = await prepararExcel(), filas = await leerTodo(f, function (n, t) { estado.textContent = n + ' de ' + t + '…'; });
      var libro = new excel.Workbook(); libro.creator = 'MCD'; hojaExcel(libro, f.tabla, filas);
      await guardarLibro(libro, ['MCD', TITULO_EXCEL[f.tabla] + (f.sentido ? ' ' + nombreSentido(f.tabla, f.sentido).toLowerCase() : ''), f.empresa || 'todas', f.periodo ? nombrePeriodo(f.periodo) : '', new Date().toISOString().slice(0, 10)].filter(Boolean).join('_'));
      estado.textContent = filas.length + ' filas descargadas';
    } catch (e) { estado.textContent = 'No se ha descargado: ' + mensajeError(e); }
    finally { boton.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);
  boton.title = 'Descarga en Excel todo lo que coincide con los filtros (no solo esta página)';
  return h('div', { class: 'descarga-directa' }, [boton, estado]);
}

// Tarjeta de Inicio: Excel para la gestoría en dos clics (empresa + periodo).
function tarjetaExcelGestoria() {
  var empresa = h('select', { 'aria-label': 'Empresa del Excel' }, [h('option', { value: '' }, 'Todas las empresas')].concat(EMPRESAS.map(function (e) { return h('option', { value: e }, e); })));
  var periodo = h('select', { 'aria-label': 'Periodo del Excel' }, PERIODOS.map(function (p) { return h('option', { value: p[0] }, p[1]); }).concat([h('option', { value: 'elegir' }, 'Elegir un mes…')]));
  periodo.value = 'mes';
  var mes = h('input', { type: 'month', 'aria-label': 'Mes del Excel', hidden: 'hidden' }); mes.value = mesActual();
  periodo.addEventListener('change', function () { mes.hidden = periodo.value !== 'elegir'; });
  var estado = h('span', { class: 'estado-excel', role: 'status' });
  var boton = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    var p = periodo.value === 'elegir' ? mes.value : periodo.value, e = empresa.value;
    boton.disabled = true; estado.textContent = 'Preparando…';
    try {
      var excel = await prepararExcel(), base = { empresa: e, filtro: 'Activos', buscar: '', periodo: p };
      var facturas = await leerTodo(Object.assign({ tabla: 'facturas' }, base), function (n, t) { estado.textContent = 'Facturas ' + n + ' de ' + t + '…'; });
      var albaranes = await leerTodo(Object.assign({ tabla: 'albaranes' }, base), function (n, t) { estado.textContent = 'Albaranes ' + n + ' de ' + t + '…'; });
      var libro = new excel.Workbook(); libro.creator = 'MCD';
      hojaResumen(libro, facturas, albaranes, (e || 'Todas las empresas') + ' · ' + nombrePeriodo(p));
      hojaExcel(libro, 'facturas', facturas); hojaExcel(libro, 'albaranes', albaranes);
      await guardarLibro(libro, ['MCD', e || 'todas', nombrePeriodo(p), new Date().toISOString().slice(0, 10)].join('_'));
      estado.textContent = 'Descargado: ' + facturas.length + ' facturas y ' + albaranes.filter(function (a) { return a.estado !== 'Anexo'; }).length + ' albaranes';
    } catch (err) { estado.textContent = 'No se ha descargado: ' + mensajeError(err); }
    finally { boton.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);
  return h('section', { class: 'bloque tarjeta-excel', 'aria-label': 'Excel para la gestoría' }, [
    h('h2', {}, 'Excel para la gestoría'), h('p', { class: 'sub hueco-abajo' }, 'Resumen por empresa, facturas y albaranes del periodo, en un solo archivo.'),
    h('div', { class: 'excel-campos' }, [h('label', {}, ['Empresa', empresa]), h('label', {}, ['Periodo', periodo, mes]), boton]), estado]);
}

function iconoPanel(vista) {
  var trazos = {
    inicio:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    facturas:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
    albaranes:'M2 6h12v10H2z M14 10h4l4 4v2h-8 M8 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
    revision:'M12 3 2 20h20z M12 9v5 M12 17h.01',
    documentos:'M3 6h7l2 2h9v12H3z', negocio:'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V5',
    combustible:'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16 M3 21h12 M7 8h4 M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3',
    tickets:'M6 2h12v20l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 22z M9 7h6 M9 11h6 M9 15h4',
    historial:'M12 21a9 9 0 1 0 0-18 9 9 0 1 0 0 18 M12 7v5l3 2',
    camara:'M3 8h4l2-3h6l2 3h4v11H3z M12 17a4 4 0 1 0 0-8 4 4 0 1 0 0 8',
    excel:'M4 3h11l5 5v13H4z M14 3v6h6 M8 12l5 6 M13 12l-5 6', mas:'M4 6h16 M4 12h16 M4 18h16', subir:'M12 16V4 M7 9l5-5 5 5 M4 15v5h16v-5', usuarios:'M8 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 7a3 3 0 0 1 0 6 M17 16a5 5 0 0 1 5 5'
  };
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('class','icono-panel');
  path.setAttribute('d', trazos[vista]); svg.appendChild(path); return svg;
}

// Las secciones que puede ver quien ha entrado
function seccionesDelMenu() {
  var secciones = VISTAS.slice();
  if (S.rol === 'Administrador') secciones.push(['usuarios', 'Usuarios'], ['historial', 'Historial']);
  return secciones;
}
// "Más" (móvil y ventanas estrechas): una hoja que sube desde la barra de abajo con el resto de secciones, con el
// mismo aspecto que el panel. Antes era el desplegable del sistema, que cada teléfono pinta a su manera (18-nov-2026).
var EN_LA_BARRA = ['inicio', 'revision'];
var AYUDA_SECCION = { facturas: 'Emitidas y recibidas', albaranes: 'Y sus packs', combustible: 'Precios y repostajes', tickets: 'Comidas, peajes, gasolina',
  documentos: 'Los archivos guardados', negocio: 'Cobros y pagos', usuarios: 'Quién puede entrar', historial: 'Quién hizo qué' };
function cerrarHojaMas(devolverFoco) {
  var hoja = document.getElementById('hojaMas'); if (!hoja) return;
  hoja.remove();
  var boton = document.querySelector('#menu .nav-mas');
  if (boton) { boton.setAttribute('aria-expanded', 'false'); if (devolverFoco) boton.focus(); }
}
function abrirHojaMas() {
  if (document.getElementById('hojaMas')) { cerrarHojaMas(true); return; }             // pulsar "Más" otra vez la cierra
  var opciones = seccionesDelMenu().filter(function (v) { return EN_LA_BARRA.indexOf(v[0]) < 0; }).map(function (v) {
    return h('button', { type: 'button', role: 'menuitem', class: 'hoja-opcion' + (S.vista === v[0] ? ' activo' : ''), 'aria-current': S.vista === v[0] ? 'page' : null,
      onclick: function () { cerrarHojaMas(false); irA(v[0]); } },
      [iconoPanel(v[0]), h('span', { class: 'hoja-texto' }, [h('b', {}, v[1]), AYUDA_SECCION[v[0]] ? h('small', {}, AYUDA_SECCION[v[0]]) : null])]);
  });
  var cerrar = h('button', { type: 'button', class: 'hoja-cerrar', 'aria-label': 'Cerrar el menú', onclick: function () { cerrarHojaMas(true); } }, 'Cerrar');
  var caja = h('div', { class: 'hoja-caja', role: 'menu', 'aria-label': 'Más secciones' }, [
    h('div', { class: 'hoja-cab' }, [h('b', {}, 'Ir a…'), cerrar]), h('div', { class: 'hoja-opciones' }, opciones)]);
  var hoja = h('div', { id: 'hojaMas', class: 'hoja-mas', onclick: function (e) { if (e.target === hoja) cerrarHojaMas(false); } }, caja);
  // Teclado: Escape cierra; el tabulador da la vuelta dentro de la hoja; las flechas pasan de una opción a otra
  hoja.addEventListener('keydown', function (e) {
    var todos = opciones.concat([cerrar]), i = todos.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarHojaMas(true); }
    else if (e.key === 'Tab') { e.preventDefault(); todos[(i + (e.shiftKey ? todos.length - 1 : 1)) % todos.length].focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); opciones[(Math.max(-1, opciones.indexOf(document.activeElement)) + 1) % opciones.length].focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); opciones[(opciones.indexOf(document.activeElement) + opciones.length - 1) % opciones.length].focus(); }
  });
  document.body.appendChild(hoja);
  var boton = document.querySelector('#menu .nav-mas'); if (boton) boton.setAttribute('aria-expanded', 'true');
  (hoja.querySelector('.hoja-opcion.activo') || opciones[0] || cerrar).focus();
}
function pintarMenu() {
  var nav = document.getElementById('menu'); nav.textContent = '';
  if (!S.rol) { cerrarHojaMas(false); return; }
  var secciones = seccionesDelMenu();
  if (puedeSubir()) nav.appendChild(h('button', { type: 'button', class: 'nav-subir', title: 'Facturas, albaranes, tickets o tablas de precios',
    onclick: function () { cerrarHojaMas(false); var e = document.getElementById('subidaGlobal'); if (e) e.click(); } }, [iconoPanel('subir'), h('span', {}, ['Subir', h('span', { class: 'solo-escritorio' }, ' documentos')])]));
  // En el móvil solo caben Inicio, Por revisar, Subir y "Más", que abre la hoja con las demás secciones
  var otra = EN_LA_BARRA.indexOf(S.vista) < 0, actual = secciones.filter(function (v) { return v[0] === S.vista; })[0];
  var abierta = !!document.getElementById('hojaMas');
  nav.appendChild(h('button', { type: 'button', class: 'nav-mas' + (otra ? ' activo' : ''), 'aria-haspopup': 'menu', 'aria-expanded': String(abierta), 'aria-controls': 'hojaMas',
    title: 'Ver el resto de secciones', onclick: abrirHojaMas }, [iconoPanel('mas'), h('span', {}, otra && actual ? actual[1] : 'Más')]));
  secciones.forEach(function (v) {
    nav.appendChild(h('button', { class: 'nav-' + v[0] + (S.vista === v[0] ? ' activo' : ''), 'aria-current': S.vista === v[0] ? 'page' : null, onclick: function () { irA(v[0]); } },
      [iconoPanel(v[0]), v[1], v[0] === 'revision' && S.pendientes ? h('span', { class: 'num' }, S.pendientes) : null]));
  });
}
function irA(vista) {
  if (!S.rol || S.denegado || vista === S.vista) return;
  clearTimeout(temporizadorBusqueda);
  S.vista = vista; S.buscar = ''; S.filtro = ['facturas', 'albaranes'].indexOf(vista) >= 0 ? 'Activos' : ''; S.pagina = 1; pintarMenu(); cargar(true);
  window.scrollTo(0, 0);
}
function pintarCabecera(ini) {
  var u = ini.usuario || {}, s = ini.servicio || {};
  EMPRESAS = ini.empresas.map(function (e) { return e.nombre; });
  if (EMPRESAS.indexOf(S.empresa) < 0) S.empresa = EMPRESAS[0] || null;
  S.rol = u.rol; S.usuario = u;
  var cont = document.getElementById('usuario'); cont.textContent = '';
  cont.appendChild(h('span', { class: 'nombre-usuario' }, u.nombre || u.email || ''));
  cont.appendChild(h('span', { class: 'pill marca' }, u.rol || ''));
  cont.appendChild(h('button', { class: 'boton', onclick: salir }, 'Salir'));
  var p = document.getElementById('estadoServicio'); p.hidden = false;
  var vivo = s.conocido && (Date.now() - new Date(s.latido).getTime()) < 3 * 60 * 1000;
  p.className = 'pill ' + (vivo ? 'ok' : s.conocido ? 'error' : '');
  p.textContent = vivo ? 'Servicio en marcha' : s.conocido ? 'Servicio parado' : 'Servicio: sin datos';
  document.getElementById('pie').hidden = false;
}

// ---------------------------------------------------------------------
// Entrada (correo y contraseña)
// ---------------------------------------------------------------------
function pantallaAcceso(modo, aviso) {
  modo = modo || 'entrar';
  var vista = document.getElementById('vista'); vista.textContent = '';
  document.getElementById('menu').textContent = ''; document.getElementById('usuario').textContent = '';
  document.getElementById('estadoServicio').hidden = true; document.getElementById('pie').hidden = true;
  var email = h('input', { type: 'email', autocomplete: 'username', required: 'required', placeholder: 'nombre@empresa.com' });
  var clave = h('input', { type: 'password', autocomplete: modo === 'nueva' ? 'new-password' : 'current-password', minlength: '8', placeholder: 'Mínimo 8 caracteres' });
  var mensaje = h('div', { class: 'mensaje' + (aviso ? ' ' + aviso.tipo : '') }, aviso ? aviso.texto : '');
  var titulos = { entrar: 'Entrar', olvido: 'Recuperar contraseña', nueva: 'Guardar contraseña' };
  var ayuda = { entrar: 'Facturas, albaranes y tickets del grupo, en un solo sitio. Entra con tu correo; si aún no tienes acceso, pídeselo al administrador.',
    olvido: 'Te enviaremos un correo con un enlace para poner una contraseña nueva.',
    nueva: 'Elige la contraseña con la que entrarás al panel (mínimo 8 caracteres).' };
  var boton = h('button', { class: 'boton principal', type: 'submit' }, titulos[modo]);
  var form = h('form', { class: 'formulario', onsubmit: function (e) {
    e.preventDefault(); boton.disabled = true; mensaje.className = 'mensaje'; mensaje.textContent = 'Un momento…';
    var correo = email.value.trim().toLowerCase(), p;
    if (modo === 'entrar') p = sb.auth.signInWithPassword({ email: correo, password: clave.value });
    else if (modo === 'olvido') p = sb.auth.resetPasswordForEmail(correo, { redirectTo: location.origin + location.pathname });
    else p = sb.auth.updateUser({ password: clave.value });
    p.then(function (r) {
      if (r.error) throw r.error;
      if (modo === 'olvido') { pantallaAcceso('entrar', { tipo: 'ok', texto: 'Si el correo existe, recibirás un enlace para cambiar la contraseña.' }); return; }
      if (modo === 'nueva') { history.replaceState(null, '', location.pathname); arrancar(); return; }
      arrancar();
    }).catch(function (err) {
      boton.disabled = false; mensaje.className = 'mensaje error'; mensaje.textContent = mensajeError(err);
      if (modo === 'entrar' && /Invalid login credentials/i.test(String(err && err.message || ''))) sb.rpc('panel_registrar_fallo', { p_email: correo }).then(null, function () {});
    });
  } }, [
    h('label', {}, ['Correo electrónico', email]),
    modo === 'olvido' ? null : h('label', {}, [modo === 'nueva' ? 'Contraseña nueva' : 'Contraseña', clave]),
    boton
  ]);
  if (modo === 'nueva') {
    email.disabled = true; email.required = false; clave.required = true;
    sb.auth.getUser().then(function (r) { if (r.data && r.data.user) email.value = r.data.user.email || ''; });
  }
  var enlaces = h('div', { class: 'enlaces' });
  if (modo === 'olvido') enlaces.appendChild(h('button', { type: 'button', onclick: function () { pantallaAcceso('entrar'); } }, 'Volver a entrar'));
  if (modo === 'entrar') enlaces.appendChild(h('button', { type: 'button', onclick: function () { pantallaAcceso('olvido'); } }, 'He olvidado la contraseña'));
  vista.appendChild(h('div', { class: 'tarjeta acceso' }, [h('img', { class: 'logo-acceso', src: 'logo.svg', alt: 'MCD' }), h('h2', {}, 'Gestión documental'), h('p', { class: 'sub' }, ayuda[modo]), form, mensaje, enlaces]));
  (modo === 'nueva' ? clave : email).focus();
}
function salir() { sb.auth.signOut().then(function () { ++secuenciaCarga; S.rol = null; S.datos = null; S.denegado = false; pantallaAcceso('entrar'); }); }

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------
function cargar(mostrarCargando, conservarBarra) {
  if (S.denegado || !S.rol && S.vista !== 'inicio') return;
  var solicitud = { numero: ++secuenciaCarga, vista: S.vista, empresa: S.empresa, todasEmpresas: !!S.todasEmpresas, sentido: S.sentido, carpeta: S.carpeta, mes: S.mes, pagina: S.pagina, buscar: S.buscar, filtro: S.filtro, periodo: S.periodo, periodoComb: S.periodoComb, periodoTck: S.periodoTck, estadoTck: S.estadoTck,
    periodoHis: S.periodoHis, tipoHis: S.tipoHis, usuarioHis: S.usuarioHis, empresaHis: S.empresaHis };
  var vista = document.getElementById('vista');
  if (mostrarCargando) {
    var destino = conservarBarra && document.getElementById('cuerpo') || vista;
    destino.textContent = ''; destino.appendChild(h('div', { class: 'cargando', role: 'status' }, 'Cargando…'));
  }
  var promesa;
  if (solicitud.vista === 'inicio') promesa = rpc('panel_inicio');
  else if (solicitud.vista === 'facturas' || solicitud.vista === 'albaranes') promesa = cargarTabla(solicitud);
  else if (solicitud.vista === 'revision') promesa = rpc('panel_revision');
  else if (solicitud.vista === 'combustible') promesa = cargarCombustible(solicitud);
  else if (solicitud.vista === 'tickets') promesa = cargarTickets(solicitud);
  else if (solicitud.vista === 'usuarios') promesa = consulta(sb.from('usuarios').select('*').order('email')).then(function (r) { return r.data; });
  else if (solicitud.vista === 'historial') promesa = cargarHistorial(solicitud);
  else if (solicitud.vista === 'negocio') promesa = rpc('panel_negocio', { p_empresa: solicitud.empresa, p_mes: solicitud.mes });
  else promesa = cargarCarpeta(solicitud.carpeta);
  promesa.then(function (d) {
    if (solicitud.numero !== secuenciaCarga) return;
    if (!mostrarCargando && ocupadoConExcel()) return;
    var tablaAnterior = !mostrarCargando && vista.querySelector('.tabla');
    var desplazamiento = tablaAnterior && [tablaAnterior.scrollLeft, tablaAnterior.scrollTop];
    S.datos = d;
    if (solicitud.vista === 'inicio') { if (d.diasAvisoAlbaran) DIAS_AVISO_ALBARAN = d.diasAvisoAlbaran; MINIATURAS = !!(d.servicio && d.servicio.miniaturas); pintarCabecera(d); S.pendientes = contarPendientes(d); pintarMenu(); }
    if (solicitud.vista === 'revision') { S.pendientes = contarDocumentosRevision(d); pintarMenu(); }
    pintar();
    var tablaActual = desplazamiento && vista.querySelector('.tabla');
    if (tablaActual) { tablaActual.scrollLeft = desplazamiento[0]; tablaActual.scrollTop = desplazamiento[1]; }
    document.getElementById('actualizado').textContent = solicitud.vista === 'inicio' && d.hora ? 'Datos de Inicio a las ' + hora(d.hora) : 'Consulta recibida a las ' + new Date().toLocaleTimeString('es-ES');
  }).catch(function (e) {
    if (solicitud.numero !== secuenciaCarga) return;
    mostrarError(e);
  });
}
function limpiarBusqueda(q) { return q.replace(/[,()"'\\%*]/g, ' ').trim().slice(0, 100); }
function cargarTabla(s) {
  var desde = (s.pagina - 1) * 50;
  var f = { tabla: s.vista, empresa: s.todasEmpresas ? '' : s.empresa, sentido: s.sentido, filtro: s.filtro, buscar: s.buscar, periodo: s.periodo };
  function cuenta(sentido) {               // cuántos hay de cada lado con los demás filtros iguales
    return consulta(consultaLista(Object.assign({}, f, { sentido: sentido })).range(0, 0)).then(function (r) { return r.count || 0; });
  }
  return Promise.all([consulta(consultaLista(f).range(desde, desde + 49)), cuenta('recibidos'), cuenta('emitidos'), cuenta('')]).then(function (rs) {
    var r = rs[0];
    var d = { filtros: f, paginada: true, pagina: s.pagina, tamano: 50, total: r.count || 0, filas: r.data || [],
      cuentas: { recibidos: rs[1], emitidos: rs[2], '': rs[3] }, anexos: {} };
    if (s.vista !== 'albaranes') return d;
    return anexosDe(d.filas).then(function (m) { d.anexos = m; return d; }, function () { return d; });   // si falla, la lista sale igual
  });
}
function contarPendientes(ini) { return ini.empresas.reduce(function (t, e) { return t + Number(e.documentosConAvisos || 0); }, 0) + Number(ini.enRevisionManual || 0) + Number(ini.ticketsRevisar || 0); }
function contarDocumentosRevision(lista) { var v = new Set(); lista.forEach(function (x) { v.add(x.empresa + '|' + x.hoja + '|' + x.id); }); return v.size; }
function mostrarError(e) {
  var msg = mensajeError(e);
  var vista = document.getElementById('vista'); vista.textContent = '';
  if (msg.indexOf('ACCESO_DENEGADO') >= 0) {
    S.denegado = true; document.getElementById('menu').textContent = ''; document.getElementById('estadoServicio').hidden = true; document.getElementById('pie').hidden = true;
    sb.auth.getUser().then(function (r) {
      var correo = r.data && r.data.user ? r.data.user.email : '';
      vista.appendChild(h('div', { class: 'tarjeta aviso-total' }, [h('h3', {}, 'No tienes acceso a este panel'),
        h('p', {}, ['Has entrado como ', h('b', {}, correo), '. Pide al administrador que dé de alta ese correo en Usuarios.']),
        h('button', { class: 'boton', onclick: salir }, 'Salir')]));
    });
  } else if (/JWT|token|session|Auth session missing/i.test(msg)) {
    pantallaAcceso('entrar', { tipo: 'error', texto: 'Tu sesión ha caducado. Vuelve a entrar.' });
  } else {
    vista.appendChild(h('div', { class: 'tarjeta aviso-total' }, [h('h3', {}, 'No se han podido cargar los datos'), h('p', {}, msg),
      h('button', { class: 'boton', onclick: function () { cargar(true); } }, 'Reintentar')]));
  }
}
function pintar() {
  var busqueda = document.activeElement && document.activeElement.id === 'busquedaTabla' ? document.activeElement : null;
  var cursor = busqueda ? busqueda.selectionStart : null;
  var vista = document.getElementById('vista'); vista.textContent = '';
  var titulos = { inicio: 'Hola' + (S.usuario && S.usuario.nombre ? ', ' + S.usuario.nombre.split(' ')[0] : ''), facturas: 'Facturas', albaranes: 'Albaranes',
    revision: 'Por revisar', combustible: 'Combustible', tickets: 'Tickets', documentos: 'Archivos', negocio: 'Vencimientos y costes', usuarios: 'Usuarios del panel', historial: 'Historial de cambios' };
  var ayudas = { inicio: 'Esto es lo que hay hoy en el sistema.', facturas: 'Recibidas: las de proveedores. Emitidas: las que hacéis a vuestros clientes. Pulsa una para verla o corregirla.',
    albaranes: 'Recibidos: los de proveedores. Emitidos: los que hacéis vosotros. Pulsa uno para verlo.', revision: 'Lo que el programa no ha podido dar por bueno. Ábrelo, corrige lo que haga falta y márcalo como revisado.',
    combustible: 'Cada repostaje de las facturas de gasolinera comparado con el precio de ese día en la tabla que llega por correo.',
    tickets: 'Comidas, peajes, gasolina y otros gastos, por año y mes. Sube la foto y se lee sola. La gasolina de ' + NOMBRE_GASOLINERA_TABLA + ' y la de otras gasolineras van por separado.',
    documentos: 'Los originales y las copias tachadas que se enviaron a la IA.', negocio: 'Pagos y cobros vencidos, coste por camión y movimientos del mes.',
    usuarios: 'Quién puede entrar al panel. El acceso es solo por invitación.',
    historial: 'Quién ha cambiado qué y cuándo: lo que hacen las personas en el panel y lo que hace el programa solo. Nadie puede borrarlo ni modificarlo; se guarda 2 años (protección de datos).' };
  if (S.vista !== 'inicio') vista.appendChild(h('div', { class: 'cab-vista' }, [h('div', {}, [h('h1', {}, titulos[S.vista]), h('p', { class: 'sub' }, ayudas[S.vista])])]));
  ({ inicio: vInicio, facturas: vFacturas, albaranes: vAlbaranes, revision: vRevision, combustible: vCombustible, tickets: vTickets, documentos: vDocumentos, usuarios: vUsuarios, negocio: vNegocio, historial: vHistorial })[S.vista](vista, S.datos);
  if (busqueda && document.getElementById('busquedaTabla')) { var n = document.getElementById('busquedaTabla'); n.focus(); n.setSelectionRange(cursor, cursor); }
}

// ---------------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------------
function vInicio(v, d) {
  var s = d.servicio || {};
  function sumar(campo) { return d.empresas.reduce(function (n, e) { return n + Number(e[campo] || 0); }, 0); }
  function cuantos(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }
  // 1) Lo único importante al entrar: lo que hay por revisar
  var pendientes = contarPendientes(d), conAvisos = sumar('documentosConAvisos'), manual = Number(d.enRevisionManual || 0), tickets = Number(d.ticketsRevisar || 0);
  var partes = [];
  if (conAvisos) partes.push(cuantos(conAvisos, 'factura o albarán con algún aviso', 'facturas o albaranes con algún aviso'));
  if (manual) partes.push(cuantos(manual, 'documento que no se pudo leer solo', 'documentos que no se pudieron leer solos'));
  if (tickets) partes.push(cuantos(tickets, 'ticket', 'tickets'));
  var lead = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] + '.' : partes.length ? partes[0] + '.' : '';
  var hoy = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  v.appendChild(h('section', { class: 'foco', 'aria-labelledby': 'tituloInicio' }, [
    h('div', {}, [
      h('p', { class: 'dia' }, hoy),
      h('h1', { id: 'tituloInicio' }, pendientes ? 'Hay ' + cuantos(pendientes, 'documento', 'documentos') + ' por revisar' : 'Todo revisado'),
      h('p', { class: 'lead' }, pendientes ? lead : 'No hay nada pendiente. Lo que llegue por correo o subáis aquí se lee solo.'),
      pendientes ? h('div', { class: 'acciones' }, [h('button', { type: 'button', class: 'boton principal', onclick: function () { irA('revision'); } }, 'Empezar a revisar')]) : null]),
    h('div', { class: 'senal' + (pendientes ? '' : ' al-dia'), 'aria-hidden': 'true' }, [h('b', {}, String(pendientes)), h('span', {}, pendientes ? 'Por revisar' : 'Al día')])]));

  // 2) Subir documentos
  if (puedeSubir()) v.appendChild(tarjetaSubir());

  // 3) Las cifras en una línea (Facturas y Albaranes se pueden pulsar)
  function cifra(clave, nombre, valor, ayuda) {
    var hijos = [h('span', { class: 'metrica-texto' }, [h('span', { class: 'metrica-nombre' }, nombre), h('strong', {}, String(valor)), h('span', { class: 'metrica-ayuda' }, ayuda)])];
    return clave ? h('button', { type: 'button', class: 'metrica', onclick: function () { S.todasEmpresas = true; irA(clave); } }, hijos)
      : h('div', { class: 'metrica', style: 'cursor:default' }, hijos);
  }
  v.appendChild(h('div', { class: 'metricas', role: 'group', 'aria-label': 'Resumen' }, [
    cifra('facturas', 'Facturas', sumar('facturas'), sumar('recibidas') + ' recibidas · ' + sumar('emitidas') + ' emitidas'),
    cifra('albaranes', 'Albaranes', sumar('albaranes'), sumar('pendientes') + ' esperando factura' + (sumar('tardanFactura') ? ' · ' + sumar('tardanFactura') + ' con retraso' : '')),
    cifra(null, 'Coste de la IA', costeEuros(d.costeMes), 'este mes')]));

  var columnas = h('div', { class: 'inicio-columnas' });
  var izquierda = h('div', { class: 'columna' }), derecha = h('div', { class: 'columna' });
  columnas.appendChild(izquierda); columnas.appendChild(derecha); v.appendChild(columnas);

  // 4a) Empresas: lo esencial a la vista
  izquierda.appendChild(h('section', { class: 'bloque' }, [h('h2', {}, 'Empresas'), h('div', { class: 'lista-empresas' }, d.empresas.map(function (e) {
    return h('div', { class: 'empresa-fila' }, [
      h('div', { class: 'empresa-nombre' }, [h('b', {}, e.nombre), e.cif ? h('span', { class: 'sub' }, 'CIF ' + e.cif) : null]),
      h('div', { class: 'empresa-datos' }, [
        h('button', { type: 'button', class: 'dato', onclick: function () { S.empresa = e.nombre; S.todasEmpresas = false; irA('facturas'); } }, [h('b', {}, String(e.facturas || 0)), ' facturas']),
        h('button', { type: 'button', class: 'dato', onclick: function () { S.empresa = e.nombre; S.todasEmpresas = false; irA('albaranes'); } }, [h('b', {}, String(e.albaranes || 0)), ' albaranes']),
        Number(e.documentosConAvisos) ? h('button', { type: 'button', class: 'dato aviso', onclick: function () { irA('revision'); } }, [h('b', {}, String(e.documentosConAvisos)), ' por revisar']) : null])]);
  }))]));
  izquierda.appendChild(tarjetaExcelGestoria());

  // 4b) Lo último que ha llegado
  // Primero el nombre del archivo; en cuanto se sabe qué es, lo que se reconoce ("Almacenes Ejemplo · albarán 12345 · 16/11"). El ID, en pequeño.
  var listaUltimos = h('ul', { class: 'ultimos' }, d.ultimos.map(function (x) {
    var visto = DOCUMENTOS_VISTOS[x.id];
    return h('li', { 'data-id': x.id }, [h('button', { type: 'button', class: 'ultimo-nombre', title: 'Abrir este documento', onclick: function () { abrirDocumento(x.id); } }, [
      cajaMiniatura(/^REV-/.test(x.id) ? 'revision' : 'documentos', x.id),
      h('span', { class: 'ultimo-archivo' + (visto ? ' con-nombre' : '') }, visto ? nombreDocumento(visto.hoja, visto.fila) : x.archivo || ''), h('small', { class: 'id-doc' }, x.id)]),
      h('span', { class: 'ultimo-empresa' }, x.empresa), pillEstado(x.estado), h('span', { class: 'ultimo-fecha' }, fecha(x.fecha))]);
  }));
  buscarDocumentos(d.ultimos.map(function (x) { return x.id; })).then(function (vistos) {
    [].forEach.call(listaUltimos.children, function (li) {
      var v = vistos[li.getAttribute('data-id')], hueco = li.querySelector('.ultimo-archivo');
      if (v && hueco) { hueco.textContent = nombreDocumento(v.hoja, v.fila); hueco.classList.add('con-nombre'); }
    });
  });
  derecha.appendChild(h('section', { class: 'bloque' }, [h('h2', {}, 'Lo último que ha llegado'), d.ultimos.length ? listaUltimos : h('p', { class: 'vacio' }, 'Aún no ha llegado ningún documento.')]));
  ponerMiniaturas(listaUltimos);

  // 5) Estado del servicio en una línea
  var vivo = s.conocido && (Date.now() - new Date(s.latido).getTime()) < 3 * 60 * 1000;
  v.appendChild(h('p', { class: 'linea-servicio' }, s.conocido ? [
    h('span', { class: 'punto ' + (vivo ? 'ok' : 'error') }), vivo ? 'Servicio en marcha' : 'Servicio parado (¿está encendido el ordenador?)',
    ' · última señal ' + hora(s.latido), ' · Gmail ' + (s.gmail_conectado ? 'conectado' : 'desconectado'),
    s.ultima_vuelta ? ' · última vuelta ' + hora(s.ultima_vuelta.hora) : ''
  ] : 'El servicio aún no ha enviado su estado.'));
  if (S.rol === 'Administrador') lineaCopias(v);
}

// Copias de seguridad (solo administrador): la del día en este ordenador y la de Google Drive
function fechaLocalIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function lineaCopias(v) {
  var linea = h('p', { class: 'linea-servicio linea-copias', role: 'status' }, 'Comprobando las copias de seguridad…'); v.appendChild(linea);
  consulta(sb.from('estado_servicio').select('latido,datos').eq('clave', 'copias').maybeSingle()).then(function (r) {
    var e = r.data && r.data.datos || null; linea.textContent = '';
    // Vale la de hoy; hasta las 10:00 también la de ayer (el ordenador puede encenderse tarde)
    var hoy = fechaLocalIso(new Date()), ayer = fechaLocalIso(new Date(Date.now() - 864e5)), temprano = new Date().getHours() < 10;
    function reciente(f) { return !!f && (f >= hoy || (temprano && f >= ayer)); }
    if (!e) {
      linea.appendChild(h('span', { class: 'punto' }));
      linea.appendChild(document.createTextNode('Copias de seguridad: aún sin datos (se hacen cada día a partir de las 2:00).'));
      return;
    }
    var okL = reciente(e.ultima_local), okE = reciente(e.ultima_externa), estado = okL && okE ? 'ok' : okL ? 'aviso' : 'error';
    linea.className = 'linea-servicio linea-copias ' + estado;
    linea.appendChild(h('span', { class: 'punto ' + estado }));
    linea.appendChild(document.createTextNode('Copia de seguridad · en este ordenador: ' + (e.ultima_local ? fecha(e.ultima_local) : 'ninguna') + (okL ? ' ✔' : ' ✖') +
      ' · en ' + (e.externa || 'Google Drive') + ': ' + (e.ultima_externa ? fecha(e.ultima_externa) : 'ninguna') + (okE ? ' ✔' : ' ✖')));
    if (e.error && !(okL && okE)) linea.appendChild(h('span', { class: 'detalle-copias' }, e.error));
  }).catch(function () { linea.textContent = 'No se ha podido comprobar el estado de las copias de seguridad.'; });
}

// Documentos subidos en esta sesión y lo que ha pasado con cada uno (sobrevive al refresco automático de Inicio)
var SUBIDAS = [];
function huellaArchivo(f) {
  return f.arrayBuffer().then(function (datos) { return crypto.subtle.digest('SHA-256', datos); }).then(function (h) {
    return Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}
// ¿Ya hay un documento registrado con esa huella? Devuelve dónde está (o null)
async function buscarRegistro(huella) {
  var d = await consulta(sb.from('documentos').select('id_doc,empresa,estado,observaciones').eq('hash_sha256', huella).limit(1));
  if (d.data && d.data[0]) {
    var x = d.data[0];
    if (x.estado === 'Duplicado') {
      // Otro archivo del mismo documento: no se añadió. Se enlaza al que ya estaba (si se sabe cuál es).
      var m = /como ([A-Z]+-\d+)/.exec(x.observaciones || ''), original = m ? m[1] : '';
      var rep = { repetido: true, hoja: null, titulo: 'Documento', empresa: x.empresa, id: original || x.id_doc, estado: 'Duplicado', original: original };
      if (original) {
        var fo = await consulta(sb.from('facturas').select('id_doc').eq('empresa', x.empresa).eq('id_doc', original).limit(1));
        if (fo.data && fo.data[0]) { rep.hoja = 'facturas'; rep.titulo = 'Factura'; }
        else { var ao = await consulta(sb.from('albaranes').select('id_doc').eq('empresa', x.empresa).eq('id_doc', original).limit(1));
          if (ao.data && ao.data[0]) { rep.hoja = 'albaranes'; rep.titulo = 'Albarán'; } }
      }
      return rep;
    }
    var f = await consulta(sb.from('facturas').select('id_doc,estado,tipo_factura,num_factura,nombre,fecha,total').eq('empresa', x.empresa).eq('id_doc', x.id_doc).limit(1));
    if (f.data && f.data[0]) return { hoja: 'facturas', titulo: 'Factura', empresa: x.empresa, id: x.id_doc, estado: f.data[0].estado, fila: f.data[0] };
    var a = await consulta(sb.from('albaranes').select('id_doc,estado,tipo_albaran,num_albaran,nombre,fecha,origen,destino,importe').eq('empresa', x.empresa).eq('id_doc', x.id_doc).limit(1));
    if (a.data && a.data[0]) return { hoja: 'albaranes', titulo: 'Albarán', empresa: x.empresa, id: x.id_doc, estado: a.data[0].estado, fila: a.data[0] };
    return { hoja: null, titulo: 'Documento', empresa: x.empresa, id: x.id_doc, estado: '' };
  }
  var t = await consulta(sb.from('tickets').select('*').eq('hash_sha256', huella).limit(1));
  if (t.data && t.data[0]) return { hoja: 'tickets', titulo: 'Ticket', empresa: '', id: t.data[0].id_doc, estado: t.data[0].estado, ticket: t.data[0] };
  var r = await consulta(sb.from('revision').select('id_doc,motivo').eq('hash_sha256', huella).limit(1));
  if (r.data && r.data[0]) return { hoja: 'revision', titulo: 'Revisión manual', empresa: '_revision', id: r.data[0].id_doc, estado: 'Revisión manual', motivo: r.data[0].motivo };
  return null;
}
function pintarSubidas() {
  var ul = document.getElementById('listaSubidas'); if (!ul) return;
  ul.textContent = ''; ul.hidden = !SUBIDAS.length;
  SUBIDAS.slice(-8).reverse().forEach(function (s) {
    var abrir = s.registro && s.registro.hoja ? h('button', { type: 'button', class: 'boton enlace', onclick: function () {
      if (s.registro.hoja === 'tickets') fichaTicket(s.registro.ticket);
      else abrirFichaPorId(s.registro.titulo, s.registro.empresa, s.registro.hoja, s.registro.id); } }, 'Abrir') : null;
    ul.appendChild(h('li', { class: 'subida ' + (s.clase || '') }, [h('span', { class: 'punto ' + (s.clase === 'exito' ? 'ok' : s.clase === 'fallo' ? 'error' : 'espera') }),
      h('span', { class: 'subida-nombre' }, s.nombre), abrir, h('span', { class: 'subida-estado' }, s.texto)]));
  });
}
// breve: solo "Factura VTX-0050 de Vertex" (para el aviso de abajo)
function textoRegistro(x, breve) {
  if (breve && !x.repetido && x.hoja !== 'revision') return x.titulo + ' ' + x.id + (x.empresa && x.empresa !== '_revision' ? ' de ' + x.empresa : '');
  if (x.hoja === 'revision') return 'necesita revisión manual (' + (x.motivo || 'no se pudo leer') + ')';
  if (x.repetido) return 'REPETIDO: este documento ya estaba registrado' + (x.original ? ' como ' + x.original + ' de ' + x.empresa : ' en ' + x.empresa) + '. No se ha añadido otra vez.';
  if (x.hoja === 'tickets') {
    var rep = /Posible repetido de (TCK-\d+)/.exec(x.ticket.observaciones || '');
    return 'Ticket ' + x.id + ' · ' + x.ticket.categoria + (x.ticket.total !== null && x.ticket.total !== undefined ? ' · ' + euros(x.ticket.total) : '') +
      (rep ? ' · ¿REPETIDO? Se parece a ' + rep[1] + ': revísalo' : x.estado === 'Revisar' ? ' · revisar' : '');
  }
  var nombre = x.fila ? nombreDocumento(x.hoja, x.fila, true) : '';          // "Almacenes Ejemplo · nº 12345 · 16/11 · → Zaragoza"
  return x.titulo + ' ' + x.id + (nombre ? ' (' + nombre + ')' : '') + (x.empresa && x.empresa !== '_revision' ? ' de ' + x.empresa : '') + (x.estado ? ' · ' + x.estado : '');
}
async function seguirSubida(s) {
  var inicio = Date.now();
  while (Date.now() - inicio < 5 * 60 * 1000) {
    await new Promise(function (r) { setTimeout(r, 5000); });
    try {
      var x = await buscarRegistro(s.huella);
      if (x) {
        s.registro = x; s.clase = x.hoja === 'revision' || x.estado === 'Revisar' || x.repetido ? 'aviso' : 'exito';
        s.texto = x.repetido ? textoRegistro(x) : 'Registrado: ' + textoRegistro(x); pintarSubidas();
        if (x.repetido || /Posible repetido/.test((x.ticket && x.ticket.observaciones) || '')) avisoBreve('Ojo: ' + s.nombre + ' parece repetido');
        if (S.vista === 'inicio' || S.vista === 'revision' || (S.vista === 'tickets' && x.hoja === 'tickets')) cargar(false);
        if (/^tachado_/.test(s.nombre) && x.hoja && x.hoja !== 'revision') avisoBreve(s.nombre.replace(/^tachado_|\.pdf$/g, '') + ' ya está leído: ' + textoRegistro(x, true) + '. Pulsa "Abrir" para revisar sus datos.');
        return;
      }
      var segundos = Math.round((Date.now() - inicio) / 1000);
      s.texto = segundos < 20 ? 'Subido. Esperando a que el servicio lo recoja…' : 'Leyendo el documento… (' + segundos + ' s)'; pintarSubidas();
    } catch (e) { /* se reintenta en la siguiente vuelta */ }
  }
  s.clase = 'aviso'; s.texto = 'Sigue en cola. Aparecerá cuando el servicio lo lea (¿está encendido el ordenador del servicio?)'; pintarSubidas();
}

// UNA SOLA SUBIDA para todo: facturas, albaranes, tickets y tablas de precios. El servicio decide qué es cada cosa.
var TIPOS_SUBIDA = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.txt,.xml,.xsig,.zip';
function puedeSubir() { return S.rol === 'Revisor' || S.rol === 'Administrador'; }
async function subirArchivos(ficheros) {
    for (var f of ficheros) {
      var nombre = f.name.replace(/[\\/:*?"<>|#%]/g, '_').replace(/^\.+/, '') || 'foto.jpg';
      var s = { nombre: f.name, texto: 'Comprobando…', clase: '' }; SUBIDAS.push(s); pintarSubidas();
      if (f.size > 15 * 1024 * 1024) { s.clase = 'fallo'; s.texto = 'No se sube: pesa más de 15 MB'; pintarSubidas(); continue; }
      if (!/\.(pdf|jpe?g|png|webp|gif|bmp|tiff?|heic|heif|docx?|odt|rtf|xlsx?|ods|csv|txt|xml|xsig|zip)$/i.test(nombre)) { s.clase = 'fallo'; s.texto = 'No se sube: tipo de archivo no admitido'; pintarSubidas(); continue; }
      try {
        s.huella = await huellaArchivo(f);
        var ya = await buscarRegistro(s.huella);
        if (ya) { s.registro = ya; s.clase = 'aviso'; s.texto = ya.repetido ? 'REPETIDO: ya se subió antes y ya estaba registrado' + (ya.original ? ' como ' + ya.original + ' de ' + ya.empresa : '') + '. No se vuelve a subir.'
          : 'REPETIDO: ya estaba registrado: ' + textoRegistro(ya) + '. No se vuelve a subir.'; pintarSubidas(); avisoBreve('Ojo: ' + s.nombre + ' ya estaba subido'); continue; }
        s.texto = 'Subiendo…'; pintarSubidas();
        var r = await sb.storage.from('entrada').upload(Date.now() + '_' + nombre, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (r.error) throw r.error;
        if (/\.zip$/i.test(nombre)) { s.clase = 'exito'; s.texto = 'ZIP enviado: sus documentos aparecerán en Últimos documentos en un par de minutos.'; pintarSubidas(); continue; }
        s.texto = 'Subido. Esperando a que el servicio lo recoja…'; pintarSubidas();
        seguirSubida(s);
      } catch (e) { s.clase = 'fallo'; s.texto = 'No se ha subido: ' + mensajeError(e); pintarSubidas(); }
    }
}
// Subir desde cualquier sección: botón "Subir" del menú y arrastrar archivos encima de la página
function prepararSubidaGlobal() {
  var entrada = h('input', { type: 'file', multiple: 'multiple', class: 'oculto', id: 'subidaGlobal', accept: TIPOS_SUBIDA });
  document.body.appendChild(entrada);
  entrada.addEventListener('change', function () { if (entrada.files.length) { var fs = Array.from(entrada.files); entrada.value = ''; verSubidas(fs); } });
  var capa = h('div', { class: 'capa-soltar', hidden: 'hidden' }, [h('div', {}, [iconoPanel('subir'), h('b', {}, 'Suelta aquí los documentos'),
    h('span', {}, 'Facturas, albaranes, tickets o tablas de precios: se separan solos')])]);
  document.body.appendChild(capa);
  var contador = 0;
  function conArchivos(e) { return puedeSubir() && e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0; }
  document.addEventListener('dragenter', function (e) { if (!conArchivos(e)) return; e.preventDefault(); contador++; capa.hidden = false; });
  document.addEventListener('dragover', function (e) { if (!conArchivos(e)) return; e.preventDefault(); });
  document.addEventListener('dragleave', function (e) { if (!conArchivos(e)) return; contador = Math.max(0, contador - 1); if (!contador) capa.hidden = true; });
  document.addEventListener('drop', function (e) {
    if (!conArchivos(e)) return; e.preventDefault(); contador = 0; capa.hidden = true;
    if (e.dataTransfer.files.length) verSubidas(Array.from(e.dataTransfer.files));
  });
}
// Sube y lleva a una pantalla donde se ve cómo va cada documento (Inicio o Tickets)
function verSubidas(ficheros) {
  subirArchivos(ficheros);
  if (S.vista !== 'inicio' && S.vista !== 'tickets') irA('inicio');
  else setTimeout(pintarSubidas, 0);
}

function tarjetaSubir() {
  var archivo = h('input', { type: 'file', multiple: 'multiple', class: 'oculto', id: 'archivoSubir', accept: TIPOS_SUBIDA });
  var camara = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'oculto', id: 'camaraSubir' });
  var estado = h('span', { class: 'mensaje-ficha', role: 'status' });
  var lista = h('ul', { class: 'lista-subidas', id: 'listaSubidas', 'aria-live': 'polite', hidden: 'hidden' });
  var botones = h('div', { class: 'tickets-subir' }, [
    h('label', { class: 'boton-grande principal', for: 'camaraSubir' }, [iconoPanel('camara'), h('b', {}, 'Hacer foto')]),
    h('label', { class: 'boton-grande', for: 'archivoSubir' }, [iconoPanel('subir'), h('b', {}, 'Elegir archivos')])]);
  [archivo, camara].forEach(function (inp) { inp.addEventListener('change', function () { if (inp.files.length) { var fs = Array.from(inp.files); inp.value = ''; subirArchivos(fs); } }); });
  var procesar = h('button', { type: 'button', class: 'boton', onclick: function () {
    rpc('panel_procesar_ahora').then(function (r) { estado.className = 'mensaje-ficha exito'; estado.textContent = r && r.repetida ? 'Ya había una orden pendiente; el servicio la atenderá.' : 'Orden enviada: el servicio revisará el correo ahora.'; })
      .catch(function (e) { estado.className = 'mensaje-ficha fallo'; estado.textContent = mensajeError(e); });
  } }, 'Revisar el correo ahora');
  var tarjeta = h('section', { class: 'banda-subir', 'aria-labelledby': 'tituloSubir' }, [
    h('div', { class: 'fila-subir' }, [h('div', {}, [h('h2', { id: 'tituloSubir' }, 'Subir documentos'),
      h('p', { class: 'sub' }, 'Facturas, albaranes, tickets o tablas de precios. Arrástralos a la página o elige cómo; cada uno va solo a su sección.')]), botones]),
    archivo, camara, lista,
    h('div', { class: 'pie-subir' }, [h('span', {}, 'PDF, fotos, Word, Excel, XML o ZIP, hasta 15 MB. Fotos de frente, con luz y el papel entero.'), procesar, estado])]);
  setTimeout(pintarSubidas, 0);
  return tarjeta;
}

// ---------------------------------------------------------------------
// FACTURAS y ALBARANES: una sola barra con todo a la vista
// ---------------------------------------------------------------------
function barraFiltros(v, d, opcionesEstado) {
  var empresas = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Empresa' }, [null].concat(EMPRESAS).map(function (e) {
    var activo = e === null ? S.todasEmpresas : !S.todasEmpresas && S.empresa === e;
    return h('button', { type: 'button', class: activo ? 'activo' : '', 'aria-pressed': activo ? 'true' : 'false', onclick: function () {
      if (activo) return;
      clearTimeout(temporizadorBusqueda); S.todasEmpresas = e === null; if (e !== null) S.empresa = e; S.pagina = 1; cargar(true);
    } }, e || 'Todas');
  }));
  var buscar = h('input', { id: 'busquedaTabla', type: 'search', maxlength: '100', 'aria-label': 'Buscar', placeholder: 'Buscar número, nombre, NIF, matrícula…' });
  buscar.value = S.buscar;
  buscar.addEventListener('input', function () { S.buscar = buscar.value; S.pagina = 1; ++secuenciaCarga; clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(function () { cargar(true, true); }, 350); });
  var estado = h('select', { 'aria-label': 'Estado' }, opcionesEstado.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
  estado.value = S.filtro;
  estado.addEventListener('change', function () { clearTimeout(temporizadorBusqueda); S.filtro = estado.value; S.pagina = 1; cargar(true, true); });
  var periodo = h('select', { 'aria-label': 'Fecha' }, PERIODOS.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
  periodo.value = S.periodo;
  periodo.addEventListener('change', function () { clearTimeout(temporizadorBusqueda); S.periodo = periodo.value; S.pagina = 1; cargar(true, true); });
  var limpiar = h('button', { type: 'button', class: 'boton enlace', hidden: !(S.buscar || S.periodo || S.filtro !== 'Activos') ? 'hidden' : null, onclick: function () {
    S.buscar = ''; S.periodo = ''; S.filtro = 'Activos'; S.pagina = 1; cargar(true);
  } }, 'Quitar filtros');
  var tablaVista = S.vista, cuentas = d.cuentas || {};
  var sentidos = h('div', { class: 'segmentos sentidos', role: 'group', 'aria-label': 'Emitidas o recibidas' }, SENTIDOS.map(function (o) {
    var activo = (S.sentido || '') === o[0];
    return h('button', { type: 'button', class: activo ? 'activo' : '', 'aria-pressed': activo ? 'true' : 'false', onclick: function () {
      if (activo) return;
      clearTimeout(temporizadorBusqueda); S.sentido = o[0]; S.pagina = 1; cargar(true, true);
    } }, nombreSentido(tablaVista, o[0]) + (cuentas[o[0]] === undefined ? '' : ' (' + cuentas[o[0]] + ')'));
  }));
  v.appendChild(h('div', { class: 'herramientas' }, [
    h('div', { class: 'fila-herramientas' }, [sentidos]),
    h('div', { class: 'fila-herramientas' }, [empresas, botonExcelLista(d)]),
    h('div', { class: 'fila-herramientas' }, [buscar, h('label', { class: 'campo-corto' }, ['Estado', estado]), h('label', { class: 'campo-corto' }, ['Fecha', periodo]), limpiar,
      h('span', { class: 'contador', id: 'contador' })])]));
  var sinTipo = (cuentas[''] || 0) - (cuentas.recibidos || 0) - (cuentas.emitidos || 0);
  if (sinTipo > 0) v.appendChild(h('p', { class: 'sub' }, sinTipo + (tablaVista === 'facturas' ? ' factura(s)' : ' albarán(es)') +
    (tablaVista === 'facturas' ? ' sin indicar si son emitidas o recibidas' : ' sin indicar si son emitidos o recibidos') + ': solo salen en "' + nombreSentido(tablaVista, '') + '".'));
  v.appendChild(h('div', { id: 'cuerpo' }));
}
function paginacion(c, d) {
  if (d.total <= d.tamano) return;
  var anterior = h('button', { class: 'boton', onclick: function () { S.pagina = d.pagina - 1; cargar(true, true); window.scrollTo(0, 0); } }, '← Anterior');
  var siguiente = h('button', { class: 'boton', onclick: function () { S.pagina = d.pagina + 1; cargar(true, true); window.scrollTo(0, 0); } }, 'Siguiente →');
  anterior.disabled = d.pagina <= 1; siguiente.disabled = d.pagina * d.tamano >= d.total;
  c.appendChild(h('div', { class: 'paginacion' }, [anterior, h('span', {}, 'Página ' + d.pagina + ' de ' + Math.ceil(d.total / d.tamano)), siguiente]));
}
function contadorTabla(d, tipo) { return !d.total ? '0 ' + tipo : d.total <= d.tamano ? d.total + ' ' + tipo : ((d.pagina - 1) * d.tamano + 1) + '–' + Math.min(d.pagina * d.tamano, d.total) + ' de ' + d.total + ' ' + tipo; }
function vFacturas(v, d) {
  barraFiltros(v, d, [['Activos', 'Todas las válidas'], ['Revisar', 'A revisar'], ['Procesado', 'Procesadas'], ['Descartado', 'Descartadas'], ['Duplicado', 'Duplicadas'], ['', 'Todo el historial']]);
  document.getElementById('contador').textContent = contadorTabla(d, S.sentido ? 'facturas ' + nombreSentido('facturas', S.sentido).toLowerCase() : 'facturas');
  var c = document.getElementById('cuerpo'), conTipo = !S.sentido;
  var quien = S.sentido === 'emitidos' ? 'Cliente' : S.sentido === 'recibidos' ? 'Proveedor' : 'Cliente / proveedor';
  tabla(c, ['Nº factura', 'Fecha', { t: quien, largo: 1 }, 'Empresa'].concat(conTipo ? ['Tipo'] : [], [{ t: 'Total', num: 1 }, 'Vence', 'Estado']), d.filas.map(function (f) {
    return { mini: { hoja: 'facturas', id: f.id_doc }, abrir: function () { ficha('Factura', f, { empresa: f.empresa, hoja: 'facturas' }); },
      celdas: [numeroOSinNumero(f.num_factura, f.id_doc), fecha(f.fecha), f.nombre, f.empresa].concat(conTipo ? [f.tipo_factura || 'Sin indicar'] : [],
        [{ t: euros(f.total), num: 1 }, vence(f.fecha_vencimiento), pillEstado(f.estado)]) };
  }), 'Factura');
  paginacion(c, d);
}
// Número del albarán y, si es el principal de un pack, cuántos papeles lleva dentro ("+ 3 papeles")
// Sin número ya no se enseña el ID a secas: "sin número" y el ID en pequeño
function numeroOSinNumero(numero, id) {
  return numero ? numero : h('span', { class: 'nombre-doc' }, ['sin número', h('small', { class: 'id-doc' }, id)]);
}
function numeroConPack(f, anexos) {
  var numero = numeroOSinNumero(f.num_albaran, f.id_doc);
  if (esOrdenDeCarga(f)) return h('span', { class: 'numero-pack' }, [numero, ' ', h('span', { class: 'pill', title: 'No es un albarán: no espera factura' }, 'Orden de carga')]);
  if (!anexos || !anexos.length) return numero;
  return h('span', { class: 'numero-pack' }, [numero, ' ', h('span', { class: 'pill marca', title: 'Papeles que van con este albarán: ' + anexos.map(function (a) { return a.num_albaran || a.id_doc; }).join(', ') },
    '+ ' + anexos.length + (anexos.length === 1 ? ' papel' : ' papeles'))]);
}
function vAlbaranes(v, d) {
  barraFiltros(v, d, [['Activos', 'Todos los válidos'], ['PENDIENTE DE FACTURA', 'Esperando factura'], ['Facturado', 'Facturados'], ['Anexo', 'Anexos de un pack'], ['Orden', 'Órdenes de carga'], ['Descartado', 'Descartados'], ['Duplicado', 'Duplicados'], ['', 'Todo el historial']]);
  document.getElementById('contador').textContent = contadorTabla(d, S.sentido ? 'albaranes ' + nombreSentido('albaranes', S.sentido).toLowerCase() : 'albaranes');
  var c = document.getElementById('cuerpo'), conTipo = !S.sentido;
  var quien = S.sentido === 'emitidos' ? 'Cliente' : S.sentido === 'recibidos' ? 'Proveedor' : 'Cliente / proveedor';
  // Un anexo dice con quién va por su número ("Va con nº 67890"), no por el ID del principal
  var vanCon = [];
  function pillVaCon(f) {
    if (!f.va_con || !/^Va con /.test(texto(f.estado_factura))) return pillEstado(f.estado_factura);
    var pill = pildoraEnlace('marca', f.estado_factura, 'Abrir el albarán con el que va', function () { abrirDocumento(f.va_con, 'albaranes', f.empresa); });
    vanCon.push([pill, f.va_con]);
    return pill;
  }
  // La factura vinculada: se abre al pulsar su número
  function pillFactura(f) {
    return h('span', {}, numerosCitados(f.factura_vinculada).map(function (numero) {
      return pildoraEnlace('ok', numero, 'Abrir la factura ' + numero, function () {
        facturaPorNumero(numero, f.nif, f.empresa).then(function (fac) {
          if (fac) abrirDocumento(fac.id_doc, 'facturas', fac.empresa); else avisoBreve('No se encuentra la factura ' + numero);
        }).catch(function (e) { avisoBreve(mensajeError(e)); });
      });
    }));
  }
  tabla(c, ['Nº albarán', 'Fecha', { t: quien, largo: 1 }, 'Empresa'].concat(conTipo ? ['Tipo'] : [], ['Ruta', { t: 'Importe', num: 1 }, 'Factura']), d.filas.map(function (f) {
    return { mini: { hoja: 'albaranes', id: f.id_doc }, abrir: function () { ficha('Albarán', f, { empresa: f.empresa, hoja: 'albaranes' }); },
      celdas: [numeroConPack(f, (d.anexos || {})[f.empresa + '|' + f.id_doc]), fecha(f.fecha), f.nombre, f.empresa].concat(conTipo ? [f.tipo_albaran || 'Sin indicar'] : [],
        [[f.origen, f.destino].filter(Boolean).join(' → '), { t: euros(f.importe), num: 1 },
        f.factura_vinculada ? pillFactura(f) : f.estado_factura === 'PENDIENTE DE FACTURA' ? pillEsperaFactura(f) : pillVaCon(f)]) };
  }), 'Albarán');
  if (vanCon.length) buscarDocumentos(vanCon.map(function (x) { return x[1]; }), ['albaranes']).then(function (vistos) {
    vanCon.forEach(function (x) {
      var p = vistos[x[1]]; if (!p) return;
      x[0].textContent = 'Va con ' + (p.fila.num_albaran ? 'nº ' + p.fila.num_albaran : 'otro albarán');
      x[0].title = 'Abrir: ' + nombreDocumento('albaranes', p.fila) + ' (' + x[1] + ')';
    });
  });
  paginacion(c, d);
}

// ---------------------------------------------------------------------
// COMBUSTIBLE: precio del día frente a lo que cobra la gasolinera
// ---------------------------------------------------------------------
function cargarCombustible(s) {
  var rango = rangoPeriodo(s.periodoComb);
  function q() {
    var x = sb.from('repostajes').select('*').order('fecha', { ascending: false, nullsFirst: false }).order('id_doc').order('id');
    if (!s.todasEmpresas) x = x.eq('empresa', s.empresa);
    if (rango) x = x.gte('fecha', rango[0]).lt('fecha', rango[1]);
    return x;
  }
  // Precios: los del periodo y, de las tablas "hasta nuevo aviso", también las anteriores que siguen vigentes
  function qp() {
    var x = sb.from('precios_combustible').select('fecha,combustible,precio_litro,precio_con_iva,iva_incluido,proveedor,estacion,poblacion,provincia,empresa,hasta_nuevo_aviso')
      .order('fecha', { ascending: false }).order('estacion').order('id');
    return rango ? x.lt('fecha', rango[1]) : x;
  }
  function qt() {
    var x = sb.from('tickets').select('*').eq('categoria', 'Combustible').neq('estado', 'Descartado').order('fecha', { ascending: false, nullsFirst: true }).order('id_doc');
    return rango ? x.gte('fecha', rango[0]).lt('fecha', rango[1]) : x;
  }
  return Promise.all([consultaTodo(q), consultaTodo(qp), consultaTodo(qt)]).then(function (r) {
    var tks = (r[2].data || []).filter(function (t) { return s.todasEmpresas || !t.empresa || t.empresa === s.empresa; });   // el fondo común se ve siempre
    return { repostajes: r[0].data || [], precios: r[1].data || [], tickets: tks };
  });
}
function eurosLitro(v) { return v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: 3, maximumFractionDigits: 4 }) + ' €/l'; }
function litros(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' l'; }

function vCombustible(v, d) {
  var empresas = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Empresa' }, [null].concat(EMPRESAS).map(function (e) {
    var activo = e === null ? S.todasEmpresas : !S.todasEmpresas && S.empresa === e;
    return h('button', { type: 'button', class: activo ? 'activo' : '', 'aria-pressed': activo ? 'true' : 'false', onclick: function () {
      if (activo) return; S.todasEmpresas = e === null; if (e !== null) S.empresa = e; cargar(true);
    } }, e || 'Todas');
  }));
  var periodo = h('select', { 'aria-label': 'Fecha' }, PERIODOS.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
  periodo.value = S.periodoComb;
  periodo.addEventListener('change', function () { S.periodoComb = periodo.value; cargar(true); });
  var estadoX = h('span', { class: 'estado-excel', role: 'status' });
  var excel = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    excel.disabled = true; estadoX.textContent = 'Preparando…';
    try {
      var X = await prepararExcel(), libro = new X.Workbook(); libro.creator = 'MCD';
      var hr = libro.addWorksheet('Repostajes', { views: [{ state: 'frozen', ySplit: 1 }] });
      var colsR = [['fecha', 'Fecha', FECHA], ['empresa', 'Empresa'], ['gasolinera', 'Gasolinera'], ['estacion', 'Estación (factura)'], ['estacion_tabla', 'Estación (tabla)'],
        ['matricula', 'Matrícula'], ['combustible', 'Combustible'],
        ['litros', 'Litros'], ['precio_litro', 'Precio facturado (€/l)', 'l4'], ['precio_tabla', 'Precio tabla (€/l)', 'l4'], ['diferencia_litro', 'Diferencia (€/l)', 'l4'],
        ['sobrecoste', 'De más (€)', EUR], ['importe', 'Importe (€)', EUR], ['estado', 'Resultado'], ['nota', 'Nota'], ['id_doc', 'Factura (ID)'],
        ['comprobante', 'Albarán o ticket']];
      hr.columns = colsR.map(function (c) { return { header: c[1], key: c[0], width: /gasolinera|nota|estacion/.test(c[0]) ? 34 : 16,
        style: c[2] === EUR ? { numFmt: '#,##0.00 "€"' } : c[2] === 'l4' ? { numFmt: '0.0000' } : c[2] === FECHA ? { numFmt: 'dd/mm/yyyy' } : {} }; });
      d.repostajes.forEach(function (x) {
        var fila = {}; colsR.forEach(function (c) { var val = x[c[0]];
          if (c[2] === FECHA && val) val = new Date(String(val).slice(0, 10) + 'T00:00:00Z');
          else if ((c[2] === EUR || c[2] === 'l4' || c[0] === 'litros') && val !== null && val !== undefined) val = numeroExcel(val);
          if (typeof val === 'string' && /^[=+\-@]/.test(val)) val = "'" + val;
          fila[c[0]] = val === undefined ? null : val; });
        hr.addRow(fila);
      });
      hr.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hr.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; });
      if (d.repostajes.length) hr.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colsR.length } };
      var hp = libro.addWorksheet('Precios', { views: [{ state: 'frozen', ySplit: 1 }] });
      hp.columns = [{ header: 'Fecha (desde)', key: 'fecha', width: 13, style: { numFmt: 'dd/mm/yyyy' } }, { header: 'Vigencia', key: 'vig', width: 18 },
        { header: 'Estación', key: 'estacion', width: 34 }, { header: 'Población', key: 'poblacion', width: 22 }, { header: 'Provincia', key: 'provincia', width: 14 },
        { header: 'Combustible', key: 'combustible', width: 14 }, { header: 'Precio (€/l)', key: 'precio_litro', width: 13, style: { numFmt: '0.0000' } },
        { header: 'Precio con IVA (€/l)', key: 'precio_con_iva', width: 16, style: { numFmt: '0.0000' } }, { header: 'IVA incluido', key: 'iva', width: 12 },
        { header: 'Para', key: 'empresa', width: 12 }, { header: 'Proveedor', key: 'proveedor', width: 20 }];
      d.precios.forEach(function (p) { var fila = { fecha: new Date(String(p.fecha).slice(0, 10) + 'T00:00:00Z'), vig: p.hasta_nuevo_aviso ? 'Hasta nuevo aviso' : 'Solo ese día',
        estacion: p.estacion || 'General', poblacion: p.poblacion || '', provincia: p.provincia || '', combustible: p.combustible, precio_litro: numeroExcel(p.precio_litro),
        precio_con_iva: p.precio_con_iva === null || p.precio_con_iva === undefined ? null : numeroExcel(p.precio_con_iva),
        iva: p.precio_con_iva ? 'No (sin IVA)' : p.iva_incluido === true ? 'Sí' : p.iva_incluido === false ? 'No' : 'No consta', empresa: p.empresa || 'Todas', proveedor: p.proveedor || '' };
        Object.keys(fila).forEach(function (k) { if (typeof fila[k] === 'string' && /^[=+\-@]/.test(fila[k])) fila[k] = "'" + fila[k]; });
        hp.addRow(fila); });
      hp.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hp.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; });
      await guardarLibro(libro, ['MCD', 'Combustible', S.todasEmpresas ? 'todas' : S.empresa, nombrePeriodo(S.periodoComb), new Date().toISOString().slice(0, 10)].join('_'));
      estadoX.textContent = 'Descargado';
    } catch (e) { estadoX.textContent = 'No se ha descargado: ' + mensajeError(e); }
    finally { excel.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);
  v.appendChild(h('div', { class: 'herramientas' }, [h('div', { class: 'fila-herramientas' }, [empresas,
    h('label', { class: 'campo-corto' }, ['Fecha', periodo]), h('div', { class: 'descarga-directa' }, [excel, estadoX])])]));

  var otrasReps = d.repostajes.filter(function (x) { return x.estado === 'Otra gasolinera'; });
  var reps = d.repostajes.filter(function (x) { return x.estado !== 'Otra gasolinera'; }), caros = reps.filter(function (x) { return x.estado === 'Más caro'; });
  var sinPrecio = reps.filter(function (x) { return x.estado === 'Sin precio'; });
  var demas = caros.reduce(function (t, x) { return t + (Number(x.sobrecoste) || 0); }, 0);
  var totLitros = reps.reduce(function (t, x) { return t + (Number(x.litros) || 0); }, 0);
  var litrosOtras = otrasReps.reduce(function (t, x) { return t + (Number(x.litros) || 0); }, 0);
  function metrica(icono, color, valor, nombre, ayuda) {
    return h('div', { class: 'metrica ' + color, style: 'cursor:default' }, [h('span', { class: 'icono-redondo ' + color }, iconoPanel(icono)),
      h('span', { class: 'metrica-texto' }, [h('strong', {}, valor), h('span', { class: 'metrica-nombre' }, nombre), h('span', { class: 'metrica-ayuda' }, ayuda)])]);
  }
  v.appendChild(h('div', { class: 'metricas' }, [
    metrica('revision', caros.length ? 'naranja' : 'verde', euros(demas), 'Pagado de más', caros.length ? caros.length + ' repostaje(s) por encima de la tabla' : 'Todo coincide con la tabla'),
    metrica('combustible', 'azul', Math.round(totLitros).toLocaleString('es-ES') + ' l', 'Repostajes en ' + NOMBRE_GASOLINERA_TABLA,
      reps.length + ' repostaje(s)' + (otrasReps.length ? ' · otras gasolineras: ' + otrasReps.length + ' (' + Math.round(litrosOtras).toLocaleString('es-ES') + ' l)' : '')),
    metrica('documentos', sinPrecio.length ? 'naranja' : 'cian', String(sinPrecio.length), 'Sin comparar', sinPrecio.length ? 'Sin precio de ese día o estación (ver la nota)' : 'Todos tienen precio')]));

  v.appendChild(h('p', { class: 'sub' }, 'Solo se comparan con la tabla de precios los repostajes de ' + NOMBRE_GASOLINERA_TABLA +
    '. Los de otras gasolineras van aparte y no se comparan.'));
  v.appendChild(h('h3', {}, 'Repostajes más caros que la tabla (' + NOMBRE_GASOLINERA_TABLA + ')'));
  if (!caros.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, reps.length ? 'Ningún repostaje supera el precio del día.' : 'Todavía no hay repostajes de ' + NOMBRE_GASOLINERA_TABLA + ' en este periodo.'));
  else tabla(v, ['Fecha', { t: 'Estación', largo: 1 }, 'Empresa', 'Matrícula', 'Combustible', { t: 'Litros', num: 1 }, { t: 'Facturado', num: 1 }, { t: 'Tabla', num: 1 },
    { t: 'Diferencia', num: 1 }, { t: 'De más', num: 1 }], caros.map(function (x) {
      return { abrir: function () { abrirFichaPorId('Factura', x.empresa, 'facturas', x.id_doc); },
        celdas: [fecha(x.fecha), x.estacion_tabla || x.estacion || x.gasolinera || '—', x.empresa, x.matricula || '—', x.combustible, { t: litros(x.litros), num: 1 }, { t: eurosLitro(x.precio_litro), num: 1 },
          { t: eurosLitro(x.precio_tabla), num: 1 }, { t: '+' + eurosLitro(x.diferencia_litro), num: 1 }, { t: euros(x.sobrecoste), num: 1 }] };
    }), 'Factura');

  v.appendChild(h('h3', {}, 'Repostajes en ' + NOMBRE_GASOLINERA_TABLA));
  if (!reps.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay repostajes de ' + NOMBRE_GASOLINERA_TABLA + ' en este periodo.'));
  else tabla(v, ['Fecha', { t: 'Estación', largo: 1 }, 'Empresa', 'Combustible', { t: 'Litros', num: 1 }, { t: 'Facturado', num: 1 }, { t: 'Tabla', num: 1 }, 'Resultado'],
    reps.slice(0, 300).map(function (x) {
      return { abrir: function () { abrirFichaPorId('Factura', x.empresa, 'facturas', x.id_doc); },
        celdas: [fecha(x.fecha), x.estacion_tabla || x.estacion || x.gasolinera || '—', x.empresa, x.combustible || '—', { t: litros(x.litros), num: 1 }, { t: eurosLitro(x.precio_litro), num: 1 },
          { t: eurosLitro(x.precio_tabla), num: 1 }, h('span', { class: 'pill ' + ({ 'Correcto': 'ok', 'Más barato': 'ok', 'Más caro': 'error', 'Sin precio': 'aviso' }[x.estado] || ''), title: x.nota || '' },
            x.estado === 'Sin precio' ? 'Sin comparar' : x.estado)] };
    }), 'Factura');

  v.appendChild(h('h3', {}, 'Repostajes en otras gasolineras'));
  if (!otrasReps.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay repostajes en otras gasolineras en este periodo.'));
  else tabla(v, ['Fecha', { t: 'Gasolinera', largo: 1 }, 'Empresa', 'Matrícula', 'Combustible', { t: 'Litros', num: 1 }, { t: 'Precio', num: 1 }, { t: 'Importe', num: 1 }],
    otrasReps.slice(0, 300).map(function (x) {
      return { abrir: function () { abrirFichaPorId('Factura', x.empresa, 'facturas', x.id_doc); },
        celdas: [fecha(x.fecha), x.estacion || x.gasolinera || '—', x.empresa, x.matricula || '—', x.combustible || '—', { t: litros(x.litros), num: 1 },
          { t: eurosLitro(x.precio_litro), num: 1 }, { t: x.importe === null || x.importe === undefined ? '—' : euros(x.importe), num: 1 }] };
    }), 'Factura');

  // Tickets de gasolina: el fondo común (sin empresa, esperando la factura) y los ya enlazados
  var todosTks = d.tickets || [];
  var tks = todosTks.filter(function (t) { return esNieves(t.comercio, t.estacion); });
  var tksOtras = todosTks.filter(function (t) { return !esNieves(t.comercio, t.estacion); });
  var comun = tks.filter(function (t) { return !t.empresa; }), conFactura = tks.filter(function (t) { return t.empresa; });
  v.appendChild(h('h3', {}, 'Tickets de gasolina (' + NOMBRE_GASOLINERA_TABLA + ')'));
  v.appendChild(h('p', { class: 'sub' }, 'Hasta que llega la factura de la gasolinera, el ticket está en el fondo común (sin empresa). Cuando llega y coincide ' +
    '(mismo día y mismos litros), pasa solo a la empresa de la factura, y su estación sirve para comparar el precio.'));
  if (!tks.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay tickets de ' + NOMBRE_GASOLINERA_TABLA + ' en este periodo. Se suben con el botón "Subir documentos" o "Hacer foto".'));
  else tabla(v, ['Fecha', 'Ticket', { t: 'Estación', largo: 1 }, 'Matrícula', { t: 'Litros', num: 1 }, { t: 'Total', num: 1 }, 'Empresa', 'Estado'],
    comun.concat(conFactura).map(function (t) {
      return { abrir: function () { fichaTicket(t); },
        celdas: [t.fecha ? fecha(t.fecha) : '—', t.id_doc, t.estacion || t.comercio || '—', t.matricula || '—', { t: litros(t.litros), num: 1 },
          { t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 },
          t.empresa && t.factura_id_doc ? pildoraEnlace('ok', t.empresa + ' · ' + t.factura_id_doc, 'Abrir la factura con la que está enlazado', function () { abrirDocumento(t.factura_id_doc, 'facturas', t.empresa); })
            : t.empresa ? h('span', { class: 'pill ok' }, t.empresa)
                    : h('span', { class: 'pill', title: 'Esperando la factura de la gasolinera' }, 'Fondo común'),
          pillEstado(t.estado)] };
    }), 'Ticket');
  if (comun.length) v.appendChild(h('p', { class: 'sub' }, 'Fondo común: ' + comun.length + ' ticket(s) · ' +
    euros(comun.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0)) + ' esperando su factura.'));
  v.appendChild(h('h3', {}, 'Tickets de otras gasolineras'));
  if (!tksOtras.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay tickets de otras gasolineras en este periodo.'));
  else tabla(v, ['Fecha', 'Ticket', { t: 'Gasolinera', largo: 1 }, 'Matrícula', { t: 'Litros', num: 1 }, { t: 'Total', num: 1 }, 'Estado'],
    tksOtras.map(function (t) {
      return { abrir: function () { fichaTicket(t); },
        celdas: [t.fecha ? fecha(t.fecha) : '—', t.id_doc, t.comercio || t.estacion || '—', t.matricula || '—', { t: litros(t.litros), num: 1 },
          { t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 }, pillEstado(t.estado)] };
    }), 'Ticket');

  // Tablas de precios por ESTACIÓN: una pestaña por cada tabla recibida (no se borra ninguna: las facturas
  // llegan tarde y cada repostaje se compara con la tabla que estaba en vigor el día que se repostó)
  var porEstacion = d.precios.filter(function (p) { return p.estacion; });
  var tablas = {};
  porEstacion.forEach(function (p) {
    var k = String(p.fecha).slice(0, 10) + '|' + (p.empresa || '');
    (tablas[k] = tablas[k] || []).push(p);
  });
  var claves = Object.keys(tablas).sort().reverse();          // la más reciente primero
  if (claves.length) {
    var ultimaDe = {};                                          // empresa -> fecha de su tabla más nueva
    claves.forEach(function (k) { var e = k.split('|')[1]; if (!ultimaDe[e]) ultimaDe[e] = k.split('|')[0]; });
    function siguiente(k) {                                     // fecha de la tabla que la sustituyó (misma empresa)
      var f = k.split('|')[0], e = k.split('|')[1];
      return claves.filter(function (x) { return x.split('|')[1] === e && x.split('|')[0] > f; }).map(function (x) { return x.split('|')[0]; }).sort()[0];
    }
    if (claves.indexOf(S.tablaComb) < 0) S.tablaComb = claves[0];
    var mostrar = claves.slice(0, 40);
    if (mostrar.indexOf(S.tablaComb) < 0) mostrar.push(S.tablaComb);
    v.appendChild(h('h3', {}, 'Tablas de precios recibidas'));
    v.appendChild(h('p', { class: 'sub' }, 'Cada tabla que llega se guarda con su fecha y no sustituye a las anteriores. Cada repostaje se compara con la tabla que ' +
      'estaba en vigor el día que se repostó, aunque la factura llegue mucho después.'));
    v.appendChild(h('div', { class: 'segmentos pestanas-precios', role: 'tablist', 'aria-label': 'Tablas de precios' }, mostrar.map(function (k) {
      var f = k.split('|')[0], e = k.split('|')[1], activo = k === S.tablaComb;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': activo ? 'true' : 'false', class: activo ? 'activo' : '',
        onclick: function () { S.tablaComb = k; pintar(); } }, fecha(f) + (e ? ' · ' + e : '') + (ultimaDe[e] === f ? ' (en vigor)' : ''));
    })));
    var k = S.tablaComb, filas = tablas[k], fTabla = k.split('|')[0], eTabla = k.split('|')[1], sig = siguiente(k);
    var vigencia = filas[0] && filas[0].hasta_nuevo_aviso
      ? (sig ? 'Vigente del ' + fecha(fTabla) + ' al ' + fecha(sig) + ' (ese día llegó la siguiente)' : 'En vigor desde el ' + fecha(fTabla) + ' hasta que llegue otra')
      : 'Solo para el día ' + fecha(fTabla);
    v.appendChild(h('p', { class: 'sub' }, [h('b', {}, vigencia), ' · ' + (eTabla ? 'para ' + eTabla : 'para todas las empresas') +
      (filas[0] && filas[0].proveedor ? ' · ' + filas[0].proveedor : '') + ' · ' + filas.length + ' precio(s)']));
    tabla(v, [{ t: 'Estación', largo: 1 }, 'Población', 'Provincia', 'Combustible', { t: 'Sin IVA', num: 1 }, { t: 'Con IVA', num: 1 }], filas.map(function (p) {
      return { celdas: [p.estacion, p.poblacion || '—', p.provincia || '—', p.combustible, { t: eurosLitro(p.precio_litro), num: 1 },
        { t: p.precio_con_iva ? eurosLitro(p.precio_con_iva) : '—', num: 1 }] };
    }));
    if (claves.length > mostrar.length) v.appendChild(h('p', { class: 'sub' }, 'Se ven las 40 tablas más recientes; el Excel las incluye todas.'));
  }

  // Precios por DÍA (tablas sin estaciones): una fila por día y una columna por combustible
  var generales = d.precios.filter(function (p) { return !p.estacion; });
  var tipos = Array.from(new Set(generales.map(function (p) { return p.combustible; }))).sort();
  var dias = Array.from(new Set(generales.map(function (p) { return String(p.fecha).slice(0, 10); }))).sort().reverse().slice(0, 62);
  var mapa = {}; generales.forEach(function (p) { mapa[String(p.fecha).slice(0, 10) + '|' + p.combustible] = p; });
  if (!dias.length && !porEstacion.length) {
    v.appendChild(h('h3', {}, 'Precios del proveedor'));
    v.appendChild(h('div', { class: 'tarjeta vacio' }, 'Aún no ha llegado ninguna tabla de precios para estas fechas. Cuando llegue por correo aparecerá aquí.'));
  }
  if (dias.length) {
    v.appendChild(h('h3', {}, 'Precios por día (tabla del proveedor)'));
    tabla(v, ['Día'].concat(tipos.map(function (t) { return { t: t, num: 1 }; })), dias.map(function (dia) {
      return { celdas: [fecha(dia)].concat(tipos.map(function (t) { var p = mapa[dia + '|' + t]; return { t: p ? eurosLitro(p.precio_litro) : '—', num: 1 }; })) };
    }));
    var conIva = generales.filter(function (p) { return p.iva_incluido === true; }).length, sinIva = generales.filter(function (p) { return p.iva_incluido === false; }).length;
    v.appendChild(h('p', { class: 'sub' }, conIva && !sinIva ? 'Los precios de la tabla incluyen IVA.' : sinIva && !conIva ? 'Los precios de la tabla son sin IVA.' :
      'La tabla no dice si el precio lleva IVA; se compara en la misma base que la factura.'));
  }
}

// ---------------------------------------------------------------------
// TICKETS: gastos generales (gasolina, comidas, aparcamientos...) subidos en foto
// ---------------------------------------------------------------------
var CATEGORIAS_TICKET = ['Combustible', 'Comida', 'Aparcamiento', 'Peaje', 'Alojamiento', 'Transporte', 'Otros'];
function cargarTickets(s) {
  var rango = rangoPeriodo(s.periodoTck);
  function q() {
    var x = sb.from('tickets').select('*').order('fecha', { ascending: false, nullsFirst: true }).order('id_doc', { ascending: false });
    if (rango) x = x.gte('fecha', rango[0]).lt('fecha', rango[1]);
    if (s.estadoTck === 'Descartado') x = x.eq('estado', 'Descartado'); else x = x.neq('estado', 'Descartado');
    if (s.estadoTck === 'Revisar') x = x.eq('estado', 'Revisar');
    return x;
  }
  return consultaTodo(q).then(function (r) { return { tickets: r.data || [] }; });
}
// Pestañas de Tickets: comidas, peajes, gasolina y el resto juntos
var GRUPOS_TICKET = [['comidas', 'Comidas', ['Comida']], ['peajes', 'Peajes', ['Peaje']], ['gasolina', 'Gasolina', ['Combustible']],
  ['otros', 'Otros gastos', ['Aparcamiento', 'Alojamiento', 'Transporte', 'Otros']]];
var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
function grupoTicket(t) { var g = GRUPOS_TICKET.filter(function (x) { return x[2].indexOf(t.categoria) >= 0; })[0]; return g ? g[0] : 'otros'; }
function sumaTotal(lista) { return lista.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0); }
function vTickets(v, d) {
  if (puedeSubir()) v.appendChild(tarjetaSubir());   // la misma subida que en Inicio: el sistema separa tickets y facturas

  // Pestañas (con número y total de cada una); si la elegida está vacía, la primera que tenga tickets
  var porGrupo = {}; GRUPOS_TICKET.forEach(function (g) { porGrupo[g[0]] = []; });
  d.tickets.forEach(function (t) { porGrupo[grupoTicket(t)].push(t); });
  if (!porGrupo[S.catTck]) S.catTck = (GRUPOS_TICKET.filter(function (g) { return porGrupo[g[0]].length; })[0] || GRUPOS_TICKET[0])[0];
  var grupo = GRUPOS_TICKET.filter(function (g) { return g[0] === S.catTck; })[0];
  var lista = porGrupo[S.catTck];
  var selectorGas = null;
  if (grupo[0] === 'gasolina') {          // Petronieves y el resto de gasolineras, por separado
    var deNieves = lista.filter(function (t) { return esNieves(t.comercio, t.estacion); });
    var deOtras = lista.filter(function (t) { return !esNieves(t.comercio, t.estacion); });
    selectorGas = h('div', { class: 'segmentos', role: 'group', 'aria-label': 'Gasolinera' }, [['nieves', NOMBRE_GASOLINERA_TABLA, deNieves], ['otras', 'Otras gasolineras', deOtras]].map(function (o) {
      var activo = S.gasTck === o[0];
      return h('button', { type: 'button', class: activo ? 'activo' : '', 'aria-pressed': activo ? 'true' : 'false', onclick: function () { S.gasTck = o[0]; pintar(); } },
        o[1] + ' (' + o[2].length + ')');
    }));
    lista = S.gasTck === 'otras' ? deOtras : deNieves;
  }
  var pestanas = h('div', { class: 'pestanas-tickets', role: 'tablist', 'aria-label': 'Tipo de ticket' }, GRUPOS_TICKET.map(function (g) {
    var activo = g[0] === S.catTck;
    return h('button', { type: 'button', role: 'tab', 'aria-selected': activo ? 'true' : 'false', class: 'pestana-ticket' + (activo ? ' activo' : ''),
      onclick: function () { S.catTck = g[0]; pintar(); } },
      [h('span', { class: 'pestana-nombre' }, g[1]), h('span', { class: 'pestana-dato' }, porGrupo[g[0]].length + ' · ' + euros(sumaTotal(porGrupo[g[0]])))]);
  }));

  // Filtros
  var periodo = h('select', { 'aria-label': 'Fecha' }, PERIODOS.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
  periodo.value = S.periodoTck;
  periodo.addEventListener('change', function () { S.periodoTck = periodo.value; cargar(true); });
  var estado = h('select', { 'aria-label': 'Estado' }, [['', 'Todos los válidos'], ['Revisar', 'A revisar'], ['Descartado', 'Descartados']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
  estado.value = S.estadoTck;
  estado.addEventListener('change', function () { S.estadoTck = estado.value; cargar(true); });

  // Año y mes de cada ticket ("Sin fecha" si no se leyó)
  function claveMes(t) { var m = /^(\d{4})-(\d{2})/.exec(String(t.fecha || '')); return m ? m[1] + '-' + m[2] : ''; }
  function nombreMes(k) { return k ? MESES[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4) : 'Sin fecha'; }

  // Excel: la pestaña elegida (con año y mes) y un resumen por mes de todas las pestañas
  var estadoX = h('span', { class: 'estado-excel', role: 'status' });
  var excel = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    excel.disabled = true; estadoX.textContent = 'Preparando…';
    try {
      var X = await prepararExcel(), libro = new X.Workbook(); libro.creator = 'MCD';
      var cols = [['anio', 'Año'], ['mes', 'Mes'], ['fecha', 'Fecha', FECHA], ['comercio', 'Comercio'], ['nif', 'NIF'], ['categoria', 'Categoría'], ['concepto', 'Concepto'],
        ['base_imponible', 'Base (€)', EUR], ['iva_porcentaje', 'IVA (%)', PCT], ['cuota_iva', 'IVA (€)', EUR], ['total', 'Total (€)', EUR],
        ['forma_pago', 'Forma de pago'], ['matricula', 'Matrícula'], ['litros', 'Litros'], ['estacion', 'Estación'], ['empresa', 'Empresa'],
        ['estado', 'Estado'], ['observaciones', 'Observaciones'], ['id_doc', 'Número']];
      var hj = libro.addWorksheet(grupo[1], { views: [{ state: 'frozen', ySplit: 1 }] });
      hj.columns = cols.map(function (c) { return { header: c[1], key: c[0], width: /comercio|concepto|observ|estacion/.test(c[0]) ? 32 : c[0] === 'anio' ? 8 : 14,
        style: c[2] === EUR ? { numFmt: '#,##0.00 "€"' } : c[2] === FECHA ? { numFmt: 'dd/mm/yyyy' } : {} }; });
      var colTotal = String.fromCharCode(65 + cols.map(function (c) { return c[0]; }).indexOf('total'));
      lista.forEach(function (t) { var k = claveMes(t), fila = {}; cols.forEach(function (c) { var val = t[c[0]];
        if (c[0] === 'anio') val = k ? Number(k.slice(0, 4)) : null;
        else if (c[0] === 'mes') val = k ? MESES[Number(k.slice(5, 7)) - 1] : 'Sin fecha';
        else if (c[0] === 'empresa' && grupo[0] === 'gasolina') val = t.empresa || 'Fondo común';
        else if (c[2] === FECHA && val) val = new Date(String(val).slice(0, 10) + 'T00:00:00Z');
        else if ((c[2] === EUR || c[2] === PCT || c[0] === 'litros') && val !== null && val !== undefined) val = numeroExcel(val);
        if (typeof val === 'string' && /^[=+\-@]/.test(val)) val = "'" + val;
        fila[c[0]] = val === undefined ? null : val; }); hj.addRow(fila); });
      hj.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hj.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; });
      if (lista.length) {
        hj.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        var filaTotal = { comercio: 'TOTAL (' + lista.length + ')' };
        filaTotal.total = { formula: 'SUBTOTAL(9,' + colTotal + '2:' + colTotal + (lista.length + 1) + ')' };
        hj.addRow(filaTotal).font = { bold: true };
      }
      var rs = libro.addWorksheet('Resumen por mes', { views: [{ state: 'frozen', ySplit: 1 }] });
      rs.columns = [{ header: 'Año', key: 'a', width: 8 }, { header: 'Mes', key: 'm', width: 12 }].concat(GRUPOS_TICKET.map(function (g) {
        return { header: g[1] + ' (€)', key: g[0], width: 15, style: { numFmt: '#,##0.00 "€"' } }; }), [{ header: 'Total (€)', key: 't', width: 15, style: { numFmt: '#,##0.00 "€"' } }]);
      var meses = Array.from(new Set(d.tickets.map(claveMes))).sort().reverse();
      meses.forEach(function (k) {
        var del = d.tickets.filter(function (t) { return claveMes(t) === k; }), fila = { a: k ? Number(k.slice(0, 4)) : null, m: k ? MESES[Number(k.slice(5, 7)) - 1] : 'Sin fecha' };
        GRUPOS_TICKET.forEach(function (g) { fila[g[0]] = Math.round(sumaTotal(del.filter(function (t) { return grupoTicket(t) === g[0]; })) * 100) / 100; });
        fila.t = Math.round(sumaTotal(del) * 100) / 100; rs.addRow(fila);
      });
      rs.getRow(1).font = { bold: true };
      await guardarLibro(libro, ['MCD', 'Tickets', grupo[1] + (grupo[0] === 'gasolina' ? (S.gasTck === 'otras' ? ' otras' : ' ' + NOMBRE_GASOLINERA_TABLA) : ''),
        nombrePeriodo(S.periodoTck), new Date().toISOString().slice(0, 10)].join('_'));
      estadoX.textContent = lista.length + ' tickets descargados';
    } catch (e) { estadoX.textContent = 'No se ha descargado: ' + mensajeError(e); }
    finally { excel.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);

  v.appendChild(h('div', { class: 'herramientas' }, [pestanas,
    h('div', { class: 'fila-herramientas' }, [h('div', {}, [h('div', { class: 'sub' }, 'Total de ' + grupo[1].toLowerCase()),
      h('div', { class: 'total-grande' }, euros(sumaTotal(lista)) + ' · ' + lista.length + ' ticket' + (lista.length === 1 ? '' : 's'))]), h('div', { class: 'descarga-directa' }, [excel, estadoX])]),
    h('div', { class: 'fila-herramientas' }, [selectorGas, h('label', { class: 'campo-corto' }, ['Fecha', periodo]), h('label', { class: 'campo-corto' }, ['Estado', estado])])]));
  if (grupo[0] === 'gasolina') v.appendChild(h('p', { class: 'sub' }, [S.gasTck === 'otras' ? 'Gasolineras que no son ' + NOMBRE_GASOLINERA_TABLA + ': no se comparan con la tabla de precios. ' : '',
    'Sin empresa = fondo común: cada ticket pasa solo a su empresa cuando llega la factura de la gasolinera. También se ven en ',
    h('button', { type: 'button', class: 'boton enlace', onclick: function () { irA('combustible'); } }, 'Combustible'), ', comparados con la tabla de precios.']));
  if (!lista.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, d.tickets.length ? 'No hay tickets de ' + (grupo[0] === 'gasolina' ? (S.gasTck === 'otras' ? 'otras gasolineras' : NOMBRE_GASOLINERA_TABLA) : grupo[1].toLowerCase()) + ' en este periodo.' : 'Todavía no hay tickets en este periodo. Haz una foto para subir el primero.')); return; }

  // Por AÑO y, dentro, por MES (lo más reciente primero; el último mes, abierto)
  var columnas = grupo[0] === 'gasolina'
    ? ['Fecha', { t: 'Estación', largo: 1 }, 'Matrícula', { t: 'Litros', num: 1 }, { t: 'Total', num: 1 }, 'Empresa', 'Estado']
    : ['Fecha', { t: 'Comercio', largo: 1 }].concat(grupo[0] === 'otros' ? ['Tipo'] : [], [{ t: 'Total', num: 1 }, { t: 'IVA', num: 1 }, 'Pago', 'Estado']);
  function fila(t) {
    var comunes = [t.fecha ? fecha(t.fecha) : '—'];
    var mini = { hoja: 'tickets', id: t.id_doc, huella: t.hash_sha256 };
    if (grupo[0] === 'gasolina') return { mini: mini, abrir: function () { fichaTicket(t); }, celdas: comunes.concat([
      (S.gasTck === 'otras' ? [t.comercio, t.estacion].filter(Boolean).join(' · ') : t.estacion || t.comercio) || '—', t.matricula || '—', { t: litros(t.litros), num: 1 },
      { t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 },
      t.empresa ? h('span', { class: 'pill ok' }, t.empresa) : h('span', { class: 'pill', title: 'Esperando la factura de la gasolinera' }, 'Fondo común'), pillEstado(t.estado)]) };
    return { mini: mini, abrir: function () { fichaTicket(t); }, celdas: comunes.concat([t.comercio || '—'], grupo[0] === 'otros' ? [t.categoria] : [],
      [{ t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 }, { t: t.cuota_iva === null || t.cuota_iva === undefined ? '—' : euros(t.cuota_iva), num: 1 },
       t.forma_pago || '—', pillEstado(t.estado)]) };
  }
  var meses = Array.from(new Set(lista.map(claveMes))).sort().reverse();       // '' (sin fecha) queda al final
  var anios = Array.from(new Set(meses.map(function (k) { return k ? k.slice(0, 4) : ''; })));
  anios.forEach(function (a, ia) {
    var delAnio = lista.filter(function (t) { return (claveMes(t).slice(0, 4)) === a; });
    var bloque = h('section', { class: 'anio-tickets' }, [h('h3', { class: 'cab-anio' }, [a || 'Sin fecha', h('span', { class: 'sub' }, ' · ' + delAnio.length + ' ticket' + (delAnio.length === 1 ? '' : 's') + ' · ' + euros(sumaTotal(delAnio)))])]);
    meses.filter(function (k) { return (k ? k.slice(0, 4) : '') === a; }).forEach(function (k, im) {
      var delMes = lista.filter(function (t) { return claveMes(t) === k; });
      var caja = h('details', { class: 'mes-tickets' }, [h('summary', {}, [h('span', { class: 'mes-nombre' }, nombreMes(k)),
        h('span', { class: 'mes-dato' }, delMes.length + ' ticket' + (delMes.length === 1 ? '' : 's') + ' · ' + euros(sumaTotal(delMes)))])]);
      if (ia === 0 && im === 0) caja.open = true;
      tabla(caja, columnas, delMes.map(fila), 'Ticket');
      bloque.appendChild(caja);
    });
    v.appendChild(bloque);
  });
}

function fichaTicket(t) {
  var editable = S.rol === 'Revisor' || S.rol === 'Administrador';
  var campos = [['fecha', 'Fecha', 'date'], ['comercio', 'Comercio'], ['nif', 'NIF del comercio'], ['categoria', 'Categoría', 'cat'], ['concepto', 'Concepto'],
    ['base_imponible', 'Base (€)'], ['iva_porcentaje', 'IVA (%)'], ['cuota_iva', 'IVA (€)'], ['total', 'Total (€)'], ['forma_pago', 'Forma de pago'], ['matricula', 'Matrícula'], ['litros', 'Litros']];
  var entradas = {}, rejilla = h('div', { class: 'campos-ficha' });
  campos.forEach(function (c) {
    var valor = t[c[0]] === null || t[c[0]] === undefined ? '' : String(t[c[0]]).slice(0, c[2] === 'date' ? 10 : 300);
    if (!editable) { rejilla.appendChild(h('div', { class: 'campo-ficha' }, [h('span', { class: 'etiqueta-ficha' }, c[1]), h('div', { class: 'valor-ficha' }, c[2] === 'date' ? fecha(valor) || '—' : valor || '—')])); return; }
    var e = c[2] === 'cat' ? h('select', { id: 'tck-' + c[0] }, CATEGORIAS_TICKET.map(function (x) { return h('option', { value: x }, x); })) : h('input', { id: 'tck-' + c[0], type: c[2] === 'date' ? 'date' : 'text' });
    if (/base|iva|total|litros/.test(c[0])) e.setAttribute('inputmode', 'decimal');
    e.value = valor; entradas[c[0]] = e;
    rejilla.appendChild(h('div', { class: 'campo-ficha' + (c[0] === 'concepto' || c[0] === 'comercio' ? ' campo-ancho' : '') }, [h('label', { for: 'tck-' + c[0] }, c[1]), e]));
  });
  var mensaje = h('div', { class: 'mensaje-ficha', role: 'status' });
  var visor = h('div', { class: 'visor-documento' }, h('p', { class: 'vacio' }, 'Buscando la foto…'));
  var cuerpo = h('div', { class: 'contenido-revision' }, [h('div', { class: 'zona-revision' }, [
    h('section', { class: 'vista-documento' }, [h('div', { class: 'cab-documento' }, [h('h3', {}, 'Foto del ticket')]), visor]),
    h('section', { class: 'editor-documento' }, [h('div', { class: 'resumen-ficha' }, [h('span', { class: 'pill marca' }, t.categoria), pillEstado(t.estado)]),
      t.observaciones ? h('p', { class: 'ayuda-campo' }, t.observaciones) : null,
      /Posible repetido de (TCK-\d+)/.test(t.observaciones || '') ? h('p', { class: 'ayuda-campo' }, ['El otro ticket: ', enlaceDocumento(/Posible repetido de (TCK-\d+)/.exec(t.observaciones)[1], 'tickets')]) : null,
      t.categoria === 'Combustible' ? h('p', { class: 'ayuda-campo' }, [(t.estacion ? 'Estación: ' + t.estacion + ' · ' : '') +
        (t.empresa ? 'Empresa: ' + t.empresa : 'Fondo común: esperando la factura de la gasolinera'),
        t.empresa && t.factura_id_doc ? ' · Su factura: ' : null, t.empresa && t.factura_id_doc ? enlaceDocumento(t.factura_id_doc, 'facturas') : null]) : null,
      h('fieldset', { class: 'seccion-ficha' }, [h('legend', {}, 'Datos del ticket'), rejilla]), historialDocumento('', t.id_doc)])])]);
  function cambios() { var c = {}; Object.keys(entradas).forEach(function (k) { var antes = t[k] === null || t[k] === undefined ? '' : String(t[k]).slice(0, k === 'fecha' ? 10 : 300); if (entradas[k].value !== antes) c[k] = entradas[k].value; }); return c; }
  function guardar(revisado) {
    var c = cambios(); if (!Object.keys(c).length && !revisado) { mensaje.textContent = 'No hay cambios.'; return; }
    mensaje.className = 'mensaje-ficha'; mensaje.textContent = 'Guardando…';
    rpc('panel_guardar_ticket', { p_id: t.id_doc, p_cambios: c, p_revisado: !!revisado }).then(function () {
      fichaSucia = null;
      if (revisado) { cerrarModal(); avisoBreve('Ticket ' + t.id_doc + ' revisado'); } else { mensaje.className = 'mensaje-ficha exito'; mensaje.textContent = 'Cambios guardados.'; }
      cargar(false);
    }).catch(function (e) { mensaje.className = 'mensaje-ficha fallo'; mensaje.textContent = mensajeError(e); });
  }
  var pie = h('div', { class: 'pie-revision' }, [h('span', { class: 'cambios-ficha' }, editable ? 'Corrige lo que haga falta y guarda.' : 'Consulta de solo lectura'), mensaje]);
  if (editable) pie.appendChild(h('div', { class: 'acciones-revision' }, [
    h('button', { type: 'button', class: 'boton peligro', onclick: function () {
      if (!confirm('¿Descartar este ticket?')) return;
      rpc('panel_descartar_ticket', { p_id: t.id_doc }).then(function () { fichaSucia = null; cerrarModal(); avisoBreve('Ticket ' + t.id_doc + ' descartado'); cargar(false); })
        .catch(function (e) { mensaje.className = 'mensaje-ficha fallo'; mensaje.textContent = mensajeError(e); });
    } }, 'Descartar'),
    h('button', { type: 'button', class: 'boton principal', onclick: function () { guardar(false); } }, 'Guardar cambios'),
    h('button', { type: 'button', class: 'boton revisar', onclick: function () { guardar(true); } }, 'Guardar y marcar revisado')]));
  cuerpo.appendChild(pie);
  abrirModal(tituloFicha('Ticket', 'tickets', t), cuerpo);
  document.getElementById('caja').classList.add('revision-amplia');
  fichaSucia = function () { return editable && Object.keys(cambios()).length > 0; };
  // Foto: originales/AAAA-MM/<id>_<archivo> (el mes en que se leyó)
  var numero = secuenciaFicha, d0 = new Date(t.creado_en || Date.now());
  var meses = [0, -1].map(function (k) { var x = new Date(d0.getFullYear(), d0.getMonth() + k, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); });
  async function buscarFoto() {
    for (var m of meses) {
      var l = await sb.storage.from('documentos').list('originales/' + m, { limit: 5, search: t.id_doc + '_' });
      var x = !l.error && (l.data || []).filter(function (o) { return o.id && o.name.indexOf(t.id_doc + '_') === 0; })[0];
      if (x) return { ruta: 'originales/' + m + '/' + x.name, nombre: x.name };
    }
    return null;
  }
  async function verFoto(foto) {
    await rpc('panel_registrar_acceso_archivo', { p_id: t.id_doc, p_tipo: 'original', p_accion: 'Ver documento' });
    var url = await urlFirmada(foto.ruta);
    if (numero !== secuenciaFicha) return;
    crearVisor(visor, url, foto.nombre);
  }
  (async function () {
    var foto = await buscarFoto();
    if (numero !== secuenciaFicha) return;
    if (foto) return verFoto(foto);
    // Ya no está en la web: se puede traer del ordenador
    avisoEnElOrdenador(visor, { tipo: 'original', id_doc: t.id_doc, mes: meses[0] }, buscarFoto, function (traida) {
      if (numero === secuenciaFicha) verFoto(traida).catch(function () {});
    });
  })().catch(function () { if (numero === secuenciaFicha) { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La foto no está disponible ahora mismo.')); } });
}

// ---------------------------------------------------------------------
// REVISIÓN
// ---------------------------------------------------------------------
function vRevision(v, lista) {
  var tipos = ['', 'Factura a revisar', 'Albarán a revisar', 'Albarán sin factura', 'Pack por confirmar', 'Ticket a revisar', 'Revisión manual'];
  if (S.filtro && !lista.some(function (x) { return x.tipo === S.filtro; })) S.filtro = '';   // se vació ese grupo: volver a "Todo"
  v.appendChild(h('div', { class: 'barra' }, h('div', { class: 'chips' }, tipos.map(function (t) {
    var n = lista.filter(function (x) { return !t || x.tipo === t; }).length;
    return t && !n ? null : h('button', { class: S.filtro === t ? 'activo' : '', onclick: function () { S.filtro = t; pintar(); } }, (t || 'Todo') + ' (' + n + ')');
  }))));
  var enviados = SUBIDAS.filter(function (s) { return /^tachado_/.test(s.nombre); });
  if (enviados.length) {
    v.appendChild(h('section', { class: 'tarjeta enviados-tachado' }, [h('h3', {}, 'Enviados a la IA'),
      h('p', { class: 'sub' }, 'El servicio los lee en un minuto. Cuando estén leídos, pulsa "Abrir" para revisar y corregir sus datos.'),
      h('ul', { id: 'listaSubidas', class: 'lista-subidas' })]));
    setTimeout(pintarSubidas, 0);
  }
  var filas = lista.filter(function (x) { return !S.filtro || x.tipo === S.filtro; });
  v.appendChild(h('p', { class: 'sub' }, 'Un albarán solo aparece aquí si lleva más de ' + DIAS_AVISO_ALBARAN + ' días sin su factura: es normal que el albarán llegue antes. ' +
    'Para quitar un documento de esta lista pulsa "Guardar y marcar revisado" o "Descartar".'));
  if (!filas.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay nada pendiente de revisar.')); return; }
  // Primera columna: lo que se reconoce (número, "Ticket" o el nombre del archivo) y el ID en pequeño
  function celdaDocumento(x) {
    var que = x.hoja === 'tickets' ? 'Ticket' : x.hoja === 'revision' ? (x.numero || 'Sin leer') : (x.numero || 'sin número');
    return h('span', { class: 'nombre-doc' }, [que, h('small', { class: 'id-doc' }, x.id)]);
  }
  // "Pack por confirmar": el programa escribe "¿Va con VTX-0069 · motivo?". Se enseña con el nombre de ese albarán.
  var packs = [];
  function celdaMotivo(x) {
    var m = x.tipo === 'Pack por confirmar' && /^¿Va con (\S+)(?: · ([\s\S]*?))?\?$/.exec(texto(x.motivo));
    if (!m) return x.motivo;
    var hueco = h('span', {}, x.motivo); packs.push([hueco, m[1], m[2] || '', x.empresa]);
    return hueco;
  }
  tabla(v, ['Documento', 'Qué pasa', 'Empresa', 'Fecha', 'Cliente / proveedor', { t: 'Importe', num: 1 }, { t: 'Motivo', largo: 1 }], filas.map(function (x) {
    return { mini: { hoja: x.hoja, id: x.id }, abrir: function () { if (x.hoja === 'tickets') { abrirDesdeHistorial({ hoja: 'tickets', id_doc: x.id }); return; }
        abrirFichaPorId(x.hoja === 'facturas' ? 'Factura' : x.hoja === 'albaranes' ? 'Albarán' : 'Revisión manual', x.empresa, x.hoja, x.id); },
      celdas: [celdaDocumento(x), ENVIADOS_TACHADO[x.id] && x.tipo === 'Revisión manual' ? h('span', { class: 'pill ok' }, 'Enviado a la IA') : pillEstado(x.tipo === 'Albarán sin factura' ? 'Sin factura' : x.tipo),
        x.empresa === '_revision' || !x.empresa ? '—' : x.empresa, fecha(x.fecha), x.nombre, { t: x.total === null || x.total === undefined ? '' : euros(x.total), num: 1 },
        ENVIADOS_TACHADO[x.id] && x.tipo === 'Revisión manual' ? 'Copia tachada enviada: se está leyendo (tarda un minuto)' : celdaMotivo(x)] };
  }), 'Revisión');
  if (packs.length) buscarDocumentos(packs.map(function (x) { return x[1]; }), ['albaranes']).then(function (vistos) {
    packs.forEach(function (x) {
      var p = vistos[x[1]]; if (!p) return;
      var razon = x[2].split(x[1]).join('ese albarán');
      x[0].textContent = '¿Va con ';
      x[0].appendChild(h('button', { type: 'button', class: 'boton enlace', title: 'Abrir ese albarán', onclick: function (e) { e.stopPropagation(); abrirDocumento(x[1], 'albaranes', x[3]); } },
        [nombreDocumento('albaranes', p.fila), h('small', { class: 'id-doc' }, x[1])]));
      x[0].appendChild(document.createTextNode('?' + (razon ? ' Motivo: ' + razon + '.' : '')));
    });
  });
}
function abrirFichaPorId(titulo, empresa, hoja, id) {
  abrirModal(titulo + ' · ' + id, h('div', { class: 'cargando', role: 'status' }, 'Cargando documento…'));
  var numero = secuenciaFicha;
  var q = sb.from(hoja).select('*').eq('id_doc', id); if (hoja !== 'revision') q = q.eq('empresa', empresa);
  consulta(q.maybeSingle()).then(function (r) {
    if (numero !== secuenciaFicha) return;
    if (!r.data) throw new Error('No se encuentra el documento. Actualiza el panel.');
    ficha(titulo, r.data, { empresa: empresa, hoja: hoja });
  }).catch(function (e) { if (numero === secuenciaFicha) abrirModal('No se ha podido abrir el documento', h('p', {}, mensajeError(e))); });
}

// ---------------------------------------------------------------------
// DOCUMENTOS (archivos guardados en Supabase)
// ---------------------------------------------------------------------
function cargarCarpeta(prefijo) {
  return sb.storage.from('documentos').list(prefijo || '', { limit: 500, sortBy: { column: 'name', order: 'asc' } }).then(function (r) {
    if (r.error) throw new Error(r.error.message);
    var elementos = (r.data || []).filter(function (x) { return x.name !== '.emptyFolderPlaceholder' && !(!prefijo && x.name === 'miniaturas'); }).map(function (x) {
      var esCarpeta = x.id === null || x.id === undefined;
      return { tipo: esCarpeta ? 'carpeta' : 'archivo', nombre: x.name, ruta: (prefijo ? prefijo + '/' : '') + x.name,
        fecha: x.updated_at || x.created_at || '', tamano: x.metadata && x.metadata.size };
    }).sort(function (a, b) { return a.tipo !== b.tipo ? (a.tipo === 'carpeta' ? -1 : 1) : a.tipo === 'carpeta' ? a.nombre.localeCompare(b.nombre) : String(b.fecha).localeCompare(String(a.fecha)); });
    return { camino: prefijo ? prefijo.split('/') : [], elementos: elementos };
  });
}
function vDocumentos(v, d) {
  if (S.rol === 'Administrador') exportarOriginales(v);
  var miga = h('div', { class: 'miga' }, h('button', { class: 'abrir-fila', type: 'button', onclick: function () { S.carpeta = ''; cargar(true); } }, 'Documentos'));
  d.camino.forEach(function (c, i) {
    miga.appendChild(h('span', {}, '›'));
    var ruta = d.camino.slice(0, i + 1).join('/');
    miga.appendChild(i < d.camino.length - 1 ? h('button', { class: 'abrir-fila', type: 'button', onclick: function () { S.carpeta = ruta; cargar(true); } }, c) : h('b', {}, c));
  });
  v.appendChild(miga);
  v.appendChild(h('p', { class: 'sub' }, 'Aquí están los originales de los últimos ' + DIAS_EN_LA_WEB + ' días. Los anteriores siguen guardados en el ordenador: ábrelos desde su factura, albarán o ticket con "Traer del ordenador".'));
  if (!d.elementos.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, 'Carpeta vacía. Los archivos aparecen aquí cuando el servicio termina de procesarlos.')); return; }
  tabla(v, [{ t: 'Nombre', largo: 1 }, 'Modificado', { t: 'Tamaño', num: 1 }], d.elementos.map(function (x) {
    var esCarpeta = x.tipo === 'carpeta';
    return { abrir: esCarpeta ? function () { S.carpeta = x.ruta; cargar(true); } : function () { vistaPreviaRuta(x.nombre, x.ruta); },
      celdas: [(esCarpeta ? '📁 ' : '📄 ') + x.nombre, x.fecha ? fecha(String(x.fecha).slice(0, 10)) + ' ' + hora(x.fecha) : '', { t: esCarpeta ? '' : tamano(x.tamano), num: 1 }] };
  }));
}
// ---------------------------------------------------------------------
// ARCHIVOS QUE SOLO ESTÁN EN EL ORDENADOR (supabase/archivos_en_el_ordenador.sql, archivos_web.py)
// En la web solo se quedan los originales de los últimos días; todos siguen en el ordenador.
// ---------------------------------------------------------------------
var DIAS_EN_LA_WEB = Number(CFG.DIAS_ARCHIVOS_EN_LA_WEB) || 15;
var SEGUNDOS_MAX_TRAER = 120;
function nombreSeguro(n) { return String(n || '').replace(/[\\\/:*?"<>|#%\[\]{}]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || 'archivo'; }
// Pide al ordenador el archivo y espera a que aparezca en la web. buscar() -> Promise(archivo o null)
function traerDelOrdenador(pedido, buscar, aviso) {
  return buscar().then(function (ya) {          // puede que alguien lo haya traído hace poco
    if (ya) return ya;
    aviso('Pidiendo el archivo al ordenador… suele tardar menos de un minuto.');
    return pedirYEsperar(pedido, buscar);
  });
}
function pedirYEsperar(pedido, buscar) {
  return rpc('panel_pedir_archivo', { p_tipo: pedido.tipo, p_id_doc: pedido.id_doc, p_mes: pedido.mes || '', p_huella: pedido.huella || '' }).then(function (r) {
    var inicio = Date.now();
    return new Promise(function (ok, mal) {
      (function mirar() {
        buscar().then(function (archivo) {
          if (archivo) { ok(archivo); return; }
          return rpc('panel_archivo_pedido', { p_id: r && r.id }).then(function (e) {
            if (e && e.atendido && e.resultado !== 'Subido') { mal(new Error(e.resultado === 'No está en el ordenador' ? 'Este archivo no está en el ordenador.' : (e.resultado || 'No se ha podido traer'))); return; }
            if (Date.now() - inicio > SEGUNDOS_MAX_TRAER * 1000) { mal(new Error('El ordenador no ha respondido. ¿Está encendido y con el programa en marcha? Vuelve a intentarlo en un rato.')); return; }
            setTimeout(mirar, 3000);
          });
        }).catch(mal);
      })();
    });
  });
}
// Caja que se pinta en el visor cuando el archivo ya no está en la web
function avisoEnElOrdenador(visor, pedido, buscar, alTraerlo) {
  var estado = h('p', { class: 'sub', role: 'status' }, '');
  var boton = h('button', { type: 'button', class: 'boton principal', onclick: function () {
    boton.disabled = true;
    traerDelOrdenador(pedido, buscar, function (t) { estado.textContent = t; }).then(alTraerlo, function (e) {
      estado.textContent = mensajeError(e); boton.disabled = false;
    });
  } }, 'Traer del ordenador');
  visor.textContent = '';
  visor.appendChild(h('div', { class: 'vacio en-el-ordenador' }, [
    h('p', {}, 'Este archivo está guardado en el ordenador. En la web solo se quedan los de los últimos ' + DIAS_EN_LA_WEB + ' días.'),
    boton, estado]));
}
function urlFirmada(ruta) {
  return sb.storage.from('documentos').createSignedUrl(ruta, 600).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data.signedUrl; });
}
// ---------------------------------------------------------------------
// ENLACES ENTRE DOCUMENTOS (18-nov-2026): donde un documento nombra a otro (su factura, sus albaranes, el
// principal de su pack, un repetido...), al pulsarlo se abre ese otro directamente.
// ---------------------------------------------------------------------
var VIVO = function (x) { return ['Descartado', 'Duplicado'].indexOf(x.estado || '') < 0; };
function abrirDocumento(id, hoja, empresa) {
  if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar en esta ficha. ¿Abrir el otro documento sin guardarlos?')) return;
  fichaSucia = null;
  function abrir(queHoja, queEmpresa) {
    if (queHoja === 'tickets') { abrirDesdeHistorial({ hoja: 'tickets', id_doc: id }); return; }
    abrirFichaPorId(queHoja === 'facturas' ? 'Factura' : queHoja === 'albaranes' ? 'Albarán' : 'Revisión manual', queHoja === 'revision' ? '_revision' : queEmpresa, queHoja, id);
  }
  if (hoja && (empresa || hoja === 'tickets' || hoja === 'revision')) { abrir(hoja, empresa); return; }
  buscarDocumentos([id]).then(function (vistos) {
    var v = vistos[id];
    if (!v) { avisoBreve('No se encuentra el documento ' + id + ' (puede que ya no exista)'); return; }
    abrir(v.hoja, v.fila.empresa);
  });
}
// Un enlace a otro documento: su miniatura, su nombre y su ID en pequeño. Si solo se sabe el ID, el nombre llega enseguida.
function enlaceDocumento(id, hoja, fila) {
  var nombre = h('span', {}, etiquetaDocumento(hoja, fila, id));
  var boton = h('button', { type: 'button', class: 'boton enlace enlace-doc', onclick: function (e) { e.stopPropagation(); abrirDocumento(id, hoja, fila && fila.empresa); } },
    [cajaMiniatura(hoja || (/^REV-/.test(id) ? 'revision' : /^TCK-/.test(id) ? 'tickets' : 'documentos'), id), nombre]);
  if (!fila) buscarDocumentos([id]).then(function (vistos) {
    var v = vistos[id]; if (!v) return;
    hoja = v.hoja; fila = v.fila; nombre.textContent = ''; nombre.appendChild(etiquetaDocumento(v.hoja, v.fila, id));
  });
  return boton;
}
// La factura que tiene ese número (la del mismo NIF si hay varias; si no, la de la misma empresa)
function facturaPorNumero(numero, nif, empresa) {
  return consulta(sb.from('facturas').select('id_doc,empresa,tipo_factura,num_factura,fecha,nombre,nif,total,estado').eq('num_factura', numero)).then(function (r) {
    var c = (r.data || []).filter(VIVO);
    return c.filter(function (f) { return f.nif && f.nif === nif; })[0] || c.filter(function (f) { return f.empresa === empresa; })[0] || c[0] || null;
  });
}
function numerosCitados(v) { return texto(v).split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean); }
// Píldora que se puede pulsar (dentro de una fila que ya se abre al pulsarla: no se abren las dos cosas)
function pildoraEnlace(clase, textoPildora, titulo, accion) {
  return h('button', { type: 'button', class: 'pill ' + clase + ' pill-enlace', title: titulo, onclick: function (e) { e.stopPropagation(); accion(); } }, textoPildora);
}
// En la ficha: los otros documentos con los que este tiene que ver, para ir a ellos con un clic
function seccionRelacionados(empresa, hoja, fila) {
  var lista = h('ul', { class: 'lista-relacionados' }), puestos = {};          // (clase propia: «lista-pack» es solo de los packs)
  var caja = h('fieldset', { class: 'seccion-ficha seccion-relacionados', hidden: 'hidden' }, [h('legend', {}, 'Documentos relacionados'),
    h('p', { class: 'ayuda-campo' }, 'Pulsa uno para abrirlo.'), lista]);
  function poner(que, id, suHoja, suFila) {
    if (!id || id === fila.id_doc || puestos[id]) return;
    puestos[id] = true; caja.hidden = false;
    lista.appendChild(h('li', {}, [h('span', { class: 'sub' }, que), enlaceDocumento(id, suHoja, suFila)])); ponerMiniaturas(lista);
  }
  if (hoja === 'albaranes') numerosCitados(fila.factura_vinculada).forEach(function (numero) {
    facturaPorNumero(numero, fila.nif, empresa).then(function (f) { if (f) poner('Su factura:', f.id_doc, 'facturas', f); }).catch(function () {});
  });
  if (hoja === 'facturas' && fila.num_factura) {
    consulta(sb.from('albaranes').select(COLUMNAS_NOMBRE_ALBARAN + ',empresa,nif,factura_vinculada').ilike('factura_vinculada', '%' + fila.num_factura + '%').order('id_doc')).then(function (r) {
      (r.data || []).filter(function (a) {
        return VIVO(a) && numerosCitados(a.factura_vinculada).indexOf(fila.num_factura) >= 0 && (!a.nif || !fila.nif || a.nif === fila.nif || a.empresa === empresa);
      }).forEach(function (a) { poner(a.estado === 'Anexo' ? 'Papel de un pack de esta factura:' : 'Albarán de esta factura:', a.id_doc, 'albaranes', a); });
    }).catch(function () {});
  }
  // Otros documentos nombrados en las notas ("Mismo número que VTX-0012", "ahora es VTX-0050"...)
  var citados = (texto(fila.observaciones) + ' ' + texto(fila.motivo)).match(/\b[A-Z]{2,5}-[A-Z]?\d{2,5}\b/g) || [];
  citados = citados.filter(function (x, i) { return citados.indexOf(x) === i && x !== fila.id_doc && x !== fila.va_con; });
  if (citados.length) buscarDocumentos(citados).then(function (vistos) {
    citados.forEach(function (x) { if (vistos[x]) poner('Nombrado en las notas:', x, vistos[x].hoja, vistos[x].fila); });
  });
  return caja;
}

// ---------------------------------------------------------------------
// MINIATURAS (18-nov-2026): una imagen pequeña de cada documento para reconocerlo en las listas. Las hace el
// servicio a partir de la COPIA TACHADA (miniaturas.py), nunca del original, y son tan pequeñas que el texto no
// se lee. El panel solo las pide si el servicio dice que las hace. Para no pedir de más (el panel se repinta
// solo cada 30 segundos): una consulta de huellas y una sola firma por pantalla, y se recuerda lo ya pedido.
// ---------------------------------------------------------------------
var MINIATURAS = false;                     // lo dice el servicio (panel_inicio.servicio.miniaturas)
var HUELLAS_VISTAS = {};                    // id del documento -> su huella ('' = no tiene)
var MINIS = {};                             // huella -> { url, hasta } o { no: true, hasta }
var SIGLAS_MINI = { facturas: 'FAC', albaranes: 'ALB', tickets: 'TCK', revision: 'REV', documentos: 'DOC' };
var HUELLA_MINI = /^[A-Za-z0-9]{1,64}$/;    // va dentro de una ruta: nunca con barras ni puntos
// El hueco de la miniatura (con las siglas del tipo mientras no hay imagen, o si el documento no tiene)
function cajaMiniatura(hoja, id, huella) {
  if (!MINIATURAS || !id) return null;
  var caja = h('span', { class: 'mini', 'aria-hidden': 'true', 'data-hoja': hoja, 'data-id': id, 'data-siglas': SIGLAS_MINI[hoja] || '' });
  if (huella) caja.setAttribute('data-huella', huella);
  return caja;
}
function ponerMiniaturas(raiz) {
  if (!MINIATURAS || !raiz) return;
  var cajas = [].slice.call(raiz.querySelectorAll('.mini:not(.pedida)'));
  if (!cajas.length) return;
  cajas.forEach(function (c) { c.classList.add('pedida'); var propia = c.getAttribute('data-huella'); if (propia) HUELLAS_VISTAS[c.getAttribute('data-id')] = propia; });
  function sinHuella(hojas) {
    var ids = [];
    cajas.forEach(function (c) { var id = c.getAttribute('data-id'); if (hojas.indexOf(c.getAttribute('data-hoja')) >= 0 && HUELLAS_VISTAS[id] === undefined && ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }
  function leer(tabla, ids) {
    if (!ids.length) return Promise.resolve();
    return consulta(sb.from(tabla).select('id_doc,hash_sha256').in('id_doc', ids)).then(function (r) {
      ids.forEach(function (id) { HUELLAS_VISTAS[id] = ''; });
      (r.data || []).forEach(function (f) { if (f.hash_sha256) HUELLAS_VISTAS[f.id_doc] = f.hash_sha256; });
    });
  }
  Promise.all([leer('documentos', sinHuella(['facturas', 'albaranes', 'documentos'])), leer('revision', sinHuella(['revision'])), leer('tickets', sinHuella(['tickets']))]).then(function () {
    var ahora = Date.now(), pedir = [];
    cajas.forEach(function (c) {
      var huella = HUELLAS_VISTAS[c.getAttribute('data-id')];
      if (huella && HUELLA_MINI.test(huella) && !(MINIS[huella] && MINIS[huella].hasta > ahora) && pedir.indexOf(huella) < 0) pedir.push(huella);
    });
    if (!pedir.length) return;
    return sb.storage.from('documentos').createSignedUrls(pedir.map(function (x) { return 'miniaturas/' + x + '.webp'; }), 3600).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      pedir.forEach(function (x) { MINIS[x] = { no: true, hasta: ahora + 5 * 60000 }; });          // las que no existan no se vuelven a pedir en 5 minutos
      (r.data || []).forEach(function (x) {
        var m = /^miniaturas\/([A-Za-z0-9]+)\.webp$/.exec(x.path || '');
        if (m && x.signedUrl && !x.error) MINIS[m[1]] = { url: x.signedUrl, hasta: ahora + 50 * 60000 };
      });
    });
  }).then(function () {
    cajas.forEach(function (c) {
      var m = MINIS[HUELLAS_VISTAS[c.getAttribute('data-id')]];
      if (!m || !m.url || c.firstChild) return;
      var img = h('img', { src: m.url, alt: '', loading: 'lazy', draggable: 'false' });
      img.addEventListener('error', function () { img.remove(); });          // se queda el hueco con las siglas
      c.appendChild(img);
    });
  }).catch(function () { /* sin miniaturas el panel funciona igual */ });
}
// Al pasar el ratón por una miniatura se ve a su tamaño (160 puntos como mucho)
var miniGrande = null;
document.addEventListener('mouseover', function (e) {
  var caja = e.target && e.target.closest ? e.target.closest('.mini') : null, img = caja && caja.querySelector('img');
  if (!img) return;
  if (!miniGrande) { miniGrande = h('img', { id: 'miniGrande', alt: '', 'aria-hidden': 'true' }); document.body.appendChild(miniGrande); }
  var r = caja.getBoundingClientRect();
  miniGrande.src = img.src; miniGrande.hidden = false;
  miniGrande.style.left = Math.max(8, Math.min(window.innerWidth - 176, r.right + 8)) + 'px';
  miniGrande.style.top = Math.max(8, Math.min(window.innerHeight - 176, r.top - 56)) + 'px';
});
document.addEventListener('mouseout', function (e) { if (miniGrande && e.target && e.target.closest && e.target.closest('.mini')) miniGrande.hidden = true; });

// ---------------------------------------------------------------------
// VISOR CON ZOOM (18-nov-2026)
// Antes la foto se encajaba entera en su caja y, al acercar con el zoom del navegador, la caja menguaba y el
// documento con ella: no había forma de leerlo. Ahora el documento tiene tamaño propio (el ancho del visor × el
// zoom elegido) dentro de una zona con desplazamiento: botones − y +, Ctrl + rueda, pellizco en el móvil y
// arrastrar con el ratón para moverse. Los PDF se pintan con pdf.js (la misma librería del tachado), página a
// página y solo las que se ven. El documento se pinta en este navegador: no sale a ningún otro sitio.
// ---------------------------------------------------------------------
var ZOOM_MINIMO = 0.5, ZOOM_MAXIMO = 6, ZOOM_PASO = 1.25, PIXELES_MAXIMOS_HOJA = 12e6;
var visorAbierto = null;                    // para soltar la memoria del anterior al abrir otro o al cerrar la ficha
function cerrarVisor() { if (visorAbierto) { var v = visorAbierto; visorAbierto = null; v.cerrar(); } }
function crearVisor(visor, url, nombre) {
  cerrarVisor();
  var esImagen = /\.(jpe?g|png|webp|gif|bmp)$/i.test(nombre), esPdf = /\.pdf$/i.test(nombre);
  function marco() { return h('iframe', { src: url, title: 'Vista previa de ' + nombre, loading: 'lazy' }); }
  visor.textContent = '';
  if (!esImagen && !esPdf) { visor.appendChild(marco()); return; }          // otros formatos: como siempre, en un marco del navegador
  var zoom = 1, vivo = true, hojas = [], pdf = null, turno = 0, temporizador = null, arrastre = null, pellizco = null;
  var etiqueta = h('span', { class: 'visor-zoom', role: 'status', 'aria-live': 'polite' }, '100 %');
  function boton(letra, titulo, accion) { return h('button', { type: 'button', class: 'boton', title: titulo, 'aria-label': titulo, onclick: accion }, letra); }
  var ayuda = h('span', { class: 'visor-ayuda' }, 'Ctrl + rueda para acercar · arrastra para moverte');
  var barra = h('div', { class: 'visor-barra', role: 'toolbar', 'aria-label': 'Tamaño del documento' }, [
    boton('−', 'Alejar', function () { cambiarZoom(zoom / ZOOM_PASO); }), etiqueta, boton('+', 'Acercar', function () { cambiarZoom(zoom * ZOOM_PASO); }),
    boton('Ajustar', 'Ajustar al ancho', function () { cambiarZoom(1); }), ayuda]);
  var lista = h('div', { class: 'visor-hojas' }, h('p', { class: 'vacio', role: 'status' }, 'Abriendo…'));
  var zona = h('div', { class: 'visor-zona', tabindex: '0', role: 'group', 'aria-label': 'Vista previa de ' + nombre }, lista);
  visor.appendChild(h('div', { class: 'visor-caja' }, [barra, zona]));
  function noDisponible() { lista.textContent = ''; lista.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); }
  // Tamaño en pantalla de cada hoja: el ancho del visor × el zoom (100 % = ajustado al ancho)
  function colocar() {
    var ancho = Math.round(Math.max(160, zona.clientWidth - 24) * zoom);
    hojas.forEach(function (p) { p.el.style.width = ancho + 'px'; if (p.proporcion && p.el.tagName === 'CANVAS') p.el.style.height = Math.round(ancho * p.proporcion) + 'px'; });
    etiqueta.textContent = Math.round(zoom * 100) + ' %';
  }
  // (px, py): el punto del visor que no debe moverse al cambiar el tamaño (el cursor o el centro)
  function cambiarZoom(nuevo, px, py) {
    nuevo = Math.min(ZOOM_MAXIMO, Math.max(ZOOM_MINIMO, nuevo));
    if (nuevo === zoom || !hojas.length) return;
    if (px === undefined) { px = zona.clientWidth / 2; py = zona.clientHeight / 2; }
    var fx = (zona.scrollLeft + px) / Math.max(1, zona.scrollWidth), fy = (zona.scrollTop + py) / Math.max(1, zona.scrollHeight);
    zoom = nuevo; colocar();
    zona.scrollLeft = fx * zona.scrollWidth - px; zona.scrollTop = fy * zona.scrollHeight - py;
    pintarLuego();
  }
  // PDF: se pintan las páginas que se ven (y las de alrededor) a la resolución del tamaño actual
  function seVe(p) { var arriba = p.el.offsetTop, margen = zona.clientHeight; return arriba + p.el.offsetHeight > zona.scrollTop - margen && arriba < zona.scrollTop + zona.clientHeight + margen; }
  function pintarLuego() { if (!pdf || !vivo) return; clearTimeout(temporizador); temporizador = setTimeout(pintar, 120); }
  async function pintar() {
    var mio = ++turno;
    try {
      if (!zona.isConnected) { este.cerrar(); return; }
      for (var i = 0; i < hojas.length; i++) {
        var p = hojas[i], ancho = p.el.clientWidth;
        if (!vivo || mio !== turno || !pdf) return;
        if (!ancho) continue;
        if (!seVe(p)) { if (p.ancho && p.ancho !== ancho) { p.el.width = p.el.height = 1; p.ancho = 0; } continue; }   // lejos y con otro tamaño: se suelta su memoria
        if (p.ancho === ancho) continue;
        var pagina = await pdf.getPage(i + 1);
        if (!vivo || mio !== turno) return;
        var v1 = pagina.getViewport({ scale: 1 });
        var escala = Math.min(ancho * (window.devicePixelRatio || 1) / v1.width, Math.sqrt(PIXELES_MAXIMOS_HOJA / (v1.width * v1.height)));
        var vp = pagina.getViewport({ scale: escala }), borrador = lienzo(vp.width, vp.height), cx = borrador.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, borrador.width, borrador.height);
        await pagina.render({ canvasContext: cx, viewport: vp }).promise;
        if (!vivo || mio !== turno) return;
        p.el.width = borrador.width; p.el.height = borrador.height; p.el.getContext('2d').drawImage(borrador, 0, 0); p.ancho = ancho;
      }
    } catch (e) { /* una página que no se deja pintar no rompe el resto del panel */ }
  }
  var observador = window.ResizeObserver ? new ResizeObserver(function () { if (vivo && hojas.length) { colocar(); pintarLuego(); } }) : null;
  var este = { cerrar: function () {
    vivo = false; clearTimeout(temporizador); if (observador) observador.disconnect();
    if (pdf) { try { var fin = pdf.destroy(); if (fin && fin.catch) fin.catch(function () {}); } catch (e) { /* ya estaba cerrado */ } pdf = null; }
  } };
  visorAbierto = este;
  if (observador) observador.observe(zona);
  zona.addEventListener('scroll', pintarLuego);
  // Ctrl + rueda (o el gesto de pellizco del panel táctil del portátil): acerca y aleja donde está el cursor
  zona.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;                         // la rueda sola desplaza, como siempre
    e.preventDefault();
    var r = zona.getBoundingClientRect();
    cambiarZoom(zoom * Math.min(ZOOM_PASO, Math.max(1 / ZOOM_PASO, Math.exp(-e.deltaY * 0.0025))), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Arrastrar con el ratón para moverse por el documento (en el móvil se desplaza con el dedo, como siempre)
  zona.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target === zona && (e.offsetX >= zona.clientWidth || e.offsetY >= zona.clientHeight)) return;      // es la barra de desplazamiento
    arrastre = { x: e.clientX, y: e.clientY, izquierda: zona.scrollLeft, arriba: zona.scrollTop };
    try { zona.setPointerCapture(e.pointerId); } catch (err) { /* sin captura también funciona */ }
    zona.classList.add('arrastrando');
  });
  zona.addEventListener('pointermove', function (e) {
    if (!arrastre) return;
    zona.scrollLeft = arrastre.izquierda - (e.clientX - arrastre.x); zona.scrollTop = arrastre.arriba - (e.clientY - arrastre.y);
  });
  function soltar() { arrastre = null; zona.classList.remove('arrastrando'); }
  zona.addEventListener('pointerup', soltar); zona.addEventListener('pointercancel', soltar);
  // Pellizco con dos dedos (móvil y tableta)
  function separacion(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  zona.addEventListener('touchstart', function (e) { if (e.touches.length === 2) pellizco = { d: separacion(e.touches), zoom: zoom }; }, { passive: true });
  zona.addEventListener('touchmove', function (e) {
    if (!pellizco || e.touches.length !== 2) return;
    e.preventDefault();
    var r = zona.getBoundingClientRect();
    cambiarZoom(pellizco.zoom * separacion(e.touches) / Math.max(1, pellizco.d),
      (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top);
  }, { passive: false });
  zona.addEventListener('touchend', function (e) { if (e.touches.length < 2) pellizco = null; });
  zona.addEventListener('touchcancel', function () { pellizco = null; });
  // Con el foco en el documento: + y − cambian el tamaño, 0 lo ajusta al ancho (las flechas desplazan, como siempre)
  zona.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); cambiarZoom(zoom * ZOOM_PASO); }
    else if (e.key === '-') { e.preventDefault(); cambiarZoom(zoom / ZOOM_PASO); }
    else if (e.key === '0') { e.preventDefault(); cambiarZoom(1); }
  });
  (async function () {
    try {
      if (esImagen) {
        var foto = h('img', { class: 'visor-hoja', src: url, alt: 'Vista previa de ' + nombre, draggable: 'false' });
        foto.addEventListener('error', function () { if (vivo && zona.isConnected) { hojas = []; noDisponible(); } });
        lista.textContent = ''; lista.appendChild(foto); hojas = [{ el: foto }]; colocar();
        return;
      }
      var datos = await fetch(url).then(function (r) { if (!r.ok) throw new Error('No se pudo descargar el documento'); return r.arrayBuffer(); });
      var pdfjs = await prepararPdf();
      if (!vivo) return;
      var abierto = await pdfjs.getDocument({ data: new Uint8Array(datos), isEvalSupported: false }).promise;
      if (!vivo) { try { abierto.destroy(); } catch (e) { /* nada */ } return; }
      pdf = abierto;
      var nuevas = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        var medida = (await pdf.getPage(i)).getViewport({ scale: 1 });
        if (!vivo) return;
        var hoja = h('canvas', { class: 'visor-hoja', role: 'img', 'aria-label': 'Página ' + i + ' de ' + pdf.numPages + ' de ' + nombre });
        hoja.width = hoja.height = 1;
        nuevas.push({ el: hoja, proporcion: medida.height / medida.width, ancho: 0 });
      }
      lista.textContent = ''; nuevas.forEach(function (p) { lista.appendChild(p.el); });
      hojas = nuevas;
      if (pdf.numPages > 1) ayuda.textContent = pdf.numPages + ' páginas · Ctrl + rueda para acercar';
      colocar(); pintar();
    } catch (e) {
      if (!vivo || !zona.isConnected) return;
      // Sin el lector de PDF (no se pudo bajar la librería) o con un PDF que no se deja abrir: como antes, en un marco del navegador
      este.cerrar(); if (visorAbierto === este) visorAbierto = null;
      visor.textContent = ''; visor.appendChild(marco());
    }
  })();
}
function vistaPreviaRuta(nombre, ruta) {
  abrirModal(nombre, h('div', { class: 'cargando' }, 'Preparando la vista previa…'));
  var numero = secuenciaFicha;
  rpc('panel_registrar_acceso_archivo', { p_id: ruta.slice(0, 160), p_tipo: 'archivo', p_accion: 'Ver documento' }).then(function () { return urlFirmada(ruta); }).then(function (url) {
    if (numero !== secuenciaFicha) return;
    var caja = document.getElementById('caja'); var visor = h('div', { class: 'visor-documento', style: 'height:72vh' });
    caja.replaceChild(visor, caja.lastChild); crearVisor(visor, url, nombre);
    if (S.rol === 'Administrador') caja.querySelector('.cab').insertBefore(h('button', { class: 'boton', onclick: function () { descargar(ruta, nombre); } }, 'Descargar'), caja.querySelector('.cab .boton'));
  }).catch(function (e) { if (numero === secuenciaFicha) abrirModal('No se puede mostrar', h('p', {}, mensajeError(e))); });
}
function descargar(ruta, nombre) {
  rpc('panel_registrar_acceso_archivo', { p_id: ruta.slice(0, 160), p_tipo: 'archivo', p_accion: 'Descargar documento' })
    .then(function () { return sb.storage.from('documentos').download(ruta); })
    .then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var url = URL.createObjectURL(r.data), a = h('a', { href: url, download: nombre }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    }).catch(function (e) { alert(mensajeError(e)); });
}

// ---------------------------------------------------------------------
// NEGOCIO
// ---------------------------------------------------------------------
function vNegocio(v, d) {
  var empresa = h('select', {}, EMPRESAS.map(function (e) { return h('option', { value: e }, e); })); empresa.value = S.empresa;
  var mes = h('input', { type: 'month' }); mes.value = S.mes;
  v.appendChild(h('div', { class: 'barra' }, [empresa, mes, h('button', { class: 'boton', onclick: function () { S.empresa = empresa.value; S.mes = mes.value || mesActual(); cargar(true); } }, 'Consultar')]));
  v.appendChild(h('h3', {}, 'Avisos de vencimientos y facturas periódicas'));
  tabla(v, ['Tipo', 'Documento', 'Aviso', 'Fecha'], d.avisos.map(function (a) { return { celdas: [a.tipo, a.id, a.texto, fecha(a.fecha)] }; }));
  v.appendChild(h('h3', {}, 'Coste sin IVA por camión'));
  v.appendChild(h('p', { class: 'sub' }, 'Solo se asigna el coste cuando las líneas cuadran con la base. Los importes sin matrícula quedan "Sin asignar".'));
  tabla(v, ['Matrícula', { t: 'Base', num: 1 }], d.costes.map(function (c) { return { celdas: [c.matricula, { t: euros(c.base), num: 1 }] }; }));
  v.appendChild(h('h3', {}, 'Cobros y pagos del mes'));
  tabla(v, ['ID', 'Factura', 'Tipo', 'Estado', { t: 'Total', num: 1 }, { t: 'Abonado', num: 1 }, 'Vence'], d.pagos.map(function (p) {
    return { celdas: [p.id, p.numero, p.tipo, p.estado, { t: euros(p.total), num: 1 }, { t: euros(p.abonado), num: 1 }, vence(p.vence)] };
  }));
  if (S.rol === 'Administrador') {
    v.appendChild(h('h3', {}, 'Reglas de facturas periódicas'));
    tabla(v, ['NIF', 'Categoría', 'Desde', 'Cada meses', 'Día límite', 'Activa'], (d.reglas || []).map(function (r) { return { celdas: [r.nif, r.categoria, r.mes_inicio, r.periodo_meses, r.dia_limite, r.activa ? 'Sí' : 'No'] }; }));
    var nif = h('input', { placeholder: 'NIF proveedor', maxlength: '9' }), categoria = h('select', {}, ['Gasoleo', 'Telepeaje', 'Seguros', 'Otros'].map(function (c) { return h('option', { value: c }, c); }));
    var inicio = h('input', { type: 'month' }); inicio.value = S.mes;
    var periodo = h('input', { type: 'number', min: '1', max: '24', value: '1' }), dia = h('input', { type: 'number', min: '1', max: '28', value: '15' });
    var activa = h('input', { type: 'checkbox' }); activa.checked = true; var msg = h('div', { class: 'mensaje' });
    v.appendChild(h('div', { class: 'tarjeta' }, [h('h3', {}, 'Factura periódica esperada'), h('p', { class: 'sub' }, 'Una regla por empresa, proveedor y categoría. Usa la misma combinación para cambiarla o desactivarla.'),
      h('div', { class: 'formulario' }, [h('label', {}, ['NIF del proveedor', nif]), h('label', {}, ['Categoría', categoria]), h('label', {}, ['Mes inicial', inicio]),
        h('label', {}, ['Cada cuántos meses', periodo]), h('label', {}, ['Día límite del mes (1 a 28)', dia]), h('label', { class: 'en-linea' }, [activa, ' Activa']),
        h('button', { class: 'boton principal', onclick: function () {
          rpc('panel_guardar_periodica', { p_empresa: S.empresa, p_nif: nif.value, p_categoria: categoria.value, p_inicio: inicio.value, p_periodo: Number(periodo.value), p_dia: Number(dia.value), p_activa: activa.checked })
            .then(function () { cargar(true); }).catch(function (e) { msg.className = 'mensaje error'; msg.textContent = mensajeError(e); });
        } }, 'Guardar regla')]), msg]));
  }
}

// ---------------------------------------------------------------------
// USUARIOS (administrador) y exportación
// ---------------------------------------------------------------------
function vUsuarios(v, usuarios) {
  var email = h('input', { type: 'email', placeholder: 'correo@empresa.com' }), nombre = h('input', { type: 'text', placeholder: 'Nombre' });
  var rol = h('select', {}, ['Lector', 'Revisor', 'Administrador'].map(function (r) { return h('option', { value: r }, r); }));
  var activo = h('input', { type: 'checkbox' }); activo.checked = true; var msg = h('div', { class: 'mensaje' });
  var reenviar = h('button', { class: 'boton', type: 'button', onclick: function () {
    if (!email.value.trim()) { msg.className = 'mensaje error'; msg.textContent = 'Elige primero un usuario de la lista.'; return; }
    rpc('panel_reenviar_invitacion', { p_email: email.value.trim() })
      .then(function () { msg.className = 'mensaje ok'; msg.textContent = 'Invitación pendiente: se enviará en menos de un minuto.'; cargar(false); })
      .catch(function (e) { msg.className = 'mensaje error'; msg.textContent = mensajeError(e); });
  } }, 'Reenviar invitación');
  v.appendChild(h('div', { class: 'tarjeta' }, [h('h2', {}, 'Añadir o cambiar un usuario'),
    h('p', { class: 'sub' }, 'Al guardar un correo nuevo le llega en menos de un minuto un correo para elegir su contraseña. Si no le llega, que mire en el correo no deseado; mientras no haya entrado nunca, «Reenviar invitación» se lo manda otra vez. Para cambiar a alguien, pulsa su correo en la lista.'),
    h('ul', { class: 'roles' }, [h('li', {}, [h('b', {}, 'Lector: '), 've facturas, albaranes y archivos, y descarga Excel (por ejemplo, la gestoría).']),
      h('li', {}, [h('b', {}, 'Revisor: '), 'además corrige fichas, sube documentos y marca revisado.']),
      h('li', {}, [h('b', {}, 'Administrador: '), 'además gestiona usuarios y reglas.'])]),
    h('div', { class: 'formulario-usuario' }, [h('label', {}, ['Correo', email]), h('label', {}, ['Nombre', nombre]), h('label', {}, ['Rol', rol]),
      h('label', { class: 'casilla' }, [activo, 'Puede entrar (desmarca para quitarle el acceso)']),
      h('div', { class: 'en-linea' }, [h('button', { class: 'boton principal', onclick: function () {
        if (!email.value.trim()) { msg.className = 'mensaje error'; msg.textContent = 'Escribe el correo de la persona.'; return; }
        rpc('panel_guardar_usuario', { p_email: email.value.trim(), p_nombre: nombre.value.trim(), p_rol: rol.value, p_activo: activo.checked })
          .then(function () { cargar(true); }).catch(function (e) { msg.className = 'mensaje error'; msg.textContent = mensajeError(e); });
      } }, 'Guardar e invitar'), reenviar])]), msg]));
  v.appendChild(h('p', { class: 'sub' }, ['Para ver cuándo ha entrado cada persona y los intentos con contraseña equivocada, abre ',
    h('button', { type: 'button', class: 'boton enlace', onclick: function () {
      clearTimeout(temporizadorBusqueda); S.vista = 'historial'; S.buscar = ''; S.tipoHis = 'accesos'; S.periodoHis = 'mes'; S.usuarioHis = ''; S.empresaHis = ''; S.pagina = 1;
      pintarMenu(); cargar(true); window.scrollTo(0, 0);
    } }, 'Historial → Entradas al panel'), '.']));
  // El servicio anota "Ya tiene cuenta activa..." cuando la persona ya ha entrado alguna vez (no se le manda invitación)
  function yaTieneCuenta(u) { return String(u.invitacion_error || '').indexOf('Ya tiene cuenta') === 0; }
  function estadoInvitacion(u) {
    if (!u.activo) return 'Desactivado';
    if (yaTieneCuenta(u)) return 'Ya tiene cuenta';
    if (u.invitacion_error) return 'Error al invitar';
    return u.invitado_en ? 'Enviada ' + fecha(String(u.invitado_en).slice(0, 10)) : 'Pendiente de enviar';
  }
  tabla(v, ['Correo', 'Nombre', 'Rol', 'Activo', 'Invitación', 'Último acceso'], usuarios.map(function (u) {
    return { celdas: [u.email, u.nombre, u.rol, u.activo ? 'Sí' : 'No', estadoInvitacion(u), u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'Nunca'], abrir: function () { email.value = u.email; nombre.value = u.nombre || ''; rol.value = u.rol; activo.checked = !!u.activo; email.focus();
      // Al elegir a alguien se dice por qué no le llegó la invitación (si es el caso)
      var motivo = u.activo ? String(u.invitacion_error || '') : '';
      msg.className = motivo && !yaTieneCuenta(u) ? 'mensaje error' : 'mensaje';
      msg.textContent = !motivo ? '' : (yaTieneCuenta(u) ? motivo : 'No se pudo enviar la invitación: ' + motivo); } };
  }));
}
// ---------------------------------------------------------------------
// HISTORIAL (solo administrador): quién ha cambiado qué y cuándo
//  Lee la tabla "auditoria", que rellenan las funciones panel_* de la base de datos
//  en cada cambio. La base de datos solo deja leerla a los administradores y nadie
//  puede borrarla ni modificarla desde el panel.
// ---------------------------------------------------------------------
var ACCIONES = {
  'Guardar ficha': 'Cambió un dato', 'Descartar documento': 'Descartó un documento', 'Guardar ticket': 'Cambió un ticket',
  'Ticket revisado': 'Revisó un ticket', 'Descartar ticket': 'Descartó un ticket', 'Gestionar usuario': 'Cambió un usuario',
  'Reenviar invitacion': 'Reenvió una invitación', 'Regla periodica': 'Cambió una regla periódica', 'Procesar ahora': 'Pidió procesar ahora',
  'Ver documento': 'Abrió un documento', 'Descargar documento': 'Descargó documentos',
  'Entrada': 'Entró en el panel', 'Entrada fallida': 'Contraseña equivocada', 'Entrada sin permiso': 'Intentó entrar sin permiso',
  'Revisar albarán sin factura': 'Revisó un albarán sin factura', 'Tachado manual': 'Tachó a mano y envió a la IA', 'Alta automática': 'Añadido', 'Cambio automático': 'Cambiado', 'Borrado automático': 'Borrado', 'Limpieza del historial': 'Limpieza (más de 2 años)'
};
var ACCESOS_HISTORIAL = ['Entrada', 'Entrada fallida', 'Entrada sin permiso'];
var PROGRAMA_HISTORIAL = ['Alta automática', 'Cambio automático', 'Borrado automático', 'Limpieza del historial'];
// Quién lo hizo cuando no fue una persona desde el panel
var AUTORES_ESPECIALES = { 'Sistema': 'El programa', 'Supabase (a mano)': 'Supabase (a mano)' };
var CONSULTAS_HISTORIAL = ['Ver documento', 'Descargar documento'];
var TIPOS_HISTORIAL = [['cambios', 'Cambios de personas'], ['programa', 'Lo que hace el programa'], ['accesos', 'Entradas al panel'], ['consultas', 'Aperturas y descargas'], ['', 'Todo']];
var TAMANO_HISTORIAL = 100;
function nombreAccion(a) { return ACCIONES[a] || a || '—'; }
function inicioDiaLocal(iso) { return new Date(iso + 'T00:00:00').toISOString(); }   // medianoche de España, no de Londres
function consultaHistorial(f) {
  var q = sb.from('auditoria').select('*', { count: 'exact' });
  var rango = rangoPeriodo(f.periodo);
  if (rango) q = q.gte('fecha', inicioDiaLocal(rango[0])).lt('fecha', inicioDiaLocal(rango[1]));
  if (f.tipo === 'cambios') q = q.not('accion', 'in', '("' + CONSULTAS_HISTORIAL.concat(ACCESOS_HISTORIAL, PROGRAMA_HISTORIAL).join('","') + '")');
  else if (f.tipo === 'programa') q = q.in('accion', PROGRAMA_HISTORIAL);
  else if (f.tipo === 'consultas') q = q.in('accion', CONSULTAS_HISTORIAL);
  else if (f.tipo === 'accesos') q = q.in('accion', ACCESOS_HISTORIAL);
  if (f.usuario) q = q.eq('usuario', f.usuario);
  if (f.empresa) q = q.eq('empresa', f.empresa);
  var b = limpiarBusqueda(f.buscar || '');
  if (b) q = q.or(['id_doc', 'campo', 'antes', 'despues', 'usuario'].map(function (c) { return c + '.ilike.%' + b + '%'; }).join(','));
  return q.order('fecha', { ascending: false }).order('id', { ascending: false });
}
function filtrosHistorial(s) { return { periodo: s.periodoHis, tipo: s.tipoHis, usuario: s.usuarioHis, empresa: s.empresaHis, buscar: s.buscar }; }
function cargarHistorial(s) {
  var f = filtrosHistorial(s), desde = (s.pagina - 1) * TAMANO_HISTORIAL;
  return Promise.all([consulta(consultaHistorial(f).range(desde, desde + TAMANO_HISTORIAL - 1)), consulta(sb.from('usuarios').select('email,nombre').order('email'))])
    .then(function (r) { return { filtros: f, pagina: s.pagina, tamano: TAMANO_HISTORIAL, total: r[0].count || 0, filas: r[0].data || [], usuarios: r[1].data || [] }; });
}
function nombresUsuarios(lista) {
  var m = {}; Object.keys(AUTORES_ESPECIALES).forEach(function (k) { m[k.toLowerCase()] = AUTORES_ESPECIALES[k]; });
  (lista || []).forEach(function (u) { m[String(u.email || '').toLowerCase()] = u.nombre || ''; }); return m;
}
// Columna "Cambio": antes → después; en altas solo lo nuevo y en borrados solo lo que había
function celdaCambio(x) {
  if (ACCESOS_HISTORIAL.indexOf(x.accion) >= 0) return h('span', { class: 'vacio-historial' }, texto(x.despues) || 'Aparato desconocido');
  if (CONSULTAS_HISTORIAL.indexOf(x.accion) >= 0) return h('span', { class: 'vacio-historial' }, 'Solo consulta');
  if (x.accion === 'Alta automática') return h('span', { class: 'cambio-historial' }, valorHistorial(x.despues));
  if (x.accion === 'Borrado automático') return h('span', { class: 'cambio-historial' }, ['Tenía: ', valorHistorial(x.antes)]);
  return h('span', { class: 'cambio-historial' }, [valorHistorial(x.antes), ' → ', valorHistorial(x.despues)]);
}
function fechaHora(iso) { var d = new Date(iso); return isNaN(d) ? texto(iso) : d.toLocaleDateString('es-ES') + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
function valorHistorial(v) {
  var t = texto(v).replace(/\| true$/, '| puede entrar').replace(/\| false$/, '| sin acceso');   // usuarios: activo sí/no
  if (t === '') return h('span', { class: 'vacio-historial' }, '(vacío)');
  return t.length > 160 ? h('span', { title: t }, t.slice(0, 160) + '…') : t;
}
function etiquetaCampo(x) {
  if (x.accion === 'Gestionar usuario' || x.accion === 'Reenviar invitacion') return 'Usuario ' + texto(x.campo);
  if (x.accion === 'Regla periodica') return 'NIF ' + texto(x.campo);
  if (ACCESOS_HISTORIAL.indexOf(x.accion) >= 0) return texto(x.campo) || '—';
  if (CONSULTAS_HISTORIAL.indexOf(x.accion) >= 0) return x.campo === 'tachado' ? 'Copia tachada' : x.campo === 'zip' ? 'ZIP de originales' : x.campo === 'original' ? 'Original' : texto(x.campo);
  return ETIQUETAS[x.campo] || texto(x.campo) || '—';
}
function textoDocumento(x) {
  if (!x.id_doc) return '—';
  return (x.empresa && x.empresa !== '_revision' ? x.empresa + ' · ' : '') + x.id_doc;
}
function abrirDesdeHistorial(x) {
  var titulos = { facturas: 'Factura', albaranes: 'Albarán', revision: 'Revisión' };
  if (titulos[x.hoja] && x.id_doc) { abrirFichaPorId(titulos[x.hoja], x.empresa || '_revision', x.hoja, x.id_doc); return; }
  if (x.hoja === 'tickets' && x.id_doc) {
    abrirModal('Ticket ' + x.id_doc, h('div', { class: 'cargando', role: 'status' }, 'Cargando ticket…'));
    var numero = secuenciaFicha;
    consulta(sb.from('tickets').select('*').eq('id_doc', x.id_doc).maybeSingle()).then(function (r) {
      if (numero !== secuenciaFicha) return;
      if (!r.data) throw new Error('No se encuentra el ticket.');
      fichaTicket(r.data);
    }).catch(function (e) { if (numero === secuenciaFicha) abrirModal('No se ha podido abrir el ticket', h('p', {}, mensajeError(e))); });
  }
}
function sePuedeAbrir(x) { return !!x.id_doc && ['facturas', 'albaranes', 'revision', 'tickets'].indexOf(x.hoja) >= 0; }

function vHistorial(v, d) {
  var nombres = nombresUsuarios(d.usuarios);
  function selector(etiqueta, opciones, valor, cambiar) {
    var s = h('select', { 'aria-label': etiqueta }, opciones.map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    s.value = valor; s.addEventListener('change', function () { clearTimeout(temporizadorBusqueda); cambiar(s.value); S.pagina = 1; cargar(true, true); });
    return h('label', { class: 'campo-corto' }, [etiqueta, s]);
  }
  var personas = [['', 'Todas'], ['Sistema', 'El programa (servicio del ordenador)'], ['Supabase (a mano)', 'Supabase (a mano)']]
    .concat(d.usuarios.map(function (u) { return [u.email, (u.nombre ? u.nombre + ' · ' : '') + u.email]; }));
  if (S.usuarioHis && !personas.some(function (o) { return o[0] === S.usuarioHis; })) personas.push([S.usuarioHis, S.usuarioHis]);
  var buscar = h('input', { id: 'busquedaTabla', type: 'search', maxlength: '100', 'aria-label': 'Buscar en el historial', placeholder: 'Buscar ID de documento, dato o valor…' });
  buscar.value = S.buscar;
  buscar.addEventListener('input', function () { S.buscar = buscar.value; S.pagina = 1; ++secuenciaCarga; clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(function () { cargar(true, true); }, 350); });
  var hayFiltros = S.buscar || S.usuarioHis || S.empresaHis || S.tipoHis !== 'cambios' || S.periodoHis !== 'mes';
  var limpiar = h('button', { type: 'button', class: 'boton enlace', hidden: hayFiltros ? null : 'hidden', onclick: function () {
    S.buscar = ''; S.usuarioHis = ''; S.empresaHis = ''; S.tipoHis = 'cambios'; S.periodoHis = 'mes'; S.pagina = 1; cargar(true);
  } }, 'Quitar filtros');

  // Excel: todo lo filtrado (se lee por páginas de 1000)
  var estadoX = h('span', { class: 'estado-excel', role: 'status' });
  var excel = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    excel.disabled = true; estadoX.textContent = 'Preparando…';
    try {
      var r = await consultaTodo(function () { return consultaHistorial(d.filtros); }), filas = r.data || [];
      var X = await prepararExcel(), libro = new X.Workbook(); libro.creator = 'MCD';
      var hoja = libro.addWorksheet('Historial', { views: [{ state: 'frozen', ySplit: 1 }] });
      hoja.columns = [{ header: 'Fecha y hora', key: 'fecha', width: 19, style: { numFmt: 'dd/mm/yyyy hh:mm:ss' } }, { header: 'Persona', key: 'persona', width: 26 },
        { header: 'Correo', key: 'usuario', width: 30 }, { header: 'Acción', key: 'accion', width: 24 }, { header: 'Empresa', key: 'empresa', width: 12 },
        { header: 'Sección', key: 'hoja', width: 12 }, { header: 'Documento (ID)', key: 'id_doc', width: 22 }, { header: 'Dato', key: 'campo', width: 26 },
        { header: 'Antes', key: 'antes', width: 40 }, { header: 'Después', key: 'despues', width: 40 }];
      filas.forEach(function (x) {
        var d0 = new Date(x.fecha);
        // Excel guarda la hora sin zona: se pasa la hora de España como si fuera UTC para que se vea igual que en el panel
        var local = isNaN(d0) ? null : new Date(d0.getTime() - d0.getTimezoneOffset() * 60000);
        var fila = { fecha: local, persona: nombres[String(x.usuario || '').toLowerCase()] || '', usuario: texto(x.usuario), accion: nombreAccion(x.accion),
          empresa: x.empresa === '_revision' ? '' : texto(x.empresa), hoja: texto(x.hoja), id_doc: texto(x.id_doc), campo: etiquetaCampo(x), antes: texto(x.antes), despues: texto(x.despues) };
        Object.keys(fila).forEach(function (k) { if (typeof fila[k] === 'string' && /^[=+\-@\t\r]/.test(fila[k])) fila[k] = "'" + fila[k]; });
        hoja.addRow(fila);
      });
      hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hoja.getRow(1).eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A4FC4' } }; });
      if (filas.length) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 10 } };
      await guardarLibro(libro, ['MCD', 'Historial', nombrePeriodo(S.periodoHis), new Date().toISOString().slice(0, 10)].join('_'));
      estadoX.textContent = (r.count || 0) > filas.length ? 'Descargadas las ' + filas.length + ' más recientes de ' + r.count + '. Acota las fechas para el resto.' : 'Descargado';
    } catch (e) { estadoX.textContent = 'No se ha descargado: ' + mensajeError(e); }
    finally { excel.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);

  v.appendChild(h('div', { class: 'herramientas' }, [
    h('div', { class: 'fila-herramientas' }, [
      selector('Qué', TIPOS_HISTORIAL, S.tipoHis, function (x) { S.tipoHis = x; }),
      selector('Fecha', PERIODOS, S.periodoHis, function (x) { S.periodoHis = x; }),
      selector('Persona', personas, S.usuarioHis, function (x) { S.usuarioHis = x; }),
      selector('Empresa', [['', 'Todas']].concat(EMPRESAS.map(function (e) { return [e, e]; })), S.empresaHis, function (x) { S.empresaHis = x; })]),
    h('div', { class: 'fila-herramientas' }, [buscar, limpiar, h('span', { class: 'contador' }, contadorTabla(d, 'registros')), h('div', { class: 'descarga-directa' }, [excel, estadoX])])]));

  var cuerpo = h('div', { id: 'cuerpo' }); v.appendChild(cuerpo);
  if (!d.filas.length) {
    cuerpo.appendChild(h('div', { class: 'tarjeta vacio' }, hayFiltros ? 'No hay nada apuntado con estos filtros. Prueba con "Cualquier fecha" o "Todo".' : 'Todavía no hay cambios apuntados este mes.'));
    return;
  }
  tabla(cuerpo, ['Fecha y hora', 'Persona', 'Acción', 'Documento', 'Dato', { t: 'Cambio (antes → después)', largo: 1 }], d.filas.map(function (x) {
    var correo = texto(x.usuario), nombre = nombres[correo.toLowerCase()];
    return {
      abrir: sePuedeAbrir(x) ? function () { abrirDesdeHistorial(x); } : null,
      celdas: [fechaHora(x.fecha), h('span', { title: correo }, nombre || correo || '—'),
        h('span', { class: 'pill ' + (/Descart|fallida|sin permiso|Borrado/.test(x.accion || '') ? 'error' : x.accion === 'Entrada' ? 'ok' : CONSULTAS_HISTORIAL.indexOf(x.accion) >= 0 || PROGRAMA_HISTORIAL.indexOf(x.accion) >= 0 ? '' : 'marca') }, nombreAccion(x.accion)),
        textoDocumento(x), etiquetaCampo(x), celdaCambio(x)]
    };
  }), 'documento');
  paginacion(cuerpo, d);
  cuerpo.appendChild(h('p', { class: 'sub' }, 'Pulsa una fila para abrir ese documento. Al guardar una ficha se apunta una línea por cada dato cambiado.'));
}

// Historial dentro de la ficha de un documento (solo administrador). Se carga al abrirlo.
function historialDocumento(empresa, id) {
  if (S.rol !== 'Administrador' || !id) return null;
  var lista = h('div', { class: 'historial-ficha' }, h('p', { class: 'vacio' }, 'Cargando…')), cargado = false;
  var caja = h('details', { class: 'datos-adicionales historial-documento' }, [h('summary', {}, 'Historial de este documento'), lista]);
  caja.addEventListener('toggle', function () {
    if (!caja.open || cargado) return; cargado = true;
    var empresas = [empresa || '', ''].filter(function (x, i, a) { return a.indexOf(x) === i; });
    Promise.all([consulta(sb.from('auditoria').select('*').eq('id_doc', id).in('empresa', empresas).order('fecha', { ascending: false }).limit(200)),
                 consulta(sb.from('usuarios').select('email,nombre'))]).then(function (r) {
      var filas = r[0].data || [], nombres = nombresUsuarios(r[1].data); lista.textContent = '';
      if (!filas.length) { lista.appendChild(h('p', { class: 'vacio' }, 'Nadie ha cambiado ni abierto este documento desde el panel.')); return; }
      lista.appendChild(h('ul', { class: 'lista-historial' }, filas.map(function (x) {
        var quien = nombres[texto(x.usuario).toLowerCase()] || texto(x.usuario) || '—', consultaDoc = CONSULTAS_HISTORIAL.indexOf(x.accion) >= 0;
        return h('li', {}, [h('span', { class: 'cuando' }, fechaHora(x.fecha)), ' · ', h('b', {}, quien), ' · ', nombreAccion(x.accion)].concat(
          consultaDoc ? [' (' + etiquetaCampo(x) + ')'] : [': ', h('i', {}, etiquetaCampo(x)), ' ', celdaCambio(x)]));
      })));
      lista.appendChild(h('button', { type: 'button', class: 'boton enlace', onclick: function () {
        cerrarModal(); if (document.getElementById('modal').classList.contains('abierto')) return;
        clearTimeout(temporizadorBusqueda);
        S.vista = 'historial'; S.buscar = id; S.tipoHis = ''; S.periodoHis = ''; S.usuarioHis = ''; S.empresaHis = ''; S.pagina = 1; pintarMenu(); cargar(true); window.scrollTo(0, 0);
      } }, 'Ver en la pantalla Historial'));
    }).catch(function (e) { cargado = false; lista.textContent = ''; lista.appendChild(h('p', { class: 'vacio' }, 'No se ha podido cargar: ' + mensajeError(e))); });
  });
  return caja;
}

function exportarOriginales(v) {
  var empresaExportar = h('select', { 'aria-label': 'Empresa de los originales' }, EMPRESAS.map(function (e) { return h('option', { value: e }, e); })), mesExportar = h('input', { type: 'month', 'aria-label': 'Mes de los originales' }); mesExportar.value = S.mes;
  var estado = h('div', { class: 'mensaje' });
  v.appendChild(h('div', { class: 'tarjeta' }, [h('h3', {}, 'Exportar facturas para la gestoría'), h('p', { class: 'sub' }, 'Se descargan los archivos originales del mes elegido en un ZIP.'),
    h('div', { class: 'en-linea' }, [empresaExportar, mesExportar, h('button', { class: 'boton', onclick: function () { exportar(empresaExportar.value, mesExportar.value, estado); } }, 'Descargar originales ZIP')]), estado]));
}
function exportar(empresa, mes, estado) {
  if (!/^\d{4}-\d{2}$/.test(mes)) { estado.className = 'mensaje error'; estado.textContent = 'Selecciona el mes.'; return; }
  estado.className = 'mensaje'; estado.textContent = 'Preparando la exportación…';
  var zip = new JSZip(), total = 0, faltan = [], enElOrdenador = [];
  function meter(f, d, blob) {
    total += blob.size; if (total > 40 * 1024 * 1024) throw new Error('La exportación supera 40 MB; hazla por meses más cortos o descarga los archivos uno a uno.');
    zip.file((f.id_doc + '_' + d.archivo_original).replace(/[\\/:*?"<>|]/g, '_'), blob);
  }
  function traerFaltan() { return traerParaExportar(enElOrdenador, meter, faltan, estado); }
  consulta(sb.from('facturas').select('id_doc,num_factura,fecha,estado').eq('empresa', empresa).gte('fecha', mes + '-01').lt('fecha', siguienteMes(mes)).neq('estado', 'Descartado')).then(function (r) {
    var facturas = r.data || [];
    if (!facturas.length) throw new Error('No hay facturas para esa empresa y mes');
    return consulta(sb.from('documentos').select('id_doc,archivo_original,fecha_alta').eq('empresa', empresa).in('id_doc', facturas.map(function (f) { return f.id_doc; }))).then(function (rd) {
      var docs = {}; (rd.data || []).forEach(function (d) { docs[d.id_doc] = d; });
      return facturas.reduce(function (p, f) {
        return p.then(function () {
          var d = docs[f.id_doc]; if (!d || !d.archivo_original) { faltan.push(f.id_doc); return; }
          var ruta = 'originales/' + String(d.fecha_alta || '').slice(0, 7) + '/' + f.id_doc + '_' + String(d.archivo_original).replace(/[\\\/:*?"<>|#%\[\]{}]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
          return sb.storage.from('documentos').download(ruta).then(function (rb) {
            if (rb.error) { enElOrdenador.push({ f: f, d: d, ruta: ruta }); return; }     // ya no está en la web: se trae
            meter(f, d, rb.data);
          });
        });
      }, Promise.resolve()).then(function () { return traerFaltan(); }).then(function () { return facturas.length; });
    });
  }).then(function (n) {
    if (faltan.length === n) throw new Error('No se ha encontrado ningún archivo original. Los archivos se guardan aquí cuando el servicio los procesa con el almacén nuevo.');
    return rpc('panel_registrar_acceso_archivo', { p_id: empresa + ' ' + mes, p_tipo: 'zip', p_accion: 'Descargar documento' }).then(function () { return zip.generateAsync({ type: 'blob' }); }).then(function (blob) {
      var url = URL.createObjectURL(blob), a = h('a', { href: url, download: 'Facturas_' + empresa + '_' + mes + '.zip' }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      estado.className = 'mensaje ok'; estado.textContent = 'Exportadas ' + (n - faltan.length) + ' facturas' + (faltan.length ? '. Sin archivo: ' + faltan.join(', ') : '.');
    });
  }).catch(function (e) { estado.className = 'mensaje error'; estado.textContent = mensajeError(e); });
}
// Exportación: los originales que ya no están en la web se piden al ordenador y se espera a que lleguen
function traerParaExportar(lista, meter, faltan, estado) {
  if (!lista.length) return Promise.resolve();
  estado.textContent = lista.length + ' archivo(s) están solo en el ordenador. Pidiéndolos… (suele tardar menos de un minuto)';
  return Promise.all(lista.map(function (x) {
    return rpc('panel_pedir_archivo', { p_tipo: 'original', p_id_doc: x.f.id_doc, p_mes: x.ruta.split('/')[1], p_huella: '' }).then(function (r) { x.peticion = r && r.id; }, function () { x.fallo = true; });
  })).then(function () {
    var inicio = Date.now(), pendientes = lista.filter(function (x) { return !x.fallo; });
    lista.filter(function (x) { return x.fallo; }).forEach(function (x) { faltan.push(x.f.id_doc); });
    return new Promise(function (ok, mal) {
      (function mirar() {
        Promise.all(pendientes.map(function (x) {
          return sb.storage.from('documentos').download(x.ruta).then(function (rb) {
            if (!rb.error) { meter(x.f, x.d, rb.data); x.hecho = true; return; }
            return rpc('panel_archivo_pedido', { p_id: x.peticion }).then(function (e) { if (e && e.atendido && e.resultado !== 'Subido') { x.hecho = true; faltan.push(x.f.id_doc); } }, function () {});
          });
        })).then(function () {
          pendientes = pendientes.filter(function (x) { return !x.hecho; });
          if (!pendientes.length) return ok();
          if (Date.now() - inicio > SEGUNDOS_MAX_TRAER * 1000) { pendientes.forEach(function (x) { faltan.push(x.f.id_doc); }); return ok(); }
          estado.textContent = 'Esperando ' + pendientes.length + ' archivo(s) del ordenador…';
          setTimeout(mirar, 4000);
        }, function (e) {
          if (e && /40 MB/.test(e.message)) { mal(e); return; }
          pendientes.forEach(function (x) { faltan.push(x.f.id_doc); }); ok();
        });
      })();
    });
  });
}
function siguienteMes(m) { var a = Number(m.slice(0, 4)), n = Number(m.slice(5, 7)); return n === 12 ? (a + 1) + '-01-01' : a + '-' + String(n + 1).padStart(2, '0') + '-01'; }

// ---------------------------------------------------------------------
// Tabla genérica y ficha de detalle
// ---------------------------------------------------------------------
function tabla(contenedor, columnas, filas, tituloFicha) {
  if (!filas.length) { contenedor.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay datos que mostrar.')); return; }
  function clases(c) { return [c.num ? 'num' : '', c.largo ? 'largo' : ''].join(' ').trim(); }
  var cab = h('tr', {}, columnas.map(function (c) { return h('th', { class: clases(c), scope: 'col' }, c.t !== undefined ? c.t : c); }));
  var cuerpo = h('tbody', {}, filas.map(function (f) {
    var tr = h('tr', { class: f.abrir ? 'abrible' : '' }, f.celdas.map(function (c, i) {
      var obj = c && c.t !== undefined && !(c instanceof Node);
      var col = columnas[i] || {};
      return h('td', { class: clases(col), 'data-etiqueta': col.t !== undefined ? col.t : String(col) }, obj ? c.t : c);
    }));
    var mini = f.mini ? cajaMiniatura(f.mini.hoja, f.mini.id, f.mini.huella) : null;      // la miniatura va delante, en la primera celda
    if (f.abrir) {
      tr.addEventListener('click', f.abrir);
      var celda = tr.cells[0], contenido = celda.textContent.trim();
      var boton = h('button', { type: 'button', class: 'abrir-fila', 'aria-label': 'Abrir ' + (tituloFicha || 'elemento') + (contenido ? ': ' + contenido : ''), onclick: function (e) { e.stopPropagation(); f.abrir(); } });
      if (mini) boton.appendChild(mini);
      while (celda.firstChild) boton.appendChild(celda.firstChild);
      celda.appendChild(boton);
    } else if (mini) tr.cells[0].insertBefore(mini, tr.cells[0].firstChild);
    return tr;
  }));
  var envoltura = h('div', { class: 'tabla' }, h('table', {}, [h('thead', {}, cab), cuerpo]));
  contenedor.appendChild(envoltura); ponerMiniaturas(envoltura);
}

var CAMPOS_FICHA = {
  facturas: [['Datos de la factura', ['tipo_factura', 'num_factura', 'fecha', 'fecha_vencimiento', 'nif', 'nombre', 'matricula', 'concepto']],
             ['Importes', ['base_imponible', 'iva_porcentaje', 'cuota_iva', 'retencion_irpf', 'otros_importes', 'total']],
             ['Cobro o pago', ['estado_cobro_pago', 'importe_cobrado_pagado', 'fecha_cobro_pago']],
             ['Notas de revisión', ['observaciones']]],
  albaranes: [['Datos del albarán', ['tipo_albaran', 'num_albaran', 'fecha', 'nif', 'nombre', 'matricula']],
              ['Servicio y vinculación', ['origen', 'destino', 'concepto', 'importe', 'num_factura']],
              ['Notas de revisión', ['observaciones']]],
  revision: [['Motivo de revisión', ['motivo']]]
};
var ETIQUETAS = { num_factura: 'Número de factura', num_albaran: 'Número de albarán', fecha: 'Fecha del documento', fecha_vencimiento: 'Vencimiento (vacío = No consta)',
  nif: 'NIF del cliente o proveedor', nombre: 'Cliente o proveedor', matricula: 'Matrícula', concepto: 'Concepto del servicio', base_imponible: 'Base imponible (€)',
  iva_porcentaje: 'IVA (%)', cuota_iva: 'Cuota de IVA (€)', retencion_irpf: 'Retención IRPF (€)', otros_importes: 'Otros importes (€)', total: 'Total (€)', importe: 'Importe (€)',
  estado_cobro_pago: 'Estado del cobro o pago', importe_cobrado_pagado: 'Importe cobrado o pagado (€)', fecha_cobro_pago: 'Fecha del movimiento', origen: 'Origen', destino: 'Destino',
  observaciones: 'Observaciones', motivo: 'Motivo de revisión', id_doc: 'ID', empresa: 'Empresa', tipo_factura: 'Tipo (emitida o recibida)', tipo_albaran: 'Tipo (emitido o recibido)', estado: 'Estado', albaranes: 'Albaranes citados',
  comprobacion_albaranes: 'Comprobación de albaranes', estado_factura: 'Estado de facturación', factura_vinculada: 'Factura vinculada', dias_sin_factura: 'Días sin factura',
  posible_factura: 'Posible factura', categoria_gasto: 'Categoría de gasto', creado_en: 'Registrado', actualizado_en: 'Última modificación', fecha_alta: 'Fecha de alta',
  clase: 'Clase (orden_carga = orden de carga)', va_con: 'Va con (pack)', referencias: 'Otras referencias (pedido, CMR…)', propuesta_pack: 'Pack propuesto por el programa', pack_rechazado: 'Packs rechazados', archivo_original: 'Archivo original', hash_sha256: 'Huella del archivo', tokens_entrada: 'Tokens de entrada', tokens_salida: 'Tokens de salida', coste_eur: 'Coste IA (€)' };
var fichaSucia = null, guardandoFicha = false, focoAntesModal = null, secuenciaFicha = 0;

// ---------------------------------------------------------------------
// PACKS: un albarán principal (el que se factura) y sus anexos (papeles que lo acompañan:
// notas de entrega, CMR, PTR...). Un anexo no cuenta como albarán aparte ni espera factura.
// ---------------------------------------------------------------------
function seccionPack(empresa, id, fila, editable) {
  var caja = h('fieldset', { class: 'seccion-ficha seccion-pack' }, [h('legend', {}, 'Pack: papeles que van juntos')]);
  var aviso = h('div', { class: 'mensaje-ficha', role: 'status', 'aria-live': 'polite' });
  var propio = nombreDocumento('albaranes', fila);                 // el nombre de ESTE papel, para preguntas y avisos
  var conocidos = {};                                              // otros albaranes de los que ya se tienen los datos: id -> fila
  function conNombre(otro) { return idConNombre('albaranes', conocidos[otro], otro); }       // "VTX-0059 (Cliente Ejemplo · albarán 67890 · 16/11)"
  // Enlace a otro albarán: se ve su nombre ("Almacenes Ejemplo · albarán 12345 · 16/11 · → Zaragoza") y el ID en pequeño
  function abrir(otro, datos) {
    if (datos) conocidos[otro] = datos;
    var nombre = h('span', {}, etiquetaDocumento('albaranes', conocidos[otro], otro));
    var boton = h('button', { type: 'button', class: 'boton enlace', onclick: function () {
      if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar en esta ficha. ¿Abrir el otro albarán sin guardarlos?')) return;
      fichaSucia = null; abrirFichaPorId('Albarán', empresa, 'albaranes', otro);
    } }, [cajaMiniatura('albaranes', otro), nombre]);
    if (!conocidos[otro]) buscarDocumentos([otro], ['albaranes']).then(function (vistos) {
      if (!vistos[otro]) return;
      conocidos[otro] = vistos[otro].fila; nombre.textContent = ''; nombre.appendChild(etiquetaDocumento('albaranes', conocidos[otro], otro));
    });
    setTimeout(function () { ponerMiniaturas(caja); }, 0);          // cuando el enlace ya está colocado en la ficha
    return boton;
  }
  function fallo(e) { aviso.className = 'mensaje-ficha fallo'; aviso.textContent = mensajeError(e); }
  function terminar(texto) { fichaSucia = null; guardandoFicha = false; cerrarModal(); avisoBreve(texto); cargar(false); }
  function conEnter(campo, boton) { campo.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); boton.click(); } }); }
  if (fila.estado === 'Anexo' && fila.va_con) {
    caja.appendChild(h('p', { class: 'ayuda-campo' }, ['Este papel va con el albarán ', abrir(fila.va_con), ', que es el que se factura. No cuenta como albarán aparte ni espera su propia factura.']));
    if (editable) {
      var soltar = h('button', { type: 'button', class: 'boton', onclick: function () {
        if (!confirm('¿Soltar ' + id + (propio ? ' (' + propio + ')' : '') + ' del pack de ' + conNombre(fila.va_con) + '?\n\nVolverá a contar como un albarán aparte y a esperar su propia factura.')) return;
        soltar.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Soltando…';
        rpc('panel_soltar_albaran', { p_empresa: empresa, p_id: id }).then(function () { terminar('Albarán ' + id + ' suelto del pack'); })
          .catch(function (e) { soltar.disabled = false; fallo(e); });
      } }, 'Soltar del pack');
      caja.appendChild(h('div', { class: 'en-linea' }, [soltar]));
    }
    caja.appendChild(aviso);
    return caja;
  }
  // Propuesta del programa (packs.py): este papel podría ir con otro albarán
  var propuesta = String(fila.propuesta_pack || ''), principalPropuesto = propuesta.split(' · ')[0].trim();
  if (propuesta && principalPropuesto) {
    var motivo = propuesta.slice(principalPropuesto.length).replace(/^\s*·\s*/, '').split(principalPropuesto).join('ese albarán');
    var bloque = h('div', { class: 'propuesta-pack' }, [h('p', {}, [h('b', {}, 'Propuesta del programa: '), '¿este papel va con el albarán ', abrir(principalPropuesto), '?',
      motivo ? h('span', { class: 'sub' }, ' Motivo: ' + motivo + '.') : null])]);
    if (editable) {
      var si = h('button', { type: 'button', class: 'boton principal', onclick: function () {
        si.disabled = no.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Juntando…';
        var destino = conNombre(principalPropuesto);
        rpc('panel_juntar_albaran', { p_empresa: empresa, p_id: id, p_principal: principalPropuesto }).then(function () { terminar('Albarán ' + id + ' va ahora con ' + destino); })
          .catch(function (e) { si.disabled = no.disabled = false; fallo(e); });
      } }, 'Sí, va con ese');
      var no = h('button', { type: 'button', class: 'boton', onclick: function () {
        si.disabled = no.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Guardando…';
        var rechazado = conNombre(principalPropuesto);
        rpc('panel_rechazar_pack', { p_empresa: empresa, p_id: id }).then(function () { terminar('Anotado: ' + id + ' no va con ' + rechazado + ' (no se volverá a proponer)'); })
          .catch(function (e) { si.disabled = no.disabled = false; fallo(e); });
      } }, 'No va con ese');
      bloque.appendChild(h('div', { class: 'en-linea' }, [si, no]));
    }
    caja.appendChild(bloque);
  }
  var lista = h('ul', { class: 'lista-pack', 'aria-label': 'Anexos de este albarán' }, h('li', { class: 'sub' }, 'Buscando sus anexos…'));
  var propuestos = h('div', { class: 'propuesta-pack', hidden: 'hidden' });
  function pintarPropuestos() {
    return consulta(sb.from('albaranes').select(COLUMNAS_NOMBRE_ALBARAN + ',propuesta_pack').eq('empresa', empresa).ilike('propuesta_pack', id + ' ·%').order('id_doc')).then(function (r) {
      var filas = (r.data || []).filter(function (x) { return ['Descartado', 'Duplicado', 'Anexo'].indexOf(x.estado || '') < 0; });
      propuestos.textContent = ''; propuestos.hidden = !filas.length;
      if (!filas.length) return;
      propuestos.appendChild(h('p', {}, h('b', {}, 'El programa propone que vayan con este albarán:')));
      var lista2 = h('ul', { class: 'lista-pack' }, filas.map(function (x) { return h('li', {}, abrir(x.id_doc, x)); }));
      propuestos.appendChild(lista2);
      if (!editable) return;
      var todos = h('button', { type: 'button', class: 'boton principal', onclick: function () {
        todos.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Juntando…';
        var hechos = [];
        filas.reduce(function (cadena, x) {
          return cadena.then(function () { return rpc('panel_juntar_albaran', { p_empresa: empresa, p_id: x.id_doc, p_principal: id }).then(function () { hechos.push(x.id_doc); }); });
        }, Promise.resolve()).then(function () { aviso.className = 'mensaje-ficha exito'; aviso.textContent = 'Añadido al pack: ' + hechos.join(', ') + '.'; })
          .catch(function (e) { aviso.className = 'mensaje-ficha fallo'; aviso.textContent = (hechos.length ? 'Añadido: ' + hechos.join(', ') + '. ' : '') + mensajeError(e); })
          .then(function () { pintarAnexos(); pintarPropuestos(); cargar(false); });
      } }, 'Juntarlos todos');
      propuestos.appendChild(h('div', { class: 'en-linea' }, [todos, h('span', { class: 'sub' }, 'Si alguno no va, ábrelo y pulsa «No va con ese».')]));
    }).catch(function () { propuestos.hidden = true; });
  }
  function pintarAnexos(antes) {            // antes: se espera a que también estén las propuestas, para que todo salga a la vez
    return Promise.all([consulta(sb.from('albaranes').select(COLUMNAS_NOMBRE_ALBARAN).eq('empresa', empresa).eq('va_con', id).order('id_doc')), antes]).then(function (rs) {
      var filas = rs[0].data || []; lista.textContent = '';
      if (!filas.length) lista.appendChild(h('li', { class: 'sub' }, 'Va solo: no tiene anexos.'));
      filas.forEach(function (x) { lista.appendChild(h('li', {}, abrir(x.id_doc, x))); });
      return filas.length;
    }).catch(function () { lista.textContent = ''; lista.appendChild(h('li', { class: 'sub' }, 'No se han podido cargar los anexos.')); return 0; });
  }
  caja.appendChild(lista); caja.appendChild(propuestos); pintarAnexos(pintarPropuestos());
  if (editable && ['Descartado', 'Duplicado'].indexOf(fila.estado || '') < 0) {
    // Para juntar papeles ya no hay que saberse los ID: se buscan por número, nombre o destino y se marcan en una lista.
    // (Quien se sepa el ID puede seguir escribiéndolo: VTX-0040, VTX-0049.)
    var candidatos = [], cargados = false, pedido = null, marcados = {}, elegido = '';
    function pareceId(x) { return /^[A-Za-z]{2,}-[A-Za-z0-9]+$/.test(x); }
    function escritos(campo) { return campo.value.split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
    function cargarCandidatos() {              // los demás albaranes sueltos de la empresa; primero los que llegaron más cerca de este
      if (!pedido) pedido = consulta(sb.from('albaranes').select(COLUMNAS_NOMBRE_ALBARAN + ',referencias').eq('empresa', empresa).order('id_doc', { ascending: false }).limit(400)).then(function (r) {
        candidatos = (r.data || []).filter(function (x) { return x.id_doc !== id && ['Descartado', 'Duplicado', 'Anexo'].indexOf(x.estado || '') < 0; })
          .sort(function (a, b) { return Math.abs(numeroId(a.id_doc) - numeroId(id)) - Math.abs(numeroId(b.id_doc) - numeroId(id)); });
        candidatos.forEach(function (x) { conocidos[x.id_doc] = x; });
        cargados = true;
      }).catch(function () { cargados = true; });
      return pedido;
    }
    function coincide(x, buscado) {
      return [x.id_doc, x.num_albaran, x.nombre, x.destino, x.origen, x.referencias].some(function (v) { return texto(v).toLowerCase().indexOf(buscado) >= 0; });
    }
    function pintarElegir(ul, campo, varios) {
      var buscado = campo.value.trim().toLowerCase(), todas = candidatos.filter(function (x) { return !buscado || coincide(x, buscado); }), filas = todas.slice(0, 8);
      ul.textContent = ''; ul.hidden = false;
      if (!cargados) { ul.appendChild(h('li', { class: 'sub' }, 'Buscando albaranes…')); return; }
      if (!candidatos.length) { ul.appendChild(h('li', { class: 'sub' }, 'No hay otros albaranes sueltos en ' + empresa + '.')); return; }
      if (!filas.length) { ul.appendChild(h('li', { class: 'sub' }, 'Ninguno coincide con «' + campo.value.trim() + '». Prueba con su número, el nombre o el destino.')); return; }
      filas.forEach(function (x) {
        var entrada = h('input', { type: varios ? 'checkbox' : 'radio', name: varios ? null : 'elegirPrincipal', value: x.id_doc });
        entrada.checked = varios ? !!marcados[x.id_doc] : elegido === x.id_doc;
        entrada.addEventListener('change', function () {
          if (!varios) { elegido = x.id_doc; return; }
          if (entrada.checked) marcados[x.id_doc] = true; else delete marcados[x.id_doc];
        });
        ul.appendChild(h('li', {}, h('label', { class: 'casilla' }, [entrada, cajaMiniatura('albaranes', x.id_doc), etiquetaDocumento('albaranes', x, x.id_doc)])));
      });
      ponerMiniaturas(ul);
      if (todas.length > filas.length) ul.appendChild(h('li', { class: 'sub' }, 'Hay ' + (todas.length - filas.length) + ' más: escribe su número, el nombre o el destino para encontrarlo.'));
    }
    function conLista(campo, ul, varios) {
      function pintar() { pintarElegir(ul, campo, varios); cargarCandidatos().then(function () { pintarElegir(ul, campo, varios); }); }
      campo.addEventListener('focus', pintar); campo.addEventListener('input', pintar);
    }
    // 1) Añadir anexos a este albarán (se pueden marcar varios)
    var nuevos = h('input', { type: 'text', id: 'campoAnexos', autocomplete: 'off', spellcheck: 'false', placeholder: 'Busca por número, nombre o destino' });
    var listaNuevos = h('ul', { class: 'elegir-pack', hidden: 'hidden', 'aria-label': 'Albaranes que se pueden añadir a este pack' });
    var anadir = h('button', { type: 'button', class: 'boton', onclick: function () {
      var ids = Object.keys(marcados), tecleados = escritos(nuevos);
      if (!ids.length && tecleados.length && tecleados.every(pareceId)) ids = tecleados.map(function (x) { return x.toUpperCase(); });
      if (!ids.length) { fallo(new Error('Marca en la lista los papeles que van con este albarán. Si no salen, escribe su número, el nombre o el destino para buscarlos.')); nuevos.focus(); return; }
      anadir.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Añadiendo…';
      var hechos = [];
      ids.reduce(function (cadena, otro) {
        return cadena.then(function () { return rpc('panel_juntar_albaran', { p_empresa: empresa, p_id: otro, p_principal: id }).then(function () { hechos.push(otro); }); });
      }, Promise.resolve()).then(function () {
        aviso.className = 'mensaje-ficha exito'; aviso.textContent = 'Añadido al pack: ' + hechos.join(', ') + '.'; nuevos.value = '';
      }).catch(function (e) {
        aviso.className = 'mensaje-ficha fallo'; aviso.textContent = (hechos.length ? 'Añadido: ' + hechos.join(', ') + '. ' : '') + mensajeError(e);
      }).then(function () {
        anadir.disabled = false; marcados = {}; pedido = null; cargados = false; listaNuevos.hidden = true; listaPrincipal.hidden = true;   // la lista de sueltos ha cambiado
        pintarAnexos(); cargar(false);
      });
    } }, 'Añadir al pack');
    conEnter(nuevos, anadir); conLista(nuevos, listaNuevos, true);
    caja.appendChild(h('div', { class: 'campo-ficha fila-pack' }, [h('label', { for: 'campoAnexos' }, 'Añadir papeles que van con este albarán'), h('div', { class: 'en-linea' }, [nuevos, anadir]), listaNuevos]));
    // 2) O al revés: este papel acompaña a otro albarán
    var principal = h('input', { type: 'text', id: 'campoPrincipal', autocomplete: 'off', spellcheck: 'false', placeholder: 'Busca por número, nombre o destino' });
    var listaPrincipal = h('ul', { class: 'elegir-pack', hidden: 'hidden', 'aria-label': 'Albaranes con los que puede ir este papel' });
    var vaCon = h('button', { type: 'button', class: 'boton', onclick: function () {
      var tecleados = escritos(principal), otro = elegido || (tecleados.length === 1 && pareceId(tecleados[0]) ? tecleados[0].toUpperCase() : '');
      if (!otro) { fallo(new Error('Elige en la lista el albarán principal (el que se factura). Si no sale, escribe su número, el nombre o el destino para buscarlo.')); principal.focus(); return; }
      vaCon.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Juntando…';
      rpc('panel_juntar_albaran', { p_empresa: empresa, p_id: id, p_principal: otro }).then(function (r) { var final = (r && r.principal) || otro; terminar('Albarán ' + id + ' va ahora con ' + conNombre(final)); })
        .catch(function (e) { vaCon.disabled = false; fallo(e); });
    } }, 'Va con ese albarán');
    conEnter(principal, vaCon); conLista(principal, listaPrincipal, false);
    caja.appendChild(h('div', { class: 'campo-ficha fila-pack' }, [h('label', { for: 'campoPrincipal' }, '¿Este papel acompaña a otro albarán? Elige el principal (el que se factura)'), h('div', { class: 'en-linea' }, [principal, vaCon]), listaPrincipal]));
  }
  caja.appendChild(aviso);
  return caja;
}

// En la ficha de un albarán: decir si en realidad es una orden de carga (o al revés). Solo quien puede revisar.
function seccionClase(empresa, id, fila, editable) {
  var orden = esOrdenDeCarga(fila);
  if (!orden && (!editable || ['Descartado', 'Duplicado'].indexOf(fila.estado || '') >= 0)) return null;
  var aviso = h('div', { class: 'mensaje-ficha', role: 'status', 'aria-live': 'polite' });
  var caja = h('fieldset', { class: 'seccion-ficha seccion-clase' }, [h('legend', {}, orden ? 'Es una orden de carga' : '¿Es una orden de carga?'),
    h('p', { class: 'ayuda-campo' }, orden
      ? 'Este papel es una orden de carga (el encargo de hacer un porte), no un albarán: se guarda aparte, no cuenta como albarán y no espera factura. Puede ir en el pack de su albarán.'
      : 'Una orden de carga es el encargo de hacer un porte, no la prueba de la entrega. Si este papel lo es, márcalo: dejará de contar como albarán y de esperar factura.')]);
  if (editable) {
    var boton = h('button', { type: 'button', class: 'boton', onclick: function () {
      if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar en esta ficha. ¿Seguir sin guardarlos?')) return;
      boton.disabled = true; aviso.className = 'mensaje-ficha'; aviso.textContent = 'Guardando…';
      rpc('panel_clase_albaran', { p_empresa: empresa, p_id: id, p_orden: !orden }).then(function () {
        fichaSucia = null; guardandoFicha = false; cerrarModal();
        avisoBreve(id + (orden ? ' vuelve a ser un albarán: espera su factura' : ' guardado como orden de carga: ya no cuenta como albarán')); cargar(true);
      }).catch(function (e) { boton.disabled = false; aviso.className = 'mensaje-ficha fallo'; aviso.textContent = mensajeError(e); });
    } }, orden ? 'No, es un albarán' : 'Sí, es una orden de carga');
    caja.appendChild(h('div', { class: 'en-linea' }, [boton]));
  }
  caja.appendChild(aviso);
  return caja;
}

function ficha(titulo, fila, contexto) {
  var empresa = contexto.empresa, hoja = contexto.hoja, id = fila.id_doc || '';
  if (hoja === 'albaranes' && esOrdenDeCarga(fila)) titulo = 'Orden de carga';
  var base = Object.assign({}, fila), entradas = {}, pendientes = 0;
  var editable = !!(hoja && id && (S.rol === 'Revisor' || S.rol === 'Administrador'));
  var grupos = CAMPOS_FICHA[hoja] || [], conocidos = []; grupos.forEach(function (g) { conocidos = conocidos.concat(g[1]); });
  var formulario = h('form', { 'aria-label': 'Datos del documento' }), mensaje = h('div', { class: 'mensaje-ficha', role: 'status', 'aria-live': 'polite' });
  var estado = pillEstado(fila.estado || 'Sin estado'), indicador = h('span', { class: 'cambios-ficha' }, editable ? 'Sin cambios pendientes' : 'Consulta de solo lectura');
  var pie = h('div', { class: 'pie-revision' }, [indicador, mensaje]);
  var opcionesDocumento = h('div', { class: 'opciones-documento' }), visor = h('div', { class: 'visor-documento' }, h('p', { class: 'vacio' }, 'Buscando el archivo del documento…'));
  var estadoArchivo = h('div', { class: 'enlaces-documento' });
  var panelDocumento = h('section', { class: 'vista-documento', 'aria-label': 'Documento para comprobar' }, [h('div', { class: 'cab-documento' }, [h('h3', {}, 'Documento'), opcionesDocumento]), visor, estadoArchivo]);
  var resumen = h('div', { class: 'resumen-importes', role: 'status' });
  // Para los avisos de abajo: " (Almacenes Ejemplo · nº 12345)" detrás del ID, con los datos ya guardados
  function quienEs() {
    if (hoja !== 'facturas' && hoja !== 'albaranes') return '';
    var numero = texto(hoja === 'facturas' ? base.num_factura : base.num_albaran).trim(), quien = texto(base.nombre).replace(/\s+/g, ' ').trim().slice(0, 28);
    var partes = [quien, numero ? 'nº ' + numero.slice(0, 20) : ''].filter(Boolean);
    return partes.length ? ' (' + partes.join(' · ') + ')' : '';
  }
  function valorEntrada(c) {
    if (c === 'estado_cobro_pago' && !base[c]) return 'Pendiente';      // vacío = Pendiente (no es un cambio)
    return c === 'fecha_vencimiento' && (base[c] === null || base[c] === undefined) ? '' : texto(base[c]);
  }
  function cambiosActuales() { var cambios = {}; Object.keys(entradas).forEach(function (c) { if (entradas[c].value !== valorEntrada(c)) cambios[c] = entradas[c].value; }); return cambios; }
  function actualizarPendientes() {
    pendientes = Object.keys(cambiosActuales()).length;
    indicador.textContent = pendientes ? pendientes + ' campo' + (pendientes === 1 ? ' modificado' : 's modificados') : editable ? 'Sin cambios pendientes' : 'Consulta de solo lectura';
    if (guardar) guardar.disabled = !pendientes || guardandoFicha;
    if (hoja === 'facturas') {
      function n(c) { var v = entradas[c] ? entradas[c].value : base[c]; return Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); }
      var calculado = n('base_imponible') + n('cuota_iva') - n('retencion_irpf') + n('otros_importes'), diferencia = n('total') - calculado;
      resumen.className = 'resumen-importes ' + (Number.isFinite(diferencia) && Math.abs(diferencia) <= 0.02 ? 'cuadra' : 'diferencia');
      resumen.textContent = Number.isFinite(diferencia) ? 'Base + IVA − retención + otros = ' + euros(calculado) + (Math.abs(diferencia) > 0.02 ? ' · Diferencia con el total: ' + euros(diferencia) : ' · Coincide con el total') : 'Comprueba los importes introducidos.';
    }
  }
  grupos.forEach(function (grupo, i) {
    var seccion = h('fieldset', { class: 'seccion-ficha' }, [h('legend', {}, (i + 1) + '. ' + grupo[0])]), rejilla = h('div', { class: 'campos-ficha' });
    grupo[1].forEach(function (c) {
      var largo = ['concepto', 'observaciones', 'motivo'].indexOf(c) >= 0, etiqueta = ETIQUETAS[c] || c, valor = valorEntrada(c);
      if (!editable) { rejilla.appendChild(h('div', { class: 'campo-ficha' + (largo ? ' campo-ancho' : '') }, [h('span', { class: 'etiqueta-ficha' }, etiqueta), h('div', { class: 'valor-ficha' }, c === 'fecha_vencimiento' ? vence(base[c]) : /^fecha/.test(c) ? fecha(valor) || '—' : valor || '—')])); return; }
      var entrada;
      if (c === 'estado_cobro_pago') entrada = h('select', { id: 'campo-' + c }, ['Pendiente', 'Parcial', 'Pagado', 'Cobrado'].map(function (x) { return h('option', { value: x }, x); }));
      else if (c === 'tipo_factura' || c === 'tipo_albaran') {      // emitido = lo hace la empresa; recibido = de un proveedor
        var tipos = c === 'tipo_factura' ? [['Emitida', 'Emitida (la hace la empresa)'], ['Recibida', 'Recibida (de un proveedor)']]
                                         : [['Emitido', 'Emitido (viaje o servicio nuestro)'], ['Recibido', 'Recibido (de un proveedor)']];
        if (!valor) tipos.unshift(['', 'Sin indicar']);
        entrada = h('select', { id: 'campo-' + c }, tipos.map(function (x) { return h('option', { value: x[0] }, x[1]); }));
      }
      else if (largo) entrada = h('textarea', { id: 'campo-' + c, rows: c === 'concepto' ? '3' : '4' });
      else entrada = h('input', { id: 'campo-' + c, type: /^fecha/.test(c) ? 'date' : 'text' });
      if (/base|cuota|retencion|otros|total|importe|porcentaje/.test(c)) entrada.setAttribute('inputmode', 'decimal');
      entrada.value = c === 'estado_cobro_pago' && !valor ? 'Pendiente' : valor; entradas[c] = entrada;
      entrada.addEventListener('input', actualizarPendientes); entrada.addEventListener('change', actualizarPendientes);
      rejilla.appendChild(h('div', { class: 'campo-ficha' + (largo ? ' campo-ancho' : '') }, [h('label', { for: 'campo-' + c }, etiqueta), entrada]));
    });
    seccion.appendChild(rejilla);
    if (grupo[0] === 'Importes') seccion.appendChild(resumen);
    if (grupo[0] === 'Cobro o pago') seccion.appendChild(h('p', { class: 'ayuda-campo' }, 'Puedes guardar juntos el estado, el importe y la fecha real del cobro o pago.'));
    formulario.appendChild(seccion);
  });
  var clase = hoja === 'albaranes' && id ? seccionClase(empresa, id, fila, editable) : null; if (clase) formulario.appendChild(clase);
  if (hoja === 'albaranes' && id) formulario.appendChild(seccionPack(empresa, id, fila, editable));
  if (id) formulario.appendChild(seccionRelacionados(empresa, hoja, fila));
  var otros = h('div', { class: 'otros-datos' });
  Object.keys(fila).filter(function (c) { return conocidos.indexOf(c) < 0 && c !== 'hash_sha256'; }).forEach(function (c) {
    var v = fila[c]; if (/^fecha|_en$/.test(c)) v = c.slice(-3) === '_en' ? fecha(v) + ' ' + hora(v) : fecha(v);
    otros.appendChild(h('div', { class: 'campo-ficha' }, [h('span', { class: 'etiqueta-ficha' }, ETIQUETAS[c] || c), h('div', { class: 'valor-ficha' }, texto(v) || '—')]));
  });
  formulario.appendChild(h('details', { class: 'datos-adicionales' }, [h('summary', {}, 'Otros datos del documento'), otros]));
  var historialFicha = historialDocumento(empresa, id); if (historialFicha) formulario.appendChild(historialFicha);
  var zona = h('div', { class: 'zona-revision' }, [panelDocumento, h('section', { class: 'editor-documento' }, [
    h('div', { class: 'resumen-ficha' }, [h('span', { class: 'pill marca' }, empresa === '_revision' ? 'Revisión' : empresa), estado]),
    h('p', { class: 'ayuda-campo' }, editable ? 'Edita directamente los campos. Al guardar se comprueban todos los cambios.' : 'Puedes consultar todos los datos y el documento. Tu rol no permite editarlos.'), formulario])]);
  var guardar = null, marcar = null, descartar = null;
  function ocupado(v) { guardandoFicha = v; formulario.querySelectorAll('input,select,textarea').forEach(function (e) { e.disabled = v; }); if (marcar) marcar.disabled = v; if (descartar) descartar.disabled = v; actualizarPendientes(); }
  function guardarCambios(revisar) {
    if (guardandoFicha) return;
    var cambios = cambiosActuales(), esperados = { estado: base.estado === undefined ? null : base.estado };
    Object.keys(cambios).forEach(function (c) { esperados[c] = base[c] === undefined ? null : base[c]; });
    if (!revisar && !Object.keys(cambios).length) return;
    mensaje.className = 'mensaje-ficha'; mensaje.textContent = 'Guardando cambios…'; ocupado(true);
    rpc('panel_guardar_ficha', { p_empresa: empresa, p_hoja: hoja, p_id: id, p_cambios: cambios, p_esperados: esperados, p_revisar: revisar }).then(function (r) {
      if (!r || r.ok !== true || !r.fila || String(r.fila.id_doc) !== String(id)) throw new Error('No se ha podido confirmar el guardado. Tus cambios siguen en pantalla; vuelve a intentarlo.');
      // Un albarán que espera su factura: al revisarlo deja de avisar otros DIAS_AVISO_ALBARAN días
      if (revisar && hoja === 'albaranes' && r.fila.estado_factura === 'PENDIENTE DE FACTURA')
        return rpc('panel_posponer_aviso_albaran', { p_empresa: empresa, p_id: id }).then(function () { return r; });
      return r;
    }).then(function (r) {
      base = Object.assign({}, r.fila);
      Object.keys(entradas).forEach(function (c) { entradas[c].value = c === 'estado_cobro_pago' && !base[c] ? 'Pendiente' : valorEntrada(c); });
      estado.textContent = base.estado || 'Sin estado'; estado.className = 'pill ' + (base.estado === 'Procesado' ? 'ok' : 'aviso');
      ocupado(false);
      if (revisar) {                                   // revisado: la ficha se cierra sola y se avisa abajo
        fichaSucia = null; cerrarModal(); avisoBreve(titulo + ' ' + id + quienEs() + (/^(Factura|Revisi|Orden)/.test(titulo) ? ' revisada' : ' revisado') + (Object.keys(cambios).length ? ' y cambios guardados' : ''));
        cargar(false); return;
      }
      mensaje.className = 'mensaje-ficha exito'; mensaje.textContent = 'Cambios guardados.';
      cargar(false);
    }).catch(function (e) { mensaje.className = 'mensaje-ficha fallo'; mensaje.textContent = mensajeError(e); ocupado(false); });
  }
  if (editable) {
    guardar = h('button', { type: 'button', class: 'boton principal', onclick: function () { guardarCambios(false); } }, 'Guardar cambios');
    marcar = h('button', { type: 'button', class: 'boton revisar', onclick: function () { guardarCambios(true); } }, 'Guardar y marcar revisado');
    descartar = h('button', { type: 'button', class: 'boton peligro', onclick: function () {
      if (guardandoFicha || !confirm('¿Quieres descartar este documento? Los cambios sin guardar no se aplicarán.')) return;
      ocupado(true); mensaje.textContent = 'Descartando documento…';
      rpc('panel_descartar', { p_empresa: empresa, p_hoja: hoja, p_id: id }).then(function (r) {
        var sueltos = r && Number(r.anexos_sueltos) || 0;      // era el principal de un pack: sus papeles vuelven a estar sueltos
        pendientes = 0; fichaSucia = null; guardandoFicha = false; cerrarModal();
        avisoBreve(titulo + ' ' + id + quienEs() + ' descartado' + (sueltos ?'. Sus ' + sueltos + ' papel' + (sueltos === 1 ? '' : 'es') + ' del pack vuelve' + (sueltos === 1 ? '' : 'n') + ' a estar suelto' + (sueltos === 1 ? '' : 's') : ''));
        cargar(true); })
        .catch(function (e) { mensaje.textContent = mensajeError(e); mensaje.className = 'mensaje-ficha fallo'; ocupado(false); });
    } }, 'Descartar');
    // Revisión manual: volver a leer el documento tal como llegó (sin tacharlo a mano)
    var releer = null;
    if (hoja === 'revision' && base.estado === 'Reintentar') {
      pie.appendChild(h('p', { class: 'ayuda-campo aviso-tachado' }, 'Ya se ha pedido volver a leerlo. En uno o dos minutos saldrá de esta lista y aparecerá como factura, albarán o ticket (o volverá aquí si sigue sin poder leerse).'));
    } else if (hoja === 'revision') {
      releer = h('button', { type: 'button', class: 'boton', title: 'El programa lo lee otra vez tal como llegó, con el mismo tachado automático', onclick: function () {
        if (guardandoFicha || !confirm('¿Volver a leer este documento tal como llegó?\n\nÚsalo si crees que ahora el programa lo leerá bien (por ejemplo, tras una mejora o si falló por un corte). Tarda uno o dos minutos. Si lo que falta es tapar datos personales, usa «Tachar y enviar a la IA».')) return;
        ocupado(true); releer.disabled = true; mensaje.className = 'mensaje-ficha'; mensaje.textContent = 'Pidiendo que se vuelva a leer…';
        rpc('panel_reintentar_revision', { p_rev: id }).then(function () { pendientes = 0; fichaSucia = null; guardandoFicha = false; cerrarModal(); avisoBreve(titulo + ' ' + id + ': se volverá a leer en uno o dos minutos'); cargar(true); })
          .catch(function (e) { mensaje.textContent = mensajeError(e); mensaje.className = 'mensaje-ficha fallo'; ocupado(false); releer.disabled = false; });
      } }, 'Volver a leer');
    }
    pie.appendChild(h('div', { class: 'acciones-revision' }, (releer ? [releer] : []).concat([descartar, guardar, marcar])));
    formulario.addEventListener('submit', function (e) { e.preventDefault(); guardarCambios(false); });
  }
  var ampliar = h('button', { class: 'boton', 'aria-pressed': 'false', onclick: function () {
    var solo = document.getElementById('caja').classList.toggle('modo-datos'); ampliar.setAttribute('aria-pressed', String(solo)); ampliar.textContent = solo ? 'Ver documento y datos' : 'Ampliar formulario';
  } }, 'Ampliar formulario');
  abrirModal(tituloFicha(titulo, hoja, fila), h('div', { class: 'contenido-revision' }, [zona, pie]), ampliar);
  document.getElementById('caja').classList.add('revision-amplia');
  fichaSucia = function () { return editable && pendientes > 0; }; actualizarPendientes();
  // Archivos del documento: original y copia tachada (en el almacén de Supabase)
  var numero = secuenciaFicha;
  localizarArchivos(empresa, hoja, id).then(function (d) {
    if (numero !== secuenciaFicha) return;
    opcionesDocumento.textContent = ''; estadoArchivo.textContent = '';
    var pedidoVisor = 0;                    // si se pulsa "Original" y enseguida "Copia tachada", manda la última pulsación
    function mostrar(tipo, archivo) {
      var mio = ++pedidoVisor;
      if (!archivo.enWeb) {
        cerrarVisor();
        avisoEnElOrdenador(visor, archivo.pedido, archivo.buscar, function (traido) {
          if (numero !== secuenciaFicha) return;
          d[tipo === 'original' ? 'original' : 'tachado'] = traido; mostrar(tipo, traido);
        });
        return;
      }
      cerrarVisor(); visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'Abriendo…'));
      rpc('panel_registrar_acceso_archivo', { p_id: id, p_tipo: tipo, p_accion: 'Ver documento' }).then(function () { return urlFirmada(archivo.ruta); }).then(function (url) {
        if (numero !== secuenciaFicha || mio !== pedidoVisor) return;
        crearVisor(visor, url, archivo.nombre); estadoArchivo.textContent = '';
        var enGrande = document.getElementById('caja').classList.contains('modo-documento');
        estadoArchivo.appendChild(h('button', { type: 'button', class: 'boton', onclick: function () {
          var solo = document.getElementById('caja').classList.toggle('modo-documento'); this.textContent = solo ? 'Volver a los datos' : 'Ver documento en grande';
        } }, enGrande ? 'Volver a los datos' : 'Ver documento en grande'));
        if (S.rol === 'Administrador') estadoArchivo.appendChild(h('button', { class: 'boton', onclick: function () { descargar(archivo.ruta, archivo.nombre); } }, 'Descargar'));
      }).catch(function () { if (numero !== secuenciaFicha || mio !== pedidoVisor) return; visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); });
    }
    [['Original', 'original', 'original'], ['Copia tachada', 'tachado', 'tachado']].forEach(function (x) { if (d[x[2]]) opcionesDocumento.appendChild(h('button', { class: 'boton', type: 'button', onclick: function () { mostrar(x[1], d[x[2]]); } }, x[0])); });
    // Revisión manual: tacharlo a mano y enviarlo a la IA (PDF o foto)
    if (hoja === 'revision' && editable && d.original && ENVIADOS_TACHADO[id]) {
      panelDocumento.appendChild(h('p', { class: 'ayuda-campo aviso-tachado' }, 'Ya se envió la copia tachada a la IA. En un minuto saldrá de esta lista y aparecerá como factura, albarán o ticket.'));
    } else if (hoja === 'revision' && editable && d.original) {
      var tachable = /\.(pdf|jpe?g|png|webp|gif|bmp)$/i.test(d.original.nombre);
      panelDocumento.appendChild(h('div', { class: 'aviso-tachado' }, [      // fuera de estadoArchivo: la vista previa lo vacía al cargar
        h('button', { type: 'button', class: 'boton principal', disabled: tachable ? null : 'disabled', onclick: function () {
          if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar en la ficha. ¿Seguir sin guardarlos?')) return;
          fichaSucia = null;
          if (d.original.enWeb) { abrirTachado(id, d.original); return; }
          mostrar('original', d.original);           // primero hay que traerlo del ordenador
        } }, 'Tachar y enviar a la IA'),
        h('span', { class: 'sub' }, tachable ? 'Si no se leyó bien: tapa a mano los datos personales y envíalo.' : 'Este tipo de archivo no se puede tachar aquí (solo PDF o fotos).')]));
    }
    if (d.original) mostrar('original', d.original); else if (d.tachado) mostrar('tachado', d.tachado);
    else { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'No hay archivo guardado para este documento.')); }
  }).catch(function () { if (numero === secuenciaFicha) { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); } });
}
// ---------------------------------------------------------------------
// TACHAR A MANO Y ENVIAR A LA IA (documentos de revisión que el programa no lee bien)
//  - Se dibujan recuadros negros encima de cada página.
//  - Al enviar, el navegador crea una copia NUEVA: cada página es una imagen con el
//    negro ya pintado encima (no se puede quitar) y sin texto escondido.
//  - Antes de subirla se apunta su huella (panel_registrar_tachado_manual): solo así
//    el servicio la acepta. El servicio vuelve a tachar y comprobar por su cuenta.
//  - El original sin tachar no sale de la revisión.
// ---------------------------------------------------------------------
var ENVIADOS_TACHADO = {};    // revisión -> cuándo se envió su copia tachada (mientras el servicio la lee)
var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
var PDFJS_SRI = 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e';
var PDFJS_WORKER_SRI = 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2';
var bibliotecaPdf;
function prepararPdf() {
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions.workerSrc) return Promise.resolve(window.pdfjsLib);
  if (!bibliotecaPdf) bibliotecaPdf = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = PDFJS_URL + 'pdf.min.js'; script.integrity = PDFJS_SRI; script.crossOrigin = 'anonymous';
    script.onload = function () {
      // El "trabajador" de pdf.js se descarga comprobando su huella y se usa desde una copia local
      fetch(PDFJS_URL + 'pdf.worker.min.js', { integrity: PDFJS_WORKER_SRI }).then(function (r) { if (!r.ok) throw new Error(); return r.blob(); })
        .then(function (b) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b); resolve(window.pdfjsLib); })
        .catch(function () { bibliotecaPdf = null; reject(new Error('No se pudo cargar el lector de PDF. Comprueba la conexión.')); });
    };
    script.onerror = function () { bibliotecaPdf = null; script.remove(); reject(new Error('No se pudo cargar el lector de PDF. Comprueba la conexión.')); };
    document.head.appendChild(script);
  });
  return bibliotecaPdf;
}
var ANCHO_TACHADO = 1600, MAX_PAGINAS_TACHADO = 15;
function lienzo(ancho, alto) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(ancho)); c.height = Math.max(1, Math.round(alto)); return c; }
// Páginas del original como imágenes (lienzos) a ~1600 px de ancho
async function paginasComoImagen(url, nombre) {
  var datos = await fetch(url).then(function (r) { if (!r.ok) throw new Error('No se pudo descargar el documento'); return r.arrayBuffer(); });
  if (/\.pdf$/i.test(nombre)) {
    var pdfjs = await prepararPdf();
    var doc = await pdfjs.getDocument({ data: new Uint8Array(datos), isEvalSupported: false }).promise;
    if (doc.numPages > MAX_PAGINAS_TACHADO) throw new Error('El documento tiene ' + doc.numPages + ' páginas (máximo ' + MAX_PAGINAS_TACHADO + ').');
    var paginas = [];
    for (var i = 1; i <= doc.numPages; i++) {
      var pg = await doc.getPage(i), v1 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(3, ANCHO_TACHADO / v1.width) });
      var c = lienzo(vp.width, vp.height), cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: cx, viewport: vp }).promise;
      paginas.push(c);
    }
    return paginas;
  }
  var img = await createImageBitmap(new Blob([datos]));
  var esc = Math.min(1, 2000 / img.width), c2 = lienzo(img.width * esc, img.height * esc), cx2 = c2.getContext('2d');
  cx2.fillStyle = '#fff'; cx2.fillRect(0, 0, c2.width, c2.height); cx2.drawImage(img, 0, 0, c2.width, c2.height);
  return [c2];
}
// PDF sencillo con una imagen JPEG por página (sin texto)
function pdfDeJpegs(paginas) {
  var enc = new TextEncoder(), partes = [], total = 0, offsets = [];
  function add(x) { var b = typeof x === 'string' ? enc.encode(x) : x; partes.push(b); total += b.length; }
  function obj(n, cuerpo, flujo) { offsets[n] = total; add(n + ' 0 obj\n' + cuerpo); if (flujo) { add('\nstream\n'); add(flujo); add('\nendstream'); } add('\nendobj\n'); }
  add('%PDF-1.4\n'); add(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));
  var n = paginas.length, kids = [];
  for (var i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
  paginas.forEach(function (p, i) {
    var pw = 595, ph = Math.round(595 * p.alto / p.ancho * 100) / 100, base = 3 + i * 3;
    var contenido = enc.encode('q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q');
    obj(base, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 ' + (base + 2) + ' 0 R >> >> /Contents ' + (base + 1) + ' 0 R >>');
    obj(base + 1, '<< /Length ' + contenido.length + ' >>', contenido);
    obj(base + 2, '<< /Type /XObject /Subtype /Image /Width ' + p.ancho + ' /Height ' + p.alto + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>', p.jpeg);
  });
  var xref = total, filas = ['xref\n0 ' + (3 + n * 3) + '\n0000000000 65535 f \n'];
  for (var k = 1; k < 3 + n * 3; k++) filas.push(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
  add(filas.join('') + 'trailer\n<< /Size ' + (3 + n * 3) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(partes, { type: 'application/pdf' });
}
function abrirTachado(revId, archivo) {
  var estado = h('p', { class: 'vacio', role: 'status' }, 'Preparando el documento…');
  var zona = h('div', { class: 'tachado-paginas' }, estado);
  var contador = h('span', { class: 'tachado-contador' }, '0 recuadros');
  var historia = [], paginas = [];
  var deshacer = h('button', { type: 'button', class: 'boton', disabled: 'disabled', onclick: function () {
    var i = historia.pop(); if (i === undefined) return; paginas[i].recuadros.pop(); pintarPagina(paginas[i]); actualizar(); } }, 'Deshacer el último');
  var confirma = h('input', { type: 'checkbox', id: 'tachadoConfirma' });
  var enviar = h('button', { type: 'button', class: 'boton principal', disabled: 'disabled', onclick: function () { enviarTachado(); } }, 'Enviar a la IA');
  var mensaje = h('div', { class: 'mensaje-ficha', role: 'status' });
  confirma.addEventListener('change', actualizar);
  function total() { return paginas.reduce(function (s, p) { return s + p.recuadros.length; }, 0); }
  function actualizar() {
    var n = total(); contador.textContent = n + (n === 1 ? ' recuadro' : ' recuadros');
    deshacer.disabled = !historia.length; enviar.disabled = !confirma.checked || !paginas.length;
  }
  function pintarPagina(p, previa) {
    var cx = p.vista.getContext('2d'); cx.drawImage(p.base, 0, 0); cx.fillStyle = '#000';
    p.recuadros.forEach(function (r) { cx.fillRect(r[0], r[1], r[2], r[3]); });
    if (previa) { cx.fillStyle = 'rgba(0,0,0,.65)'; cx.fillRect(previa[0], previa[1], previa[2], previa[3]);
      cx.strokeStyle = '#e11d48'; cx.lineWidth = Math.max(2, p.vista.width / 400); cx.strokeRect(previa[0], previa[1], previa[2], previa[3]); }
  }
  function prepararDibujo(p, i) {
    var inicio = null;
    function punto(e) { var r = p.vista.getBoundingClientRect(); return [(e.clientX - r.left) * p.vista.width / r.width, (e.clientY - r.top) * p.vista.height / r.height]; }
    function caja(a, b) { return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])]; }
    p.vista.addEventListener('pointerdown', function (e) { e.preventDefault(); inicio = punto(e); p.vista.setPointerCapture(e.pointerId); });
    p.vista.addEventListener('pointermove', function (e) { if (inicio) pintarPagina(p, caja(inicio, punto(e))); });
    p.vista.addEventListener('pointerup', function (e) {
      if (!inicio) return; var c = caja(inicio, punto(e)); inicio = null;
      var m = Math.max(2, p.vista.width / 600);                       // un poco de margen alrededor
      if (c[2] > 6 && c[3] > 6) { p.recuadros.push([c[0] - m, c[1] - m, c[2] + 2 * m, c[3] + 2 * m]); historia.push(i); }
      pintarPagina(p); actualizar();
    });
    p.vista.addEventListener('pointercancel', function () { inicio = null; pintarPagina(p); });
  }
  async function enviarTachado() {
    var n = total();
    if (!n && !confirm('No has tapado nada. ¿Seguro que este documento no tiene ningún dato personal?')) return;
    enviar.disabled = true; deshacer.disabled = true; mensaje.className = 'mensaje-ficha'; mensaje.textContent = 'Preparando la copia tachada…';
    try {
      var salida = [];
      for (var p of paginas) {
        var c = lienzo(p.base.width, p.base.height), cx = c.getContext('2d');
        cx.drawImage(p.base, 0, 0); cx.fillStyle = '#000'; p.recuadros.forEach(function (r) { cx.fillRect(r[0], r[1], r[2], r[3]); });   // el negro queda pintado en la imagen
        var blob = await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', 0.88); });
        salida.push({ ancho: c.width, alto: c.height, jpeg: new Uint8Array(await blob.arrayBuffer()) });
      }
      var pdf = pdfDeJpegs(salida);
      if (pdf.size > 15 * 1024 * 1024) throw new Error('La copia tachada pesa más de 15 MB.');
      var fichero = new File([pdf], 'tachado_' + revId + '.pdf', { type: 'application/pdf' });
      var huella = await huellaArchivo(fichero);
      mensaje.textContent = 'Registrando la copia…';
      await rpc('panel_registrar_tachado_manual', { p_rev: revId, p_huella: huella, p_paginas: salida.length, p_recuadros: n });
      fichaSucia = null; cerrarModal(); avisoBreve('Copia tachada de ' + revId + ' enviada: el servicio la leerá en un minuto');
      ENVIADOS_TACHADO[revId] = Date.now();
      subirArchivos([fichero]);                     // sin cambiar de pantalla: se sigue en Pendientes
      if (S.vista === 'revision') pintar(); else irA('revision');
    } catch (e) { mensaje.className = 'mensaje-ficha fallo'; mensaje.textContent = 'No se ha enviado: ' + mensajeError(e); enviar.disabled = !confirma.checked; deshacer.disabled = !historia.length; }
  }
  var cuerpo = h('div', { class: 'contenido-tachado' }, [
    h('p', { class: 'ayuda-campo' }, 'Arrastra con el ratón o el dedo para tapar en negro los datos personales: DNI o NIE, nombres de conductores, ' +
      'números de cuenta (IBAN), correos y teléfonos de personas. Lo que tapes no lo verá la IA. Los datos de las empresas (nombre, CIF, importes) déjalos a la vista.'),
    h('div', { class: 'tachado-herramientas' }, [deshacer, contador]), zona,
    h('div', { class: 'pie-revision' }, [h('label', { class: 'casilla tachado-confirma', for: 'tachadoConfirma' }, [confirma,
      ' He revisado todas las páginas y he tapado todos los datos personales']), mensaje, h('div', { class: 'acciones-revision' }, [enviar])])]);
  abrirModal('Tachar y enviar a la IA · ' + revId, cuerpo);
  document.getElementById('caja').classList.add('revision-amplia');
  fichaSucia = function () { return total() > 0; };
  var numero = secuenciaFicha;
  urlFirmada(archivo.ruta).then(function (url) { return paginasComoImagen(url, archivo.nombre); }).then(function (lienzos) {
    if (numero !== secuenciaFicha) return;
    zona.textContent = '';
    lienzos.forEach(function (base, i) {
      var vista = lienzo(base.width, base.height); vista.className = 'tachado-lienzo';
      vista.setAttribute('aria-label', 'Página ' + (i + 1) + ': arrastra para tapar');
      var p = { base: base, vista: vista, recuadros: [] }; paginas.push(p);
      pintarPagina(p); prepararDibujo(p, i);
      zona.appendChild(h('figure', { class: 'tachado-pagina' }, [vista, h('figcaption', {}, 'Página ' + (i + 1) + ' de ' + lienzos.length)]));
    });
    actualizar();
  }).catch(function (e) { if (numero === secuenciaFicha) { estado.textContent = 'No se puede abrir para tachar: ' + mensajeError(e); } });
}

// Dónde guarda el servicio los archivos: originales/AAAA-MM/<id>_<nombre> · tachados/<huella>_tachado.pdf
function localizarArchivos(empresa, hoja, id) {
  var q = hoja === 'revision' ? sb.from('revision').select('archivo_original,hash_sha256,fecha_alta').eq('id_doc', id)
                              : sb.from('documentos').select('archivo_original,hash_sha256,fecha_alta').eq('empresa', empresa).eq('id_doc', id).limit(1);
  return consulta(q.maybeSingle()).then(function (r) {
    var d = r.data || {}, mes = String(d.fecha_alta || '').slice(0, 7);
    function buscarOriginal() {
      if (!mes) return Promise.resolve(null);
      return sb.storage.from('documentos').list('originales/' + mes, { limit: 5, search: id + '_' }).then(function (l) {
        var x = !l.error && (l.data || []).filter(function (o) { return o.id && o.name.indexOf(id + '_') === 0; })[0];
        return x ? { ruta: 'originales/' + mes + '/' + x.name, nombre: x.name.slice(id.length + 1), enWeb: true } : null;
      });
    }
    var tachado = d.hash_sha256 ? { ruta: 'tachados/' + d.hash_sha256 + '_tachado.pdf', nombre: id + '_tachado.pdf' } : null;
    function buscarTachado() { return existe(tachado).then(function (si) { return si ? Object.assign({}, tachado, { enWeb: true }) : null; }); }
    return Promise.all([buscarOriginal(), buscarTachado()]).then(function (ok) {
      // Lo que ya no está en la web sigue en el ordenador: se ofrece traerlo
      var original = ok[0] || (mes && d.archivo_original ? { ruta: 'originales/' + mes + '/' + id + '_' + nombreSeguro(d.archivo_original), nombre: String(d.archivo_original),
        enWeb: false, pedido: { tipo: 'original', id_doc: id, mes: mes }, buscar: buscarOriginal } : null);
      var copia = ok[1] || (tachado ? Object.assign({}, tachado, { enWeb: false, pedido: { tipo: 'tachado', id_doc: id, huella: d.hash_sha256 }, buscar: buscarTachado }) : null);
      return { original: original, tachado: copia };
    });
  });
}
function existe(archivo) {
  if (!archivo) return Promise.resolve(false);
  var partes = archivo.ruta.split('/'), nombre = partes.pop();
  return sb.storage.from('documentos').list(partes.join('/'), { limit: 1, search: nombre }).then(function (r) { return !r.error && (r.data || []).some(function (x) { return x.name === nombre; }); });
}

// Aviso breve abajo de la pantalla (por ejemplo, tras marcar un documento como revisado)
function avisoBreve(texto) {
  var viejo = document.getElementById('avisoBreve'); if (viejo) viejo.remove();
  var aviso = h('div', { id: 'avisoBreve', class: 'aviso-flotante', role: 'status' }, [h('span', { class: 'punto ok' }), texto]);
  document.body.appendChild(aviso);
  setTimeout(function () { aviso.classList.add('saliendo'); setTimeout(function () { aviso.remove(); }, 400); }, 3500);
}
function abrirModal(titulo, contenido, extra) {
  ++secuenciaFicha; cerrarVisor();
  if (!document.getElementById('modal').classList.contains('abierto')) focoAntesModal = document.activeElement;
  fichaSucia = null; guardandoFicha = false;
  var caja = document.getElementById('caja'); caja.textContent = ''; caja.className = 'caja';
  var cerrar = h('button', { class: 'boton cerrar-modal', onclick: cerrarModal }, 'Cerrar');
  caja.appendChild(h('div', { class: 'cab' }, [h('h3', { id: 'tituloModal' }, titulo), extra || null, cerrar]));
  caja.appendChild(contenido);
  document.getElementById('modal').classList.add('abierto'); document.body.style.overflow = 'hidden'; cerrar.focus();
}
function cerrarModal() {
  if (guardandoFicha) return;
  if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar. ¿Cerrar sin guardarlos?')) return;
  ++secuenciaFicha; fichaSucia = null; cerrarVisor(); document.getElementById('modal').classList.remove('abierto'); document.body.style.overflow = '';
  if (focoAntesModal && focoAntesModal.isConnected) focoAntesModal.focus();
}
document.getElementById('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', function (e) {
  if (!document.getElementById('modal').classList.contains('abierto')) return;
  if (e.key === 'Escape') { e.preventDefault(); cerrarModal(); }
  if (e.key === 'Tab') {
    var el = [].slice.call(document.getElementById('caja').querySelectorAll('button,input,select,textarea,a[href],summary,iframe,[tabindex="0"]')).filter(function (x) { return !x.disabled && x.getClientRects().length; });
    var primero = el[0], ultimo = el[el.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); } else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }
});
document.getElementById('btnActualizar').addEventListener('click', function () { cargar(true, true); });
prepararSubidaGlobal();

// ---------------------------------------------------------------------
// Arranque: ¿hay sesión? → panel; si no → pantalla de entrada
// ---------------------------------------------------------------------
function arrancar() {
  ++secuenciaCarga;
  S.denegado = false; S.vista = 'inicio'; S.rol = null;
  sb.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) { pantallaAcceso('entrar'); return; }
    document.getElementById('vista').textContent = ''; document.getElementById('vista').appendChild(h('div', { class: 'cargando' }, 'Cargando…'));
    rpc('panel_registrar_entrada').catch(function () {});   // queda en el Historial (una vez por sesión y día); si falla, el panel sigue
    cargar(true);
  });
}
// Enlaces que llegan por correo: invitación (primera contraseña) o recuperación de contraseña
var errorEnlace = /error_description=([^&]+)/.exec(location.hash);
if (errorEnlace) {
  history.replaceState(null, '', location.pathname);
  pantallaAcceso('entrar', { tipo: 'error', texto: /expired|invalid/i.test(decodeURIComponent(errorEnlace[1]))
    ? 'El enlace del correo ha caducado o ya se usó. Pide al administrador que te reenvíe la invitación, o usa "He olvidado la contraseña".'
    : 'No se ha podido usar el enlace del correo. Pide una invitación nueva al administrador.' });
} else if (/type=(invite|recovery)/.test(location.hash)) {
  var mostrada = false;
  sb.auth.onAuthStateChange(function (evento, sesion) {
    if (!mostrada && sesion && (evento === 'PASSWORD_RECOVERY' || evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION')) { mostrada = true; pantallaAcceso('nueva'); }
  });
  setTimeout(function () { if (!mostrada) pantallaAcceso('entrar', { tipo: 'error', texto: 'El enlace no es válido o ha caducado.' }); }, 8000);
} else arrancar();
function ocupadoConExcel() {
  return [].some.call(document.querySelectorAll('.boton.descarga'), function (b) { return b.disabled; }) ||
    !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('.tarjeta-excel, .herramientas'));
}
setInterval(function () {
  if (ocupadoConExcel()) return;
  var escribiendo = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (S.rol && !S.denegado && !document.getElementById('modal').classList.contains('abierto') && !escribiendo && !document.hidden) cargar(false);
}, 30000);
