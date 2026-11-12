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
function pillEstado(t) {
  t = texto(t);
  var c = /PENDIENTE|Sin factura|Faltan|≠|ERROR/.test(t) ? 'error' : /Revisar|revisar|Duplicado|revisión|Revisión/.test(t) ? 'aviso' : /Procesado|Facturado|recibidos/.test(t) ? 'ok' : '';
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
  return sb.rpc(fn, args || {}).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
}
function consulta(q) { return q.then(function (r) { if (r.error) throw new Error(r.error.message); return r; }); }

// ---------------------------------------------------------------------
// Estado de la pantalla
// ---------------------------------------------------------------------
var EMPRESAS = [];
var S = { vista: 'inicio', empresa: null, todasEmpresas: true, buscar: '', filtro: 'Activos', periodo: '', periodoComb: 'mes', periodoTck: '', estadoTck: '', catTck: 'comidas', pagina: 1, carpeta: '', mes: mesActual(), datos: null, pendientes: 0, rol: null, usuario: null, denegado: false,
  periodoHis: 'mes', tipoHis: 'cambios', usuarioHis: '', empresaHis: '' };
var VISTAS = [['inicio', 'Inicio'], ['facturas', 'Facturas'], ['albaranes', 'Albaranes'], ['revision', 'Pendientes'], ['combustible', 'Combustible'], ['tickets', 'Tickets'], ['documentos', 'Archivos'], ['negocio', 'Vencimientos']];
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
  albaranes: [['empresa', 'Empresa'], ['num_albaran', 'Número de albarán'], ['fecha', 'Fecha', FECHA], ['nif', 'NIF'], ['nombre', 'Cliente / proveedor'],
    ['matricula', 'Matrícula'], ['origen', 'Origen'], ['destino', 'Destino'], ['concepto', 'Concepto'], ['importe', 'Importe (€)', EUR],
    ['estado_factura', 'Facturación'], ['factura_vinculada', 'Factura vinculada'], ['dias_sin_factura', 'Días sin factura'], ['estado', 'Estado'],
    ['observaciones', 'Observaciones'], ['id_doc', 'ID interno']]
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

// Consulta de facturas o albaranes con los mismos filtros que la pantalla.
// f = { tabla, empresa ('' = todas), filtro, buscar, periodo }
function consultaLista(f) {
  var tabla = f.tabla, campo = tabla === 'facturas' ? 'estado' : 'estado_factura';
  var q = sb.from(tabla).select('*', { count: 'exact' });
  if (f.empresa) q = q.eq('empresa', f.empresa);
  if (f.filtro === 'Activos') q = q.not('estado', 'in', '("Descartado","Duplicado")');
  else if (f.filtro === 'Descartado' || f.filtro === 'Duplicado') q = q.eq('estado', f.filtro);
  else if (f.filtro) q = q.eq(campo, f.filtro);
  var rango = rangoPeriodo(f.periodo);
  if (rango) q = q.gte('fecha', rango[0]).lt('fecha', rango[1]);
  var b = limpiarBusqueda(f.buscar || '');
  if (b) {
    var cols = tabla === 'facturas' ? ['id_doc', 'num_factura', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'albaranes']
                                    : ['id_doc', 'num_albaran', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'num_factura', 'origen', 'destino'];
    q = q.or(cols.map(function (c) { return c + '.ilike.%' + b + '%'; }).join(','));
  }
  return q.order('fecha', { ascending: false, nullsFirst: false }).order('empresa').order('id_doc', { ascending: false });
}
function filtrosPantalla() {
  return { tabla: S.vista, empresa: S.todasEmpresas ? '' : S.empresa, filtro: S.filtro, buscar: S.buscar, periodo: S.periodo };
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
  return filas;
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
    totales[cols[0][0]] = 'TOTAL (' + filas.length + ')';
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
      await guardarLibro(libro, ['MCD', TITULO_EXCEL[f.tabla], f.empresa || 'todas', f.periodo ? nombrePeriodo(f.periodo) : '', new Date().toISOString().slice(0, 10)].filter(Boolean).join('_'));
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
      estado.textContent = 'Descargado: ' + facturas.length + ' facturas y ' + albaranes.length + ' albaranes';
    } catch (err) { estado.textContent = 'No se ha descargado: ' + mensajeError(err); }
    finally { boton.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);
  return h('section', { class: 'tarjeta tarjeta-excel', 'aria-label': 'Excel para la gestoría' }, [
    h('div', { class: 'tarjeta-titulo' }, [h('span', { class: 'icono-redondo verde' }, iconoPanel('excel')), h('div', {}, [h('h2', {}, 'Excel para la gestoría'),
      h('p', { class: 'sub' }, 'Un archivo con el resumen por empresa, todas las facturas y todos los albaranes del periodo.')])]),
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
    excel:'M4 3h11l5 5v13H4z M14 3v6h6 M8 12l5 6 M13 12l-5 6', subir:'M12 16V4 M7 9l5-5 5 5 M4 15v5h16v-5', usuarios:'M8 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 7a3 3 0 0 1 0 6 M17 16a5 5 0 0 1 5 5'
  };
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('class','icono-panel');
  path.setAttribute('d', trazos[vista]); svg.appendChild(path); return svg;
}

function pintarMenu() {
  var nav = document.getElementById('menu'); nav.textContent = '';
  if (!S.rol) return;
  var secciones = VISTAS.slice();
  if (S.rol === 'Administrador') secciones.push(['usuarios', 'Usuarios'], ['historial', 'Historial']);
  var movil = h('select', { 'aria-label': 'Ir a sección', class: 'nav-movil' }, secciones.map(function (v) {
    return h('option', { value: v[0] }, v[1]);
  }));
  movil.value = S.vista; movil.addEventListener('change', function () { irA(movil.value); });
  if (puedeSubir()) nav.appendChild(h('button', { type: 'button', class: 'nav-subir', title: 'Facturas, albaranes, tickets o tablas de precios',
    onclick: function () { var e = document.getElementById('subidaGlobal'); if (e) e.click(); } }, [iconoPanel('subir'), 'Subir documentos']));
  nav.appendChild(movil);
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
  cont.appendChild(document.createTextNode(u.nombre || u.email || ''));
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
  var ayuda = { entrar: 'El acceso es solo por invitación. Si aún no la tienes, pídesela al administrador.',
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
  var solicitud = { numero: ++secuenciaCarga, vista: S.vista, empresa: S.empresa, todasEmpresas: !!S.todasEmpresas, carpeta: S.carpeta, mes: S.mes, pagina: S.pagina, buscar: S.buscar, filtro: S.filtro, periodo: S.periodo, periodoComb: S.periodoComb, periodoTck: S.periodoTck, estadoTck: S.estadoTck,
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
    if (solicitud.vista === 'inicio') { if (d.diasAvisoAlbaran) DIAS_AVISO_ALBARAN = d.diasAvisoAlbaran; pintarCabecera(d); S.pendientes = contarPendientes(d); pintarMenu(); }
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
  var f = { tabla: s.vista, empresa: s.todasEmpresas ? '' : s.empresa, filtro: s.filtro, buscar: s.buscar, periodo: s.periodo };
  return consulta(consultaLista(f).range(desde, desde + 49)).then(function (r) {
    return { filtros: f, paginada: true, pagina: s.pagina, tamano: 50, total: r.count || 0, filas: r.data || [] };
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
    revision: 'Pendientes de revisar', combustible: 'Combustible', tickets: 'Tickets', documentos: 'Archivos', negocio: 'Vencimientos y costes', usuarios: 'Usuarios del panel', historial: 'Historial de cambios' };
  var ayudas = { inicio: 'Esto es lo que hay hoy en el sistema.', facturas: 'Pulsa una factura para verla y corregirla. El botón Excel descarga lo que ves filtrado.',
    albaranes: 'Pulsa un albarán para verlo. El botón Excel descarga lo que ves filtrado.', revision: 'Documentos que necesitan que alguien los mire.',
    combustible: 'Cada repostaje de las facturas de gasolinera comparado con el precio de ese día en la tabla que llega por correo.',
    tickets: 'Gastos generales (gasolina, comidas, aparcamientos…). No son de ninguna empresa. Sube la foto y se lee sola.',
    documentos: 'Los originales y las copias tachadas que se enviaron a la IA.', negocio: 'Pagos y cobros vencidos, coste por camión y movimientos del mes.',
    usuarios: 'Quién puede entrar al panel. El acceso es solo por invitación.',
    historial: 'Quién ha cambiado qué y cuándo: lo que hacen las personas en el panel y lo que hace el programa solo. Nadie puede borrarlo ni modificarlo; se guarda 2 años (protección de datos).' };
  vista.appendChild(h('div', { class: 'cab-vista' }, [h('div', {}, [h('h1', {}, titulos[S.vista]), h('p', { class: 'sub' }, ayudas[S.vista])])]));
  ({ inicio: vInicio, facturas: vFacturas, albaranes: vAlbaranes, revision: vRevision, combustible: vCombustible, tickets: vTickets, documentos: vDocumentos, usuarios: vUsuarios, negocio: vNegocio, historial: vHistorial })[S.vista](vista, S.datos);
  if (busqueda && document.getElementById('busquedaTabla')) { var n = document.getElementById('busquedaTabla'); n.focus(); n.setSelectionRange(cursor, cursor); }
}

// ---------------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------------
function vInicio(v, d) {
  var s = d.servicio || {};
  function sumar(campo) { return d.empresas.reduce(function (n, e) { return n + Number(e[campo] || 0); }, 0); }
  function tarjeta(clave, nombre, valor, ayuda, color) {
    return h('button', { type: 'button', class: 'metrica ' + color, onclick: function () { S.todasEmpresas = true; irA(clave); } }, [
      h('span', { class: 'icono-redondo ' + color }, iconoPanel(clave)),
      h('span', { class: 'metrica-texto' }, [h('strong', {}, String(valor)), h('span', { class: 'metrica-nombre' }, nombre), h('span', { class: 'metrica-ayuda' }, ayuda)])]);
  }
  var pendientes = contarPendientes(d);
  v.appendChild(h('div', { class: 'metricas' }, [
    tarjeta('revision', 'Pendientes de revisar', pendientes, pendientes ? 'Pulsa para verlos' : 'Todo al día', pendientes ? 'naranja' : 'verde'),
    tarjeta('facturas', 'Facturas', sumar('facturas'), sumar('emitidas') + ' emitidas · ' + sumar('recibidas') + ' recibidas', 'azul'),
    tarjeta('albaranes', 'Albaranes', sumar('albaranes'), sumar('pendientes') + ' esperando factura' + (sumar('tardanFactura') ? ' · ' + sumar('tardanFactura') + ' con retraso' : ''), 'cian')]));

  var columnas = h('div', { class: 'inicio-columnas' });
  var izquierda = h('div', { class: 'columna' }), derecha = h('div', { class: 'columna' });
  columnas.appendChild(izquierda); columnas.appendChild(derecha); v.appendChild(columnas);

  izquierda.appendChild(tarjetaExcelGestoria());
  if (S.rol === 'Revisor' || S.rol === 'Administrador') izquierda.appendChild(tarjetaSubir());

  // Empresas: lo esencial a la vista, sin desplegables
  derecha.appendChild(h('section', { class: 'tarjeta' }, [h('h2', {}, 'Empresas'), h('div', { class: 'lista-empresas' }, d.empresas.map(function (e) {
    return h('div', { class: 'empresa-fila' }, [
      h('div', { class: 'empresa-nombre' }, [h('b', {}, e.nombre), e.cif ? h('span', { class: 'sub' }, 'CIF ' + e.cif) : null]),
      h('div', { class: 'empresa-datos' }, [
        h('button', { type: 'button', class: 'dato', onclick: function () { S.empresa = e.nombre; S.todasEmpresas = false; irA('facturas'); } }, [h('b', {}, String(e.facturas || 0)), ' facturas']),
        h('button', { type: 'button', class: 'dato', onclick: function () { S.empresa = e.nombre; S.todasEmpresas = false; irA('albaranes'); } }, [h('b', {}, String(e.albaranes || 0)), ' albaranes']),
        Number(e.documentosConAvisos) ? h('button', { type: 'button', class: 'dato aviso', onclick: function () { irA('revision'); } }, [h('b', {}, String(e.documentosConAvisos)), ' por revisar']) : null])]);
  }))]));

  // Últimos documentos (pulsables)
  derecha.appendChild(h('section', { class: 'tarjeta' }, [h('h2', {}, 'Últimos documentos'), d.ultimos.length ? h('ul', { class: 'ultimos' }, d.ultimos.map(function (x) {
    return h('li', {}, [h('span', { class: 'ultimo-id' }, x.id), h('span', { class: 'ultimo-archivo' }, x.archivo || ''), h('span', { class: 'ultimo-empresa' }, x.empresa), pillEstado(x.estado), h('span', { class: 'ultimo-fecha' }, fecha(x.fecha))]);
  })) : h('p', { class: 'vacio' }, 'Aún no ha llegado ningún documento.')]));

  // Estado del servicio en una línea
  var vivo = s.conocido && (Date.now() - new Date(s.latido).getTime()) < 3 * 60 * 1000;
  v.appendChild(h('p', { class: 'linea-servicio' }, s.conocido ? [
    h('span', { class: 'punto ' + (vivo ? 'ok' : 'error') }), vivo ? 'Servicio en marcha' : 'Servicio parado (¿está encendido el ordenador?)',
    ' · última señal ' + hora(s.latido), ' · Gmail ' + (s.gmail_conectado ? 'conectado' : 'desconectado'),
    s.ultima_vuelta ? ' · última vuelta ' + hora(s.ultima_vuelta.hora) : '', ' · coste de la IA este mes ' + costeEuros(d.costeMes)
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
    var f = await consulta(sb.from('facturas').select('id_doc,estado,tipo_factura').eq('empresa', x.empresa).eq('id_doc', x.id_doc).limit(1));
    if (f.data && f.data[0]) return { hoja: 'facturas', titulo: 'Factura', empresa: x.empresa, id: x.id_doc, estado: f.data[0].estado };
    var a = await consulta(sb.from('albaranes').select('id_doc,estado').eq('empresa', x.empresa).eq('id_doc', x.id_doc).limit(1));
    if (a.data && a.data[0]) return { hoja: 'albaranes', titulo: 'Albarán', empresa: x.empresa, id: x.id_doc, estado: a.data[0].estado };
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
function textoRegistro(x) {
  if (x.hoja === 'revision') return 'necesita revisión manual (' + (x.motivo || 'no se pudo leer') + ')';
  if (x.repetido) return 'REPETIDO: este documento ya estaba registrado' + (x.original ? ' como ' + x.original + ' de ' + x.empresa : ' en ' + x.empresa) + '. No se ha añadido otra vez.';
  if (x.hoja === 'tickets') {
    var rep = /Posible repetido de (TCK-\d+)/.exec(x.ticket.observaciones || '');
    return 'Ticket ' + x.id + ' · ' + x.ticket.categoria + (x.ticket.total !== null && x.ticket.total !== undefined ? ' · ' + euros(x.ticket.total) : '') +
      (rep ? ' · ¿REPETIDO? Se parece a ' + rep[1] + ': revísalo' : x.estado === 'Revisar' ? ' · revisar' : '');
  }
  return x.titulo + ' ' + x.id + (x.empresa && x.empresa !== '_revision' ? ' de ' + x.empresa : '') + (x.estado ? ' · ' + x.estado : '');
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
        if (/^tachado_/.test(s.nombre) && x.hoja && x.hoja !== 'revision') avisoBreve(s.nombre.replace(/^tachado_|\.pdf$/g, '') + ' ya está leído: ' + textoRegistro(x).split(' · ')[0] + '. Pulsa "Abrir" para revisar sus datos.');
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
    h('label', { class: 'boton-grande principal', for: 'camaraSubir' }, [iconoPanel('camara'), h('span', {}, [h('b', {}, 'Hacer foto'), h('small', {}, 'Ticket, factura o albarán en papel')])]),
    h('label', { class: 'boton-grande', for: 'archivoSubir' }, [iconoPanel('subir'), h('span', {}, [h('b', {}, 'Elegir archivos'), h('small', {}, 'O arrástralos a cualquier parte de la página')])])]);
  [archivo, camara].forEach(function (inp) { inp.addEventListener('change', function () { if (inp.files.length) { var fs = Array.from(inp.files); inp.value = ''; subirArchivos(fs); } }); });
  var procesar = h('button', { type: 'button', class: 'boton', onclick: function () {
    rpc('panel_procesar_ahora').then(function (r) { estado.className = 'mensaje-ficha exito'; estado.textContent = r && r.repetida ? 'Ya había una orden pendiente; el servicio la atenderá.' : 'Orden enviada: el servicio revisará el correo ahora.'; })
      .catch(function (e) { estado.className = 'mensaje-ficha fallo'; estado.textContent = mensajeError(e); });
  } }, 'Revisar el correo ahora');
  var tarjeta = h('section', { class: 'tarjeta' }, [h('div', { class: 'tarjeta-titulo' }, [h('span', { class: 'icono-redondo azul' }, iconoPanel('subir')), h('div', {}, [h('h2', {}, 'Subir documentos y tickets'),
    h('p', { class: 'sub' }, 'Todo aquí: facturas, albaranes, tickets o tablas de precios. El sistema los separa solo y cada uno va a su sección.')])]),
    archivo, camara, botones, h('p', { class: 'sub' }, 'PDF, fotos, Word, Excel, XML o ZIP · máximo 15 MB cada uno. En las fotos: de frente, con buena luz y el papel entero.'),
    lista, h('div', { class: 'en-linea' }, [procesar, estado])]);
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
  v.appendChild(h('div', { class: 'herramientas' }, [
    h('div', { class: 'fila-herramientas' }, [empresas, botonExcelLista(d)]),
    h('div', { class: 'fila-herramientas' }, [buscar, h('label', { class: 'campo-corto' }, ['Estado', estado]), h('label', { class: 'campo-corto' }, ['Fecha', periodo]), limpiar,
      h('span', { class: 'contador', id: 'contador' })])]));
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
  document.getElementById('contador').textContent = contadorTabla(d, 'facturas');
  var c = document.getElementById('cuerpo');
  tabla(c, ['Nº factura', 'Fecha', { t: 'Cliente / proveedor', largo: 1 }, 'Empresa', 'Tipo', { t: 'Total', num: 1 }, 'Vence', 'Estado'], d.filas.map(function (f) {
    return { abrir: function () { ficha('Factura', f, { empresa: f.empresa, hoja: 'facturas' }); },
      celdas: [f.num_factura || f.id_doc, fecha(f.fecha), f.nombre, f.empresa, f.tipo_factura, { t: euros(f.total), num: 1 }, vence(f.fecha_vencimiento), pillEstado(f.estado)] };
  }), 'Factura');
  paginacion(c, d);
}
function vAlbaranes(v, d) {
  barraFiltros(v, d, [['Activos', 'Todos los válidos'], ['PENDIENTE DE FACTURA', 'Esperando factura'], ['Facturado', 'Facturados'], ['Descartado', 'Descartados'], ['Duplicado', 'Duplicados'], ['', 'Todo el historial']]);
  document.getElementById('contador').textContent = contadorTabla(d, 'albaranes');
  var c = document.getElementById('cuerpo');
  tabla(c, ['Nº albarán', 'Fecha', { t: 'Cliente / proveedor', largo: 1 }, 'Empresa', 'Ruta', { t: 'Importe', num: 1 }, 'Factura'], d.filas.map(function (f) {
    return { abrir: function () { ficha('Albarán', f, { empresa: f.empresa, hoja: 'albaranes' }); },
      celdas: [f.num_albaran || f.id_doc, fecha(f.fecha), f.nombre, f.empresa, [f.origen, f.destino].filter(Boolean).join(' → '), { t: euros(f.importe), num: 1 },
        f.factura_vinculada ? h('span', { class: 'pill ok' }, f.factura_vinculada) : f.estado_factura === 'PENDIENTE DE FACTURA' ? pillEsperaFactura(f) : pillEstado(f.estado_factura)] };
  }), 'Albarán');
  paginacion(c, d);
}

// ---------------------------------------------------------------------
// COMBUSTIBLE: precio del día frente a lo que cobra la gasolinera
// ---------------------------------------------------------------------
function cargarCombustible(s) {
  var rango = rangoPeriodo(s.periodoComb);
  var q = sb.from('repostajes').select('*').order('fecha', { ascending: false, nullsFirst: false }).order('id_doc').limit(3000);
  if (!s.todasEmpresas) q = q.eq('empresa', s.empresa);
  if (rango) q = q.gte('fecha', rango[0]).lt('fecha', rango[1]);
  // Precios: los del periodo y, de las tablas "hasta nuevo aviso", también las anteriores que siguen vigentes
  var qp = sb.from('precios_combustible').select('fecha,combustible,precio_litro,precio_con_iva,iva_incluido,proveedor,estacion,poblacion,provincia,empresa,hasta_nuevo_aviso')
    .order('fecha', { ascending: false }).order('estacion').limit(5000);
  if (rango) qp = qp.lt('fecha', rango[1]);
  var qt = sb.from('tickets').select('*').eq('categoria', 'Combustible').neq('estado', 'Descartado').order('fecha', { ascending: false, nullsFirst: true }).limit(2000);
  if (rango) qt = qt.gte('fecha', rango[0]).lt('fecha', rango[1]);
  return Promise.all([consulta(q), consulta(qp), consulta(qt)]).then(function (r) {
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

  var reps = d.repostajes, caros = reps.filter(function (x) { return x.estado === 'Más caro'; });
  var sinPrecio = reps.filter(function (x) { return x.estado === 'Sin precio'; });
  var demas = caros.reduce(function (t, x) { return t + (Number(x.sobrecoste) || 0); }, 0);
  var totLitros = reps.reduce(function (t, x) { return t + (Number(x.litros) || 0); }, 0);
  function metrica(icono, color, valor, nombre, ayuda) {
    return h('div', { class: 'metrica ' + color, style: 'cursor:default' }, [h('span', { class: 'icono-redondo ' + color }, iconoPanel(icono)),
      h('span', { class: 'metrica-texto' }, [h('strong', {}, valor), h('span', { class: 'metrica-nombre' }, nombre), h('span', { class: 'metrica-ayuda' }, ayuda)])]);
  }
  v.appendChild(h('div', { class: 'metricas' }, [
    metrica('revision', caros.length ? 'naranja' : 'verde', euros(demas), 'Pagado de más', caros.length ? caros.length + ' repostaje(s) por encima de la tabla' : 'Todo coincide con la tabla'),
    metrica('combustible', 'azul', reps.length ? Math.round(totLitros).toLocaleString('es-ES') + ' l' : '0 l', 'Repostajes', reps.length + ' repostaje(s) en el periodo'),
    metrica('documentos', sinPrecio.length ? 'naranja' : 'cian', String(sinPrecio.length), 'Sin comparar', sinPrecio.length ? 'Sin precio de ese día o estación (ver la nota)' : 'Todos tienen precio')]));

  v.appendChild(h('h3', {}, 'Repostajes más caros que la tabla'));
  if (!caros.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, reps.length ? 'Ningún repostaje supera el precio del día.' : 'Todavía no hay repostajes en este periodo.'));
  else tabla(v, ['Fecha', { t: 'Estación', largo: 1 }, 'Empresa', 'Matrícula', 'Combustible', { t: 'Litros', num: 1 }, { t: 'Facturado', num: 1 }, { t: 'Tabla', num: 1 },
    { t: 'Diferencia', num: 1 }, { t: 'De más', num: 1 }], caros.map(function (x) {
      return { abrir: function () { abrirFichaPorId('Factura', x.empresa, 'facturas', x.id_doc); },
        celdas: [fecha(x.fecha), x.estacion_tabla || x.estacion || x.gasolinera || '—', x.empresa, x.matricula || '—', x.combustible, { t: litros(x.litros), num: 1 }, { t: eurosLitro(x.precio_litro), num: 1 },
          { t: eurosLitro(x.precio_tabla), num: 1 }, { t: '+' + eurosLitro(x.diferencia_litro), num: 1 }, { t: euros(x.sobrecoste), num: 1 }] };
    }), 'Factura');

  v.appendChild(h('h3', {}, 'Todos los repostajes'));
  tabla(v, ['Fecha', { t: 'Estación', largo: 1 }, 'Empresa', 'Combustible', { t: 'Litros', num: 1 }, { t: 'Facturado', num: 1 }, { t: 'Tabla', num: 1 }, 'Resultado'],
    reps.slice(0, 300).map(function (x) {
      return { abrir: function () { abrirFichaPorId('Factura', x.empresa, 'facturas', x.id_doc); },
        celdas: [fecha(x.fecha), x.estacion_tabla || x.estacion || x.gasolinera || '—', x.empresa, x.combustible || '—', { t: litros(x.litros), num: 1 }, { t: eurosLitro(x.precio_litro), num: 1 },
          { t: eurosLitro(x.precio_tabla), num: 1 }, h('span', { class: 'pill ' + ({ 'Correcto': 'ok', 'Más barato': 'ok', 'Más caro': 'error', 'Sin precio': 'aviso' }[x.estado] || ''), title: x.nota || '' },
            x.estado === 'Sin precio' ? 'Sin comparar' : x.estado)] };
    }), 'Factura');

  // Tickets de gasolina: el fondo común (sin empresa, esperando la factura) y los ya enlazados
  var tks = d.tickets || [], comun = tks.filter(function (t) { return !t.empresa; }), conFactura = tks.filter(function (t) { return t.empresa; });
  v.appendChild(h('h3', {}, 'Tickets de gasolina'));
  v.appendChild(h('p', { class: 'sub' }, 'Hasta que llega la factura de la gasolinera, el ticket está en el fondo común (sin empresa). Cuando llega y coincide ' +
    '(mismo día y mismos litros), pasa solo a la empresa de la factura, y su estación sirve para comparar el precio.'));
  if (!tks.length) v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay tickets de gasolina en este periodo. Se suben con el botón "Subir documentos" o "Hacer foto".'));
  else tabla(v, ['Fecha', 'Ticket', { t: 'Estación', largo: 1 }, 'Matrícula', { t: 'Litros', num: 1 }, { t: 'Total', num: 1 }, 'Empresa', 'Estado'],
    comun.concat(conFactura).map(function (t) {
      return { abrir: function () { fichaTicket(t); },
        celdas: [t.fecha ? fecha(t.fecha) : '—', t.id_doc, t.estacion || t.comercio || '—', t.matricula || '—', { t: litros(t.litros), num: 1 },
          { t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 },
          t.empresa ? h('span', { class: 'pill ok', title: 'Enlazado con la factura ' + (t.factura_id_doc || '') }, t.empresa + (t.factura_id_doc ? ' · ' + t.factura_id_doc : ''))
                    : h('span', { class: 'pill', title: 'Esperando la factura de la gasolinera' }, 'Fondo común'),
          pillEstado(t.estado)] };
    }), 'Ticket');
  if (comun.length) v.appendChild(h('p', { class: 'sub' }, 'Fondo común: ' + comun.length + ' ticket(s) · ' +
    euros(comun.reduce(function (s, t) { return s + (Number(t.total) || 0); }, 0)) + ' esperando su factura.'));

  // Precios por ESTACIÓN: la última tabla vigente de cada empresa ("desde X hasta nuevo aviso")
  var porEstacion = d.precios.filter(function (p) { return p.estacion; });
  var vigentes = {};    // empresa -> fecha de su última tabla
  porEstacion.forEach(function (p) { var k = p.empresa || ''; var f = String(p.fecha).slice(0, 10); if (!vigentes[k] || f > vigentes[k]) vigentes[k] = f; });
  Object.keys(vigentes).sort().forEach(function (k) {
    var filas = porEstacion.filter(function (p) { return (p.empresa || '') === k && String(p.fecha).slice(0, 10) === vigentes[k]; });
    var pv = filas[0] && filas[0].proveedor ? filas[0].proveedor + ' · ' : '';
    v.appendChild(h('h3', {}, 'Precios por estación' + (k ? ' para ' + k : '') + ' — vigentes desde el ' + fecha(vigentes[k]) + (filas[0] && filas[0].hasta_nuevo_aviso ? ' (hasta nuevo aviso)' : '')));
    v.appendChild(h('p', { class: 'sub' }, pv + filas.length + ' precio(s). Cada repostaje se compara con el de su estación.'));
    tabla(v, [{ t: 'Estación', largo: 1 }, 'Población', 'Provincia', 'Combustible', { t: 'Sin IVA', num: 1 }, { t: 'Con IVA', num: 1 }], filas.map(function (p) {
      return { celdas: [p.estacion, p.poblacion || '—', p.provincia || '—', p.combustible, { t: eurosLitro(p.precio_litro), num: 1 },
        { t: p.precio_con_iva ? eurosLitro(p.precio_con_iva) : '—', num: 1 }] };
    }));
  });

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
  var q = sb.from('tickets').select('*').order('fecha', { ascending: false, nullsFirst: true }).order('id_doc', { ascending: false }).limit(5000);
  if (rango) q = q.gte('fecha', rango[0]).lt('fecha', rango[1]);
  if (s.estadoTck === 'Descartado') q = q.eq('estado', 'Descartado'); else q = q.neq('estado', 'Descartado');
  if (s.estadoTck === 'Revisar') q = q.eq('estado', 'Revisar');
  return consulta(q).then(function (r) { return { tickets: r.data || [] }; });
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
      await guardarLibro(libro, ['MCD', 'Tickets', grupo[1], nombrePeriodo(S.periodoTck), new Date().toISOString().slice(0, 10)].join('_'));
      estadoX.textContent = lista.length + ' tickets descargados';
    } catch (e) { estadoX.textContent = 'No se ha descargado: ' + mensajeError(e); }
    finally { excel.disabled = false; }
  } }, [iconoPanel('excel'), 'Descargar Excel']);

  v.appendChild(h('div', { class: 'herramientas' }, [pestanas,
    h('div', { class: 'fila-herramientas' }, [h('div', {}, [h('div', { class: 'sub' }, 'Total de ' + grupo[1].toLowerCase()),
      h('div', { class: 'total-grande' }, euros(sumaTotal(lista)) + ' · ' + lista.length + ' ticket' + (lista.length === 1 ? '' : 's'))]), h('div', { class: 'descarga-directa' }, [excel, estadoX])]),
    h('div', { class: 'fila-herramientas' }, [h('label', { class: 'campo-corto' }, ['Fecha', periodo]), h('label', { class: 'campo-corto' }, ['Estado', estado])])]));
  if (grupo[0] === 'gasolina') v.appendChild(h('p', { class: 'sub' }, ['Sin empresa = fondo común: cada ticket pasa solo a su empresa cuando llega la factura de la gasolinera. También se ven en ',
    h('button', { type: 'button', class: 'boton enlace', onclick: function () { irA('combustible'); } }, 'Combustible'), ', comparados con la tabla de precios.']));
  if (!lista.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, d.tickets.length ? 'No hay tickets de ' + grupo[1].toLowerCase() + ' en este periodo.' : 'Todavía no hay tickets en este periodo. Haz una foto para subir el primero.')); return; }

  // Por AÑO y, dentro, por MES (lo más reciente primero; el último mes, abierto)
  var columnas = grupo[0] === 'gasolina'
    ? ['Fecha', { t: 'Estación', largo: 1 }, 'Matrícula', { t: 'Litros', num: 1 }, { t: 'Total', num: 1 }, 'Empresa', 'Estado']
    : ['Fecha', { t: 'Comercio', largo: 1 }].concat(grupo[0] === 'otros' ? ['Tipo'] : [], [{ t: 'Total', num: 1 }, { t: 'IVA', num: 1 }, 'Pago', 'Estado']);
  function fila(t) {
    var comunes = [t.fecha ? fecha(t.fecha) : '—'];
    if (grupo[0] === 'gasolina') return { abrir: function () { fichaTicket(t); }, celdas: comunes.concat([t.estacion || t.comercio || '—', t.matricula || '—', { t: litros(t.litros), num: 1 },
      { t: t.total === null || t.total === undefined ? '—' : euros(t.total), num: 1 },
      t.empresa ? h('span', { class: 'pill ok' }, t.empresa) : h('span', { class: 'pill', title: 'Esperando la factura de la gasolinera' }, 'Fondo común'), pillEstado(t.estado)]) };
    return { abrir: function () { fichaTicket(t); }, celdas: comunes.concat([t.comercio || '—'], grupo[0] === 'otros' ? [t.categoria] : [],
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
      t.categoria === 'Combustible' ? h('p', { class: 'ayuda-campo' }, (t.estacion ? 'Estación: ' + t.estacion + ' · ' : '') +
        (t.empresa ? 'Empresa: ' + t.empresa + (t.factura_id_doc ? ' (factura ' + t.factura_id_doc + ')' : '') : 'Fondo común: esperando la factura de la gasolinera')) : null,
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
  abrirModal('Ticket ' + t.id_doc, cuerpo);
  document.getElementById('caja').classList.add('revision-amplia');
  fichaSucia = function () { return editable && Object.keys(cambios()).length > 0; };
  // Foto: originales/AAAA-MM/<id>_<archivo> (el mes en que se leyó)
  var numero = secuenciaFicha, d0 = new Date(t.creado_en || Date.now());
  var meses = [0, -1].map(function (k) { var x = new Date(d0.getFullYear(), d0.getMonth() + k, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); });
  (async function () {
    for (var m of meses) {
      var l = await sb.storage.from('documentos').list('originales/' + m, { limit: 5, search: t.id_doc + '_' });
      var x = !l.error && (l.data || []).filter(function (o) { return o.id && o.name.indexOf(t.id_doc + '_') === 0; })[0];
      if (x) {
        await rpc('panel_registrar_acceso_archivo', { p_id: t.id_doc, p_tipo: 'original', p_accion: 'Ver documento' });
        var url = await urlFirmada('originales/' + m + '/' + x.name);
        if (numero !== secuenciaFicha) return;
        visor.textContent = ''; visor.appendChild(visorPara(url, x.name)); return;
      }
    }
    if (numero === secuenciaFicha) { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'No se encuentra la foto de este ticket.')); }
  })().catch(function () { if (numero === secuenciaFicha) { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La foto no está disponible ahora mismo.')); } });
}

// ---------------------------------------------------------------------
// REVISIÓN
// ---------------------------------------------------------------------
function vRevision(v, lista) {
  var tipos = ['', 'Factura a revisar', 'Albarán a revisar', 'Albarán sin factura', 'Ticket a revisar', 'Revisión manual'];
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
  tabla(v, ['Documento', 'Qué pasa', 'Empresa', 'Fecha', 'Cliente / proveedor', { t: 'Importe', num: 1 }, { t: 'Motivo', largo: 1 }], filas.map(function (x) {
    return { abrir: function () { if (x.hoja === 'tickets') { abrirDesdeHistorial({ hoja: 'tickets', id_doc: x.id }); return; }
        abrirFichaPorId(x.hoja === 'facturas' ? 'Factura' : x.hoja === 'albaranes' ? 'Albarán' : 'Revisión manual', x.empresa, x.hoja, x.id); },
      celdas: [x.numero || x.id, ENVIADOS_TACHADO[x.id] && x.tipo === 'Revisión manual' ? h('span', { class: 'pill ok' }, 'Enviado a la IA') : pillEstado(x.tipo === 'Albarán sin factura' ? 'Sin factura' : x.tipo),
        x.empresa === '_revision' || !x.empresa ? '—' : x.empresa, fecha(x.fecha), x.nombre, { t: x.total === null || x.total === undefined ? '' : euros(x.total), num: 1 },
        ENVIADOS_TACHADO[x.id] && x.tipo === 'Revisión manual' ? 'Copia tachada enviada: se está leyendo (tarda un minuto)' : x.motivo] };
  }), 'Revisión');
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
    var elementos = (r.data || []).filter(function (x) { return x.name !== '.emptyFolderPlaceholder'; }).map(function (x) {
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
  if (!d.elementos.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, 'Carpeta vacía. Los archivos aparecen aquí cuando el servicio termina de procesarlos.')); return; }
  tabla(v, [{ t: 'Nombre', largo: 1 }, 'Modificado', { t: 'Tamaño', num: 1 }], d.elementos.map(function (x) {
    var esCarpeta = x.tipo === 'carpeta';
    return { abrir: esCarpeta ? function () { S.carpeta = x.ruta; cargar(true); } : function () { vistaPreviaRuta(x.nombre, x.ruta); },
      celdas: [(esCarpeta ? '📁 ' : '📄 ') + x.nombre, x.fecha ? fecha(String(x.fecha).slice(0, 10)) + ' ' + hora(x.fecha) : '', { t: esCarpeta ? '' : tamano(x.tamano), num: 1 }] };
  }));
}
function urlFirmada(ruta) {
  return sb.storage.from('documentos').createSignedUrl(ruta, 600).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data.signedUrl; });
}
function visorPara(url, nombre) {
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(nombre) ? h('img', { src: url, alt: 'Vista previa de ' + nombre }) : h('iframe', { src: url, title: 'Vista previa de ' + nombre, loading: 'lazy' });
}
function vistaPreviaRuta(nombre, ruta) {
  abrirModal(nombre, h('div', { class: 'cargando' }, 'Preparando la vista previa…'));
  var numero = secuenciaFicha;
  rpc('panel_registrar_acceso_archivo', { p_id: ruta.slice(0, 160), p_tipo: 'archivo', p_accion: 'Ver documento' }).then(function () { return urlFirmada(ruta); }).then(function (url) {
    if (numero !== secuenciaFicha) return;
    var caja = document.getElementById('caja'); var visor = h('div', { class: 'visor-documento', style: 'height:72vh' }, visorPara(url, nombre));
    caja.replaceChild(visor, caja.lastChild);
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
    h('p', { class: 'sub' }, 'Al guardar un correo nuevo le llega en menos de un minuto un correo para elegir su contraseña. Para cambiar a alguien, pulsa su correo en la lista.'),
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
  function estadoInvitacion(u) {
    if (!u.activo) return 'Desactivado';
    if (u.invitacion_error) return 'Error al invitar';
    return u.invitado_en ? 'Enviada ' + fecha(String(u.invitado_en).slice(0, 10)) : 'Pendiente de enviar';
  }
  tabla(v, ['Correo', 'Nombre', 'Rol', 'Activo', 'Invitación', 'Último acceso'], usuarios.map(function (u) {
    return { celdas: [u.email, u.nombre, u.rol, u.activo ? 'Sí' : 'No', estadoInvitacion(u), u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'Nunca'], abrir: function () { email.value = u.email; nombre.value = u.nombre || ''; rol.value = u.rol; activo.checked = !!u.activo; email.focus(); } };
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

  // Excel: todo lo filtrado (hasta 5.000 filas)
  var estadoX = h('span', { class: 'estado-excel', role: 'status' });
  var excel = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    excel.disabled = true; estadoX.textContent = 'Preparando…';
    try {
      var r = await consulta(consultaHistorial(d.filtros).range(0, 4999)), filas = r.data || [];
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
  var zip = new JSZip(), total = 0, faltan = [];
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
            if (rb.error) { faltan.push(f.id_doc); return; }
            total += rb.data.size; if (total > 40 * 1024 * 1024) throw new Error('La exportación supera 40 MB; hazla por meses más cortos o descarga los archivos uno a uno.');
            zip.file((f.id_doc + '_' + d.archivo_original).replace(/[\\/:*?"<>|]/g, '_'), rb.data);
          });
        });
      }, Promise.resolve()).then(function () { return facturas.length; });
    });
  }).then(function (n) {
    if (faltan.length === n) throw new Error('No se ha encontrado ningún archivo original. Los archivos se guardan aquí cuando el servicio los procesa con el almacén nuevo.');
    return rpc('panel_registrar_acceso_archivo', { p_id: empresa + ' ' + mes, p_tipo: 'zip', p_accion: 'Descargar documento' }).then(function () { return zip.generateAsync({ type: 'blob' }); }).then(function (blob) {
      var url = URL.createObjectURL(blob), a = h('a', { href: url, download: 'Facturas_' + empresa + '_' + mes + '.zip' }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      estado.className = 'mensaje ok'; estado.textContent = 'Exportadas ' + (n - faltan.length) + ' facturas' + (faltan.length ? '. Sin archivo: ' + faltan.join(', ') : '.');
    });
  }).catch(function (e) { estado.className = 'mensaje error'; estado.textContent = mensajeError(e); });
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
    if (f.abrir) {
      tr.addEventListener('click', f.abrir);
      var celda = tr.cells[0], contenido = celda.textContent.trim();
      var boton = h('button', { type: 'button', class: 'abrir-fila', 'aria-label': 'Abrir ' + (tituloFicha || 'elemento') + (contenido ? ': ' + contenido : ''), onclick: function (e) { e.stopPropagation(); f.abrir(); } });
      while (celda.firstChild) boton.appendChild(celda.firstChild);
      celda.appendChild(boton);
    }
    return tr;
  }));
  contenedor.appendChild(h('div', { class: 'tabla' }, h('table', {}, [h('thead', {}, cab), cuerpo])));
}

var CAMPOS_FICHA = {
  facturas: [['Datos de la factura', ['num_factura', 'fecha', 'fecha_vencimiento', 'nif', 'nombre', 'matricula', 'concepto']],
             ['Importes', ['base_imponible', 'iva_porcentaje', 'cuota_iva', 'retencion_irpf', 'otros_importes', 'total']],
             ['Cobro o pago', ['estado_cobro_pago', 'importe_cobrado_pagado', 'fecha_cobro_pago']],
             ['Notas de revisión', ['observaciones']]],
  albaranes: [['Datos del albarán', ['num_albaran', 'fecha', 'nif', 'nombre', 'matricula']],
              ['Servicio y vinculación', ['origen', 'destino', 'concepto', 'importe', 'num_factura']],
              ['Notas de revisión', ['observaciones']]],
  revision: [['Motivo de revisión', ['motivo']]]
};
var ETIQUETAS = { num_factura: 'Número de factura', num_albaran: 'Número de albarán', fecha: 'Fecha del documento', fecha_vencimiento: 'Vencimiento (vacío = No consta)',
  nif: 'NIF del cliente o proveedor', nombre: 'Cliente o proveedor', matricula: 'Matrícula', concepto: 'Concepto del servicio', base_imponible: 'Base imponible (€)',
  iva_porcentaje: 'IVA (%)', cuota_iva: 'Cuota de IVA (€)', retencion_irpf: 'Retención IRPF (€)', otros_importes: 'Otros importes (€)', total: 'Total (€)', importe: 'Importe (€)',
  estado_cobro_pago: 'Estado del cobro o pago', importe_cobrado_pagado: 'Importe cobrado o pagado (€)', fecha_cobro_pago: 'Fecha del movimiento', origen: 'Origen', destino: 'Destino',
  observaciones: 'Observaciones', motivo: 'Motivo de revisión', id_doc: 'ID', empresa: 'Empresa', tipo_factura: 'Tipo', tipo_albaran: 'Tipo', estado: 'Estado', albaranes: 'Albaranes citados',
  comprobacion_albaranes: 'Comprobación de albaranes', estado_factura: 'Estado de facturación', factura_vinculada: 'Factura vinculada', dias_sin_factura: 'Días sin factura',
  posible_factura: 'Posible factura', categoria_gasto: 'Categoría de gasto', creado_en: 'Registrado', actualizado_en: 'Última modificación', fecha_alta: 'Fecha de alta',
  archivo_original: 'Archivo original', hash_sha256: 'Huella del archivo', tokens_entrada: 'Tokens de entrada', tokens_salida: 'Tokens de salida', coste_eur: 'Coste IA (€)' };
var fichaSucia = null, guardandoFicha = false, focoAntesModal = null, secuenciaFicha = 0;

function ficha(titulo, fila, contexto) {
  var empresa = contexto.empresa, hoja = contexto.hoja, id = fila.id_doc || '';
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
        fichaSucia = null; cerrarModal(); avisoBreve(titulo + ' ' + id + (/^(Factura|Revisi)/.test(titulo) ? ' revisada' : ' revisado') + (Object.keys(cambios).length ? ' y cambios guardados' : ''));
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
      rpc('panel_descartar', { p_empresa: empresa, p_hoja: hoja, p_id: id }).then(function () { pendientes = 0; fichaSucia = null; guardandoFicha = false; cerrarModal(); avisoBreve(titulo + ' ' + id + ' descartado'); cargar(true); })
        .catch(function (e) { mensaje.textContent = mensajeError(e); mensaje.className = 'mensaje-ficha fallo'; ocupado(false); });
    } }, 'Descartar');
    pie.appendChild(h('div', { class: 'acciones-revision' }, [descartar, guardar, marcar]));
    formulario.addEventListener('submit', function (e) { e.preventDefault(); guardarCambios(false); });
  }
  var ampliar = h('button', { class: 'boton', 'aria-pressed': 'false', onclick: function () {
    var solo = document.getElementById('caja').classList.toggle('modo-datos'); ampliar.setAttribute('aria-pressed', String(solo)); ampliar.textContent = solo ? 'Ver documento y datos' : 'Ampliar formulario';
  } }, 'Ampliar formulario');
  abrirModal(titulo + ' ' + id, h('div', { class: 'contenido-revision' }, [zona, pie]), ampliar);
  document.getElementById('caja').classList.add('revision-amplia');
  fichaSucia = function () { return editable && pendientes > 0; }; actualizarPendientes();
  // Archivos del documento: original y copia tachada (en el almacén de Supabase)
  var numero = secuenciaFicha;
  localizarArchivos(empresa, hoja, id).then(function (d) {
    if (numero !== secuenciaFicha) return;
    opcionesDocumento.textContent = ''; estadoArchivo.textContent = '';
    function mostrar(tipo, archivo) {
      visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'Abriendo…'));
      rpc('panel_registrar_acceso_archivo', { p_id: id, p_tipo: tipo, p_accion: 'Ver documento' }).then(function () { return urlFirmada(archivo.ruta); }).then(function (url) {
        if (numero !== secuenciaFicha) return;
        visor.textContent = ''; visor.appendChild(visorPara(url, archivo.nombre)); estadoArchivo.textContent = '';
        estadoArchivo.appendChild(h('button', { type: 'button', class: 'boton', onclick: function () {
          var solo = document.getElementById('caja').classList.toggle('modo-documento'); this.textContent = solo ? 'Volver a los datos' : 'Ver documento en grande';
        } }, 'Ver documento en grande'));
        if (S.rol === 'Administrador') estadoArchivo.appendChild(h('button', { class: 'boton', onclick: function () { descargar(archivo.ruta, archivo.nombre); } }, 'Descargar'));
      }).catch(function () { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); });
    }
    [['Original', 'original', d.original], ['Copia tachada', 'tachado', d.tachado]].forEach(function (x) { if (x[2]) opcionesDocumento.appendChild(h('button', { class: 'boton', type: 'button', onclick: function () { mostrar(x[1], x[2]); } }, x[0])); });
    // Revisión manual: tacharlo a mano y enviarlo a la IA (PDF o foto)
    if (hoja === 'revision' && editable && d.original && ENVIADOS_TACHADO[id]) {
      panelDocumento.appendChild(h('p', { class: 'ayuda-campo aviso-tachado' }, 'Ya se envió la copia tachada a la IA. En un minuto saldrá de esta lista y aparecerá como factura, albarán o ticket.'));
    } else if (hoja === 'revision' && editable && d.original) {
      var tachable = /\.(pdf|jpe?g|png|webp|gif|bmp)$/i.test(d.original.nombre);
      panelDocumento.appendChild(h('div', { class: 'aviso-tachado' }, [      // fuera de estadoArchivo: la vista previa lo vacía al cargar
        h('button', { type: 'button', class: 'boton principal', disabled: tachable ? null : 'disabled', onclick: function () {
          if (fichaSucia && fichaSucia() && !confirm('Hay cambios sin guardar en la ficha. ¿Seguir sin guardarlos?')) return;
          fichaSucia = null; abrirTachado(id, d.original);
        } }, 'Tachar y enviar a la IA'),
        h('span', { class: 'sub' }, tachable ? 'Si no se leyó bien: tapa a mano los datos personales y envíalo.' : 'Este tipo de archivo no se puede tachar aquí (solo PDF o fotos).')]));
    }
    if (d.original) mostrar('original', d.original); else if (d.tachado) mostrar('tachado', d.tachado);
    else { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'No hay archivo guardado para este documento (los documentos anteriores al almacén nuevo siguen en la carpeta de Drive).')); }
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
    var buscarOriginal = mes ? sb.storage.from('documentos').list('originales/' + mes, { limit: 5, search: id + '_' }).then(function (l) {
      var x = !l.error && (l.data || []).filter(function (o) { return o.id && o.name.indexOf(id + '_') === 0; })[0];
      return x ? { ruta: 'originales/' + mes + '/' + x.name, nombre: x.name.slice(id.length + 1) } : null;
    }) : Promise.resolve(null);
    var tachado = d.hash_sha256 ? { ruta: 'tachados/' + d.hash_sha256 + '_tachado.pdf', nombre: id + '_tachado.pdf' } : null;
    return Promise.all([buscarOriginal, existe(tachado)]).then(function (ok) { return { original: ok[0], tachado: ok[1] ? tachado : null }; });
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
  ++secuenciaFicha;
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
  ++secuenciaFicha; fichaSucia = null; document.getElementById('modal').classList.remove('abierto'); document.body.style.overflow = '';
  if (focoAntesModal && focoAntesModal.isConnected) focoAntesModal.focus();
}
document.getElementById('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', function (e) {
  if (!document.getElementById('modal').classList.contains('abierto')) return;
  if (e.key === 'Escape') { e.preventDefault(); cerrarModal(); }
  if (e.key === 'Tab') {
    var el = [].slice.call(document.getElementById('caja').querySelectorAll('button,input,select,textarea,a[href],summary,iframe')).filter(function (x) { return !x.disabled && x.getClientRects().length; });
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
