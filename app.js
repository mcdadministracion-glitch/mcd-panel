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
function pillEstado(t) {
  t = texto(t);
  var c = /PENDIENTE|Faltan|≠|ERROR/.test(t) ? 'error' : /Revisar|Duplicado|revisión|Revisión/.test(t) ? 'aviso' : /Procesado|Facturado|recibidos/.test(t) ? 'ok' : '';
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
var S = { vista: 'inicio', empresa: null, buscar: '', filtro: 'Activos', pagina: 1, carpeta: '', mes: mesActual(), datos: null, pendientes: 0, rol: null, usuario: null, denegado: false };
var VISTAS = [['inicio', 'Inicio'], ['facturas', 'Facturas'], ['albaranes', 'Albaranes'], ['revision', 'Pendientes'], ['documentos', 'Documentos'], ['negocio', 'Negocio']];
VISTAS.push(['tablas', 'Tablas y Excel']);
var temporizadorBusqueda = null, secuenciaCarga = 0;

// Catálogo cerrado. Las consultas se hacen con la sesión del panel y las políticas de Supabase.
var TABLAS_CONSULTA = {
  facturas:       { titulo: 'Facturas', empresa: 'empresa', orden: ['empresa', 'id_doc'] },
  lineas_factura: { titulo: 'Líneas de factura', empresa: 'empresa', orden: ['empresa', 'id_doc', 'linea', 'id'] },
  albaranes:      { titulo: 'Albaranes', empresa: 'empresa', orden: ['empresa', 'id_doc'] },
  proveedores:    { titulo: 'Proveedores', empresa: 'empresa', orden: ['empresa', 'nif', 'id'] },
  empresas:       { titulo: 'Empresas', empresa: 'clave', orden: ['clave'] },
  periodicas:     { titulo: 'Facturas periódicas', empresa: 'empresa', orden: ['empresa', 'id'] }
};
var tablaElegida = 'facturas', empresaTablas = '';
var seleccionExcel = new Map();
var bibliotecaExcel;

function claveRegistro(clave, fila) {
  var campos = TABLAS_CONSULTA[clave].orden;
  return JSON.stringify(campos.map(function (campo) { return fila[campo]; }));
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

function tablasVisibles() {
  return S.rol && !S.denegado ? Object.keys(TABLAS_CONSULTA) : [];
}

function consultaRegistros(clave, empresa) {
  if (tablasVisibles().indexOf(clave) < 0) throw new Error('Tabla no disponible para tu perfil.');
  var config = TABLAS_CONSULTA[clave];
  var consultaFilas = sb.from(clave).select('*', { count: 'exact' });
  if (config.empresa && empresa) consultaFilas = consultaFilas.eq(config.empresa, empresa);
  config.orden.forEach(function (campo) { consultaFilas = consultaFilas.order(campo); });
  return consultaFilas;
}

function cargarRegistros(pagina) {
  if (tablasVisibles().indexOf(tablaElegida) < 0) { tablaElegida = 'facturas'; seleccionExcel.clear(); }
  var consultaFilas = consultaRegistros(tablaElegida, empresaTablas);
  var tamano = 50, desde = (pagina - 1) * tamano;
  return consultaFilas.range(desde, desde + tamano - 1).then(function (r) {
    if (pagina > 1 && (r.status === 416 || (!r.error && !r.data.length))) return { volverAlInicio: true };
    if (r.error) throw new Error(r.error.message);
    return { filas: r.data || [], pagina: pagina, tamano: tamano, total: r.count || 0 };
  });
}

function vTablas(v, d) {
  var config = TABLAS_CONSULTA[tablaElegida];
  var lista = h('select', { 'aria-label': 'Tabla' }, tablasVisibles().map(function (clave) {
    return h('option', { value: clave }, TABLAS_CONSULTA[clave].titulo);
  }));
  lista.value = tablaElegida;
  lista.addEventListener('change', function () {
    seleccionExcel.clear(); tablaElegida = lista.value; S.pagina = 1; cargar(true);
  });
  var barra = h('div', { class: 'barra' }, [h('label', {}, ['Tabla ', lista])]);
  if (config.empresa) {
    var empresas = h('select', { 'aria-label': 'Empresa' }, [h('option', { value: '' }, 'Todas las empresas')].concat(
      EMPRESAS.map(function (nombre) { return h('option', { value: nombre }, nombre); })));
    empresas.value = empresaTablas;
    empresas.addEventListener('change', function () {
      seleccionExcel.clear(); empresaTablas = empresas.value; S.pagina = 1; cargar(true);
    });
    barra.appendChild(h('label', {}, ['Empresa ', empresas]));
  }
  v.appendChild(barra);
  if (d.error) {
    v.appendChild(h('p', { role: 'alert' }, d.error));
    v.appendChild(h('button', { class: 'boton', onclick: function () { cargar(true); } }, 'Reintentar'));
    return;
  }
  barra.appendChild(h('span', { class: 'contador' }, contadorTabla(d, 'registros')));
  var columnas = Object.keys(d.filas[0] || {});
  var prioridad = {
    facturas: ['num_factura','fecha','nombre','total','fecha_vencimiento','estado','empresa'],
    albaranes: ['num_albaran','fecha','nombre','origen','destino','importe','estado_factura','empresa'],
    lineas_factura: ['id_doc','linea','descripcion','cantidad','precio_unitario','importe','empresa'],
    proveedores: ['empresa','nif','fecha_alta','id_doc'],
    empresas: ['nombre','cif','clave','activa'],
    periodicas: ['empresa','categoria','nif','mes_inicio','periodo_meses','dia_limite','activa']
  }[tablaElegida];
  columnas = prioridad.filter(function (c) { return columnas.includes(c); }).concat(columnas.filter(function (c) { return !prioridad.includes(c); }));
  var rapido = descargaDirecta('Descargar tabla', function () {
    return { claves: [tablaElegida], empresa: empresaTablas, filas: seleccionExcel.size ? Array.from(seleccionExcel.values()) : null };
  });
  var opciones = h('details', { class: 'excel-opciones' }, [h('summary', {}, 'Personalizar descarga')]);
  var limpiar = h('button', { type: 'button', class: 'boton', onclick: function () {
    seleccionExcel.clear();
    v.querySelectorAll('td input[type=checkbox]').forEach(function (marca) { marca.checked = false; });
    actualizarBoton();
  } }, 'Quitar selección');
  var opcionesCreadas = false;
  opciones.addEventListener('toggle', function () {
    if (opciones.open && !opcionesCreadas) { opciones.appendChild(opcionesExcel(d)); opcionesCreadas = true; }
  });
  function actualizarBoton() {
    limpiar.hidden = !seleccionExcel.size;
    rapido.querySelector('button').textContent = seleccionExcel.size ? 'Descargar ' + seleccionExcel.size + (seleccionExcel.size === 1 ? ' fila marcada' : ' filas marcadas') : 'Descargar ' + TABLAS_CONSULTA[tablaElegida].titulo.toLowerCase();
    if (opcionesCreadas) {
      opciones.lastChild.remove(); opcionesCreadas = false;
      if (opciones.open) { opciones.appendChild(opcionesExcel(d)); opcionesCreadas = true; }
    }
  }
  actualizarBoton();
  v.appendChild(h('section', { class: 'excel-zona', 'aria-label': 'Descarga de Excel' }, [
    h('div', { class: 'excel-cab' }, [h('div', {}, [h('h2', {}, 'Descargar en Excel'),
      h('p', {}, (empresaTablas || 'Todas las empresas') + ' · ' + d.total + ' registros en la tabla')]), h('div', { class: 'en-linea' }, [limpiar, rapido])]), opciones]));
  tabla(v, ['Marcar'].concat(columnas.map(function (c) { return etiquetaColumna(c, tablaElegida); })), d.filas.map(function (fila) {
    var id = claveRegistro(tablaElegida, fila);
    var marca = h('input', { type: 'checkbox', 'aria-label': 'Marcar fila ' + (fila.id_doc || fila.id || fila.clave || fila.email || id) });
    marca.checked = seleccionExcel.has(id);
    if (marca.checked) seleccionExcel.set(id, fila);
    marca.addEventListener('change', function () {
      if (marca.checked) seleccionExcel.set(id, fila); else seleccionExcel.delete(id);
      actualizarBoton();
    });
    return { celdas: [marca].concat(columnas.map(function (c) {
      var valor = fila[c];
      if (c === 'fecha_vencimiento' && valor == null) return 'No consta';
      if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && c.startsWith('fecha')) return fecha(valor);
      if (typeof valor === 'number') return valor.toLocaleString('es-ES', { maximumFractionDigits: 5 });
      if (valor === null || valor === undefined) return '—';
      if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
      return typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
    })) };
  }));
  paginacion(v, d);
}

function etiquetaColumna(c, clave) {
  if (c === 'nombre' && clave === 'empresas') return 'Nombre de la empresa';
  if (c === 'fecha_vencimiento') return 'Vencimiento';
  return ETIQUETAS[c] || (c.charAt(0).toUpperCase() + c.slice(1)).replace(/_/g, ' ');
}

function opcionesExcel(datos) {
  var clave = tablaElegida, catalogo = tablasVisibles();
  var filaMarcada = seleccionExcel.size > 0;
  var modos = [['tabla', 'Tabla completa'], ['pagina', 'Página actual (' + datos.filas.length + ' filas)'],
    ['marcadas', 'Filas marcadas (' + seleccionExcel.size + ')'], ['varias', 'Elegir varias tablas o todas']];
  var modo = h('select', {}, modos.map(function (m) {
    return h('option', { value: m[0], disabled: m[0] === 'marcadas' && !filaMarcada }, m[1]);
  }));
  modo.value = filaMarcada ? 'marcadas' : 'tabla';
  var empresaActual = TABLAS_CONSULTA[clave].empresa ? empresaTablas : '';
  var empresa = h('select', {}, [h('option', { value: '' }, 'Todas las empresas')].concat(
    EMPRESAS.map(function (e) { return h('option', { value: e }, e); })));
  empresa.value = empresaActual;
  var grupoEmpresa = h('label', {}, ['Empresa del libro', empresa]);
  var columnas = Object.keys(datos.filas[0] || {});
  var casillasColumnas = [], casillasTablas = [];
  function cambiarMarcas(lista) {
    return h('div', { class: 'en-linea' }, [true, false].map(function (valor) {
      return h('button', { type: 'button', class: 'abrir-fila', onclick: function () {
        lista.forEach(function (c) { if (!c.disabled) c.checked = valor; });
      } }, valor ? 'Marcar todas' : 'Desmarcar todas');
    }));
  }
  function casilla(valor, titulo, lista) {
    var input = h('input', { type: 'checkbox', value: valor });
    input.checked = true; lista.push(input);
    return h('label', { style: 'display:inline-flex;align-items:center;gap:5px;margin:4px 12px 4px 0' }, [input, titulo]);
  }
  var campos = h('details', {}, [h('summary', {}, 'Elegir columnas'), cambiarMarcas(casillasColumnas),
    h('div', {}, columnas.map(function (c) { return casilla(c, etiquetaColumna(c, clave), casillasColumnas); }))]);
  var tablas = h('fieldset', {}, [h('legend', {}, 'Tablas del libro'), cambiarMarcas(casillasTablas),
    h('div', {}, catalogo.map(function (c) { return casilla(c, TABLAS_CONSULTA[c].titulo, casillasTablas); }))]);
  var estado = h('p', { role: 'status' });
  var boton = h('button', { class: 'boton principal', type: 'submit' }, 'Descargar .xlsx');
  var controles = h('fieldset', { style: 'border:0;padding:0;min-width:0;display:grid;gap:12px' }, [
    h('label', {}, ['Qué descargar', modo]), grupoEmpresa, tablas, campos, boton
  ]);
  var form = h('form', { class: 'excel-form' }, [controles, estado]);
  function mostrarOpciones() {
    var varias = modo.value === 'varias';
    grupoEmpresa.hidden = tablas.hidden = !varias;
    campos.hidden = varias || !columnas.length;
    casillasTablas.forEach(function (c) {
      c.disabled = !!empresa.value && !TABLAS_CONSULTA[c.value].empresa;
      c.parentElement.hidden = c.disabled;
      c.parentElement.style.display = c.disabled ? 'none' : 'inline-flex';
    });
    estado.textContent = varias && empresa.value ? 'Se incluyen las tablas que tienen datos por empresa.' :
      !varias && empresaActual ? 'Empresa: ' + empresaActual : '';
  }
  function marcadas(casillas) {
    return casillas.filter(function (c) { return c.checked && !c.disabled; }).map(function (c) { return c.value; });
  }
  modo.addEventListener('change', mostrarOpciones); empresa.addEventListener('change', mostrarOpciones);
  mostrarOpciones();
  form.addEventListener('submit', async function (evento) {
    evento.preventDefault();
    if (controles.disabled) return;
    var varias = modo.value === 'varias';
    var claves = varias ? marcadas(casillasTablas) : [clave];
    var filtro = varias ? empresa.value : empresaActual;
    var elegidas = varias || !columnas.length ? null : marcadas(casillasColumnas);
    if (!claves.length || (elegidas && !elegidas.length)) {
      estado.textContent = !claves.length ? 'Elige al menos una tabla.' : 'Elige al menos una columna.'; return;
    }
    var filasVista = modo.value === 'marcadas' ? Array.from(seleccionExcel.values()) :
      modo.value === 'pagina' ? datos.filas : null;
    controles.disabled = true;
    try {
      await generarDescarga({ claves: claves, empresa: filtro, columnas: elegidas, filas: filasVista }, estado);
    } finally { controles.disabled = false; }
  });
  return form;
}

function descargaDirecta(titulo, obtener) {
  var estado = h('span', { role: 'status', class: 'estado-excel' });
  var boton = h('button', { type: 'button', class: 'boton descarga', onclick: async function () {
    boton.disabled = true;
    try { await generarDescarga(obtener(), estado); } finally { boton.disabled = false; }
  } }, titulo);
  return h('div', { class: 'descarga-directa' }, [boton, estado]);
}

async function generarDescarga(plan, estado) {
  var vista = S.vista, usuario = S.usuario && S.usuario.email;
  function comprobar() {
    if (!estado.isConnected || S.vista !== vista || S.denegado || !S.rol || (S.usuario && S.usuario.email) !== usuario)
      throw new Error('La consulta ha cambiado.');
  }
  estado.setAttribute('aria-busy', 'true');
  try {
    estado.textContent = 'Preparando Excel…';
    var excel = await prepararExcel(), libro = new excel.Workbook();
    for (var clave of plan.claves) {
      comprobar();
      if (tablasVisibles().indexOf(clave) < 0) throw new Error('Tabla no disponible.');
      var hoja = libro.addWorksheet(TABLAS_CONSULTA[clave].titulo);
      var escribir = escritorHoja(hoja, plan.columnas);
      if (plan.filas) escribir(plan.filas);
      else await exportarTablaCompleta(clave, plan.empresa, escribir, function (n) {
        comprobar(); estado.textContent = hoja.name + ' · ' + n + ' filas leídas';
      }, plan.filtros);
    }
    var buffer = await libro.xlsx.writeBuffer();
    comprobar();
    var url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var nombre = [ 'MCD', plan.claves.length > 1 ? 'Tablas' : plan.claves[0], plan.empresa, new Date().toISOString().slice(0, 10) ].filter(Boolean).join('_');
    var enlace = h('a', { href: url, download: nombre.replace(/[<>:"/\\|?*]/g, '_') + '.xlsx' });
    document.body.appendChild(enlace); enlace.click(); enlace.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    estado.textContent = 'Archivo descargado.';
  } catch (err) { estado.textContent = 'No se ha descargado el archivo. ' + mensajeError(err); }
  finally { estado.removeAttribute('aria-busy'); }
}

async function exportarTablaCompleta(clave, empresa, escribir, progreso, filtros) {
  var desde = 0, total, vistos = new Set();
  do {
    progreso(desde);
    var q = filtros ? consultaDocumentos(filtros) : consultaRegistros(clave, empresa);
    var r = await consulta(q.range(desde, desde + 499));
    if (total === undefined) total = r.count;
    if (!Number.isInteger(total) || r.count !== total || (!r.data.length && desde < total)) {
      throw new Error('La tabla ha cambiado durante la descarga. Vuelve a intentarlo.');
    }
    r.data.forEach(function (fila) {
      var id = claveRegistro(clave, fila);
      if (vistos.has(id)) throw new Error('La tabla ha cambiado durante la descarga. Vuelve a intentarlo.');
      vistos.add(id);
    });
    escribir(r.data);
    desde += r.data.length;
  } while (desde < total);
}

function escritorHoja(hoja, columnas) {
  var preparada = false;
  return function (filas) {
    if (!preparada) {
      columnas = columnas || Object.keys(filas[0] || {});
      hoja.columns = columnas.map(function (c) { return { header: c, width: Math.min(42, Math.max(17, c.length + 3)) }; });
      if (columnas.length) {
        hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        hoja.getRow(1).eachCell(function (celda) {
          celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2456C4' } };
        });
        hoja.views = [{ state: 'frozen', ySplit: 1 }];
        hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
      }
      preparada = true;
    }
    if (hoja.rowCount + filas.length > 1048576) throw new Error('Esta tabla supera el límite de filas de Excel. Filtra por empresa.');
    filas.forEach(function (fila) {
      hoja.addRow(columnas.map(function (c) {
        var valor = fila[c];
        if (valor == null) return null;
        if (typeof valor === 'object') valor = JSON.stringify(valor);
        if (typeof valor === 'string' && valor.length > 32767) throw new Error('La columna ' + c + ' contiene un texto demasiado largo para Excel.');
        if (c.indexOf('fecha') === 0 && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
          return new Date(valor + 'T00:00:00Z');
        }
        return valor;
      }));
    });
  };
}

function iconoPanel(vista) {
  var trazos = {
    inicio:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    facturas:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
    albaranes:'M2 6h12v10H2z M14 10h4l4 4v2h-8 M8 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0',
    revision:'M12 3 2 20h20z M12 9v5 M12 17h.01',
    documentos:'M3 6h7l2 2h9v12H3z', negocio:'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V5',
    tablas:'M3 4h18v16H3z M3 10h18 M10 10v10', usuarios:'M8 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 7a3 3 0 0 1 0 6 M17 16a5 5 0 0 1 5 5'
  };
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden','true'); svg.setAttribute('class','icono-panel');
  path.setAttribute('d', trazos[vista]); svg.appendChild(path); return svg;
}

function pintarMenu() {
  var nav = document.getElementById('menu'); nav.textContent = '';
  if (!S.rol) return;
  var secciones = VISTAS.slice();
  if (S.rol === 'Administrador') secciones.push(['usuarios', 'Gestionar accesos']);
  var movil = h('select', { 'aria-label': 'Ir a sección', class: 'nav-movil' }, secciones.map(function (v) {
    return h('option', { value: v[0] }, v[1]);
  }));
  movil.value = S.vista; movil.addEventListener('change', function () { irA(movil.value); });
  nav.appendChild(movil);
  secciones.forEach(function (v) {
    nav.appendChild(h('button', { class: 'nav-' + v[0] + (S.vista === v[0] ? ' activo' : ''), 'aria-current': S.vista === v[0] ? 'page' : null, onclick: function () { irA(v[0]); } },
      [iconoPanel(v[0]), v[1], v[0] === 'revision' && S.pendientes ? h('span', { class: 'num' }, S.pendientes) : null]));
  });
}
function irA(vista) {
  if (!S.rol || S.denegado || vista === S.vista) return;
  seleccionExcel.clear();
  clearTimeout(temporizadorBusqueda);
  S.vista = vista; S.buscar = ''; S.filtro = ['facturas', 'albaranes'].indexOf(vista) >= 0 ? 'Activos' : ''; S.pagina = 1; pintarMenu(); cargar(true);
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
  seleccionExcel.clear();
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
    }).catch(function (err) { boton.disabled = false; mensaje.className = 'mensaje error'; mensaje.textContent = mensajeError(err); });
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
  var solicitud = { numero: ++secuenciaCarga, vista: S.vista, empresa: S.empresa, todasEmpresas: !!S.todasEmpresas, carpeta: S.carpeta, mes: S.mes, pagina: S.pagina, buscar: S.buscar, filtro: S.filtro };
  var vista = document.getElementById('vista');
  if (mostrarCargando) {
    var destino = conservarBarra && document.getElementById('cuerpo') || vista;
    destino.textContent = ''; destino.appendChild(h('div', { class: 'cargando', role: 'status' }, 'Cargando…'));
  }
  var promesa;
  if (solicitud.vista === 'inicio') promesa = rpc('panel_inicio');
  else if (solicitud.vista === 'tablas') promesa = cargarRegistros(solicitud.pagina);
  else if (solicitud.vista === 'facturas' || solicitud.vista === 'albaranes') promesa = cargarTabla(solicitud);
  else if (solicitud.vista === 'revision') promesa = rpc('panel_revision');
  else if (solicitud.vista === 'usuarios') promesa = consulta(sb.from('usuarios').select('*').order('email')).then(function (r) { return r.data; });
  else if (solicitud.vista === 'negocio') promesa = rpc('panel_negocio', { p_empresa: solicitud.empresa, p_mes: solicitud.mes });
  else promesa = cargarCarpeta(solicitud.carpeta);
  promesa.then(function (d) {
    if (solicitud.numero !== secuenciaCarga) return;
    if (!mostrarCargando && interaccionExcel()) return;
    if (solicitud.vista === 'tablas' && d.volverAlInicio) { S.pagina = 1; cargar(true); return; }
    var tablaAnterior = solicitud.vista === 'tablas' && !mostrarCargando && vista.querySelector('.tabla');
    var desplazamiento = tablaAnterior && [tablaAnterior.scrollLeft, tablaAnterior.scrollTop];
    S.datos = d;
    if (solicitud.vista === 'inicio') { pintarCabecera(d); S.pendientes = contarPendientes(d); pintarMenu(); }
    if (solicitud.vista === 'revision') { S.pendientes = contarDocumentosRevision(d); pintarMenu(); }
    pintar();
    var tablaActual = desplazamiento && vista.querySelector('.tabla');
    if (tablaActual) { tablaActual.scrollLeft = desplazamiento[0]; tablaActual.scrollTop = desplazamiento[1]; }
    document.getElementById('actualizado').textContent = solicitud.vista === 'inicio' && d.hora ? 'Datos de Inicio a las ' + hora(d.hora) : 'Consulta recibida a las ' + new Date().toLocaleTimeString('es-ES');
  }).catch(function (e) {
    if (solicitud.numero !== secuenciaCarga) return;
    if (solicitud.vista === 'tablas' && !/ACCESO_DENEGADO|JWT|token|session/i.test(mensajeError(e))) {
      S.datos = { error: mensajeError(e) }; pintar();
    } else mostrarError(e);
  });
}
function limpiarBusqueda(q) { return q.replace(/[,()"'\\%*]/g, ' ').trim().slice(0, 100); }
function consultaDocumentos(s) {
  var tabla = s.vista, campo = tabla === 'facturas' ? 'estado' : 'estado_factura';
  var q = sb.from(tabla).select('*', { count: 'exact' });
  if (!s.todasEmpresas) q = q.eq('empresa', s.empresa);
  if (s.filtro === 'Activos') q = q.not('estado', 'in', '("Descartado","Duplicado")');
  else if (s.filtro === 'Descartado' || s.filtro === 'Duplicado') q = q.eq('estado', s.filtro);
  else if (s.filtro) q = q.eq(campo, s.filtro);
  var b = limpiarBusqueda(s.buscar);
  if (b) {
    var cols = tabla === 'facturas' ? ['id_doc', 'num_factura', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'albaranes']
                                    : ['id_doc', 'num_albaran', 'nombre', 'nif', 'matricula', 'concepto', 'observaciones', 'num_factura', 'origen', 'destino'];
    q = q.or(cols.map(function (c) { return c + '.ilike.%' + b + '%'; }).join(','));
  }
  return q.order('fecha', { ascending: false, nullsFirst: false }).order('empresa').order('id_doc', { ascending: false });
}
function cargarTabla(s) {
  var desde = (s.pagina - 1) * 50;
  return consulta(consultaDocumentos(s).range(desde, desde + 49)).then(function (r) {
    return { filtros: s, paginada: true, pagina: s.pagina, tamano: 50, total: r.count || 0, filas: r.data || [] };
  });
}
function contarPendientes(ini) { return ini.empresas.reduce(function (t, e) { return t + Number(e.documentosConAvisos || 0); }, 0) + Number(ini.enRevisionManual || 0); }
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
  var titulo = S.vista === 'inicio' ? 'Resumen de gestión' : S.vista === 'usuarios' ? 'Gestionar accesos' : VISTAS.find(function (v) { return v[0] === S.vista; })[1];
  var cabecera = h('div', { class: 'cab-vista' }, [h('h1', {}, titulo)]);
  if (S.vista === 'inicio') cabecera.appendChild(descargaDirecta('Descargar tablas en Excel', function () { return { claves: tablasVisibles() }; }));
  vista.appendChild(cabecera);
  ({ inicio: vInicio, facturas: vFacturas, albaranes: vAlbaranes, revision: vRevision, documentos: vDocumentos, usuarios: vUsuarios, negocio: vNegocio, tablas: vTablas })[S.vista](vista, S.datos);
  if (busqueda && document.getElementById('busquedaTabla')) { var n = document.getElementById('busquedaTabla'); n.focus(); n.setSelectionRange(cursor, cursor); }
}

// ---------------------------------------------------------------------
// INICIO
// ---------------------------------------------------------------------
function vInicio(v, d) {
  var s = d.servicio || {};
  function tarjeta(clave, nombre, valor) {
    return h('button', { class: 'metrica metrica-' + clave, onclick: function () { S.todasEmpresas = true; irA(clave); } }, [
      h('span', { class: 'metrica-icono' }, iconoPanel(clave)), h('span', { class: 'metrica-nombre' }, nombre),
      h('strong', {}, valor), h('span', { class: 'flecha', 'aria-hidden': 'true' }, '↗')]);
  }
  function sumar(campo) { return d.empresas.reduce(function (n, e) { return n + Number(e[campo] || 0); }, 0); }
  v.appendChild(h('div', { class: 'metricas' }, [tarjeta('facturas', 'Facturas activas', sumar('facturas')),
    tarjeta('albaranes', 'Albaranes activos', sumar('albaranes')), tarjeta('revision', 'Pendientes de revisión', contarPendientes(d))]));

  if (S.rol === 'Revisor' || S.rol === 'Administrador') {
    var archivo = h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.heic,.heif,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.txt,.xml,.xsig' });
    var estadoSubida = h('span', { class: 'mensaje-ficha', role: 'status' });
    archivo.addEventListener('change', function () {
      var f = archivo.files[0]; if (!f) return;
      if (f.size > 15 * 1024 * 1024) { estadoSubida.className = 'mensaje-ficha fallo'; estadoSubida.textContent = 'El archivo supera 15 MB.'; return; }
      var nombre = f.name.replace(/[\\/:*?"<>|#%]/g, '_').replace(/^\.+/, '');
      if (!/\.(pdf|jpe?g|png|webp|gif|bmp|tiff?|heic|heif|docx?|odt|rtf|xlsx?|ods|csv|txt|xml|xsig)$/i.test(nombre)) { estadoSubida.className = 'mensaje-ficha fallo'; estadoSubida.textContent = 'Tipo de archivo no admitido.'; return; }
      estadoSubida.className = 'mensaje-ficha'; estadoSubida.textContent = 'Subiendo…';
      sb.storage.from('entrada').upload(Date.now() + '_' + nombre, f, { contentType: f.type || 'application/octet-stream', upsert: false }).then(function (r) {
        if (r.error) throw r.error;
        estadoSubida.className = 'mensaje-ficha exito'; estadoSubida.textContent = 'Documento enviado. El servicio lo recogerá en su próxima vuelta.'; archivo.value = '';
      }).catch(function (e) { estadoSubida.className = 'mensaje-ficha fallo'; estadoSubida.textContent = mensajeError(e); });
    });
    v.appendChild(h('div', { class: 'tarjeta' }, [h('h3', {}, 'Subir documentos'), h('div', { class: 'en-linea' }, [archivo,
      h('button', { class: 'boton', onclick: function () {
        rpc('panel_procesar_ahora').then(function (r) { estadoSubida.className = 'mensaje-ficha exito'; estadoSubida.textContent = r.repetida ? 'Ya había una orden pendiente; el servicio la atenderá.' : 'Orden enviada. El servicio la atenderá cuando esté en marcha.'; })
          .catch(function (e) { estadoSubida.className = 'mensaje-ficha fallo'; estadoSubida.textContent = mensajeError(e); });
      } }, 'Procesar ahora'), estadoSubida])]));
  }
  var detalleServicio = h('details', { class: 'servicio-detalle' }, [h('summary', {}, 'Actividad del servicio'), h('div', { class: 'fila' }, [
    h('div', { class: 'tarjeta' }, [h('div', { class: 'etq' }, 'Coste de la IA este mes'), h('div', { class: 'cifra' }, costeEuros(d.costeMes))]),
    h('div', { class: 'tarjeta' }, [h('div', { class: 'etq' }, 'Servicio'), h('div', { class: 'datos' }, s.conocido ? [
      h('span', {}, 'Última señal'), h('b', {}, hora(s.latido)), h('span', {}, 'Correo (Gmail)'), h('b', {}, s.gmail_conectado ? 'Conectado' : 'Desconectado'),
      h('span', {}, 'Última vuelta'), h('b', {}, s.ultima_vuelta ? hora(s.ultima_vuelta.hora) + ' · ' + s.ultima_vuelta.motivo : '—'),
      h('span', {}, 'En documentos_entrada'), h('b', {}, s.en_entrada === undefined ? '—' : s.en_entrada)
    ] : [h('span', {}, 'El servicio aún no ha enviado su estado'), h('b', {}, '')])])
  ])]);
  v.appendChild(h('h2', {}, 'Empresas'));
  v.appendChild(h('div', { class: 'fila' }, d.empresas.map(function (e, i) {
    return h('div', { class: 'tarjeta empresa empresa-' + i }, [h('h3', {}, e.nombre), e.cif ? h('div', { class: 'sub' }, 'CIF ' + e.cif) : null,
      h('div', { class: 'datos' }, [h('span', {}, 'Facturas activas'), h('b', {}, e.facturas || 0),
        h('span', {}, 'Albaranes sin factura'), h('b', {}, e.pendientes || 0)]),
      h('div', { class: 'en-linea' }, ['facturas', 'albaranes'].map(function (tipo) {
        return h('button', { class: 'boton', onclick: function () { S.empresa = e.nombre; S.todasEmpresas = false; irA(tipo); } }, tipo === 'facturas' ? 'Ver facturas' : 'Ver albaranes');
      })),
      h('details', { class: 'detalle-empresa' }, [h('summary', {}, 'Desglose'), h('div', { class: 'datos' }, [
        h('span', {}, 'Facturas registradas'), h('b', {}, e.facturasRegistradas || 0), h('span', {}, 'Albaranes registrados'), h('b', {}, e.albaranesRegistrados || 0),
        h('span', {}, 'Emitidas activas'), h('b', {}, e.emitidas || 0), h('span', {}, 'Recibidas activas'), h('b', {}, e.recibidas || 0),
        h('span', {}, 'Sin clasificar'), h('b', {}, e.sinClasificar || 0), h('span', {}, 'Albaranes activos'), h('b', {}, e.albaranes || 0),
        h('span', {}, 'Para revisar'), h('b', {}, e.revisar || 0), h('span', {}, 'Descartados'), h('b', {}, e.descartados || 0),
        h('span', {}, 'Duplicados'), h('b', {}, e.duplicados || 0)])])]);
  })));
  v.appendChild(h('h2', {}, 'Últimos documentos'));
  tabla(v, ['Empresa', 'ID', { t: 'Archivo', largo: 1 }, 'Estado', 'Alta'], d.ultimos.map(function (x) { return { celdas: [x.empresa, x.id, x.archivo, pillEstado(x.estado), fecha(x.fecha)] }; }));
  v.appendChild(detalleServicio);
}

// ---------------------------------------------------------------------
// FACTURAS y ALBARANES
// ---------------------------------------------------------------------
function barraEmpresa(v, opcionesFiltro) {
  var chips = h('div', { class: 'chips' }, [null].concat(EMPRESAS).map(function (e) {
    var activo = e === null ? S.todasEmpresas : !S.todasEmpresas && S.empresa === e;
    return h('button', { class: activo ? 'activo' : '', 'aria-pressed': activo ? 'true' : 'false', onclick: function () {
      if (activo) return;
      clearTimeout(temporizadorBusqueda); S.todasEmpresas = e === null;
      if (e !== null) S.empresa = e;
      S.pagina = 1; cargar(true);
    } }, e || 'Todas');
  }));
  var buscar = h('input', { id: 'busquedaTabla', type: 'search', maxlength: '100', 'aria-label': 'Buscar en toda la tabla', placeholder: 'Buscar número, nombre, NIF, matrícula…' });
  buscar.value = S.buscar;
  buscar.addEventListener('input', function () { S.buscar = buscar.value; S.pagina = 1; ++secuenciaCarga; clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(function () { cargar(true, true); }, 350); });
  var filtro = h('select', { 'aria-label': 'Filtrar por estado' }, opcionesFiltro.map(function (o) { var op = h('option', { value: o[0] }, o[1]); if (o[0] === S.filtro) op.selected = true; return op; }));
  filtro.addEventListener('change', function () { clearTimeout(temporizadorBusqueda); S.filtro = filtro.value; S.pagina = 1; cargar(true, true); });
  v.appendChild(h('div', { class: 'barra' }, [chips, buscar, filtro, h('span', { class: 'contador', id: 'contador' })]));
  v.appendChild(h('div', { id: 'cuerpo' }));
}
function botonExcelResultados(d) {
  var filtros = d.filtros;
  var descarga = descargaDirecta('Descargar resultados en Excel', function () {
    return { claves: [filtros.vista], empresa: filtros.todasEmpresas ? '' : filtros.empresa, filtros: filtros };
  });
  document.getElementById('contador').parentElement.appendChild(descarga);
  function desactivar() { descarga.querySelector('button').disabled = true; }
  document.getElementById('busquedaTabla').addEventListener('input', desactivar);
  document.querySelector('[aria-label="Filtrar por estado"]').addEventListener('change', desactivar);
}
function paginacion(c, d) {
  if (d.total <= d.tamano) return;
  var anterior = h('button', { class: 'boton', onclick: function () { S.pagina = d.pagina - 1; cargar(true, true); } }, 'Anterior');
  var siguiente = h('button', { class: 'boton', onclick: function () { S.pagina = d.pagina + 1; cargar(true, true); } }, 'Siguiente');
  anterior.disabled = d.pagina <= 1; siguiente.disabled = d.pagina * d.tamano >= d.total;
  c.appendChild(h('div', { class: 'barra' }, [anterior, h('span', {}, 'Página ' + d.pagina + ' de ' + Math.ceil(d.total / d.tamano)), siguiente]));
}
function contadorTabla(d, tipo) { return !d.total ? '0 ' + tipo : ((d.pagina - 1) * d.tamano + 1) + '–' + Math.min(d.pagina * d.tamano, d.total) + ' de ' + d.total + ' ' + tipo; }
function vFacturas(v, d) {
  barraEmpresa(v, [['Activos', 'Activos'], ['', 'Historial completo'], ['Procesado', 'Procesado'], ['Revisar', 'A revisar'], ['Descartado', 'Descartados'], ['Duplicado', 'Duplicados']]);
  document.getElementById('contador').textContent = contadorTabla(d, 'facturas');
  botonExcelResultados(d);
  var c = document.getElementById('cuerpo');
  tabla(c, ['Nº factura', 'Empresa', 'Tipo', 'Fecha', 'Cliente / proveedor', { t: 'Total', num: 1 }, 'Vence', 'Estado', 'Albaranes'], d.filas.map(function (f) {
    return { abrir: function () { ficha('Factura', f, { empresa: f.empresa, hoja: 'facturas' }); },
      celdas: [f.num_factura, f.empresa, f.tipo_factura, fecha(f.fecha), f.nombre, { t: euros(f.total), num: 1 }, vence(f.fecha_vencimiento), pillEstado(f.estado), pillEstado(f.comprobacion_albaranes)] };
  }), 'Factura');
  paginacion(c, d);
}
function vAlbaranes(v, d) {
  barraEmpresa(v, [['Activos', 'Activos'], ['', 'Historial completo'], ['PENDIENTE DE FACTURA', 'Pendientes de factura'], ['Facturado', 'Facturados'], ['Descartado', 'Descartados'], ['Duplicado', 'Duplicados']]);
  document.getElementById('contador').textContent = contadorTabla(d, 'albaranes');
  botonExcelResultados(d);
  var c = document.getElementById('cuerpo');
  tabla(c, ['Nº albarán', 'Empresa', 'Fecha', 'Cliente / proveedor', 'Ruta', { t: 'Importe', num: 1 }, 'Factura', 'Días sin factura'], d.filas.map(function (f) {
    return { abrir: function () { ficha('Albarán', f, { empresa: f.empresa, hoja: 'albaranes' }); },
      celdas: [f.num_albaran, f.empresa, fecha(f.fecha), f.nombre, [f.origen, f.destino].filter(Boolean).join(' → '), { t: euros(f.importe), num: 1 },
        f.factura_vinculada ? pillEstado('Facturado') : pillEstado(f.estado_factura), texto(f.dias_sin_factura)] };
  }), 'Albarán');
  paginacion(c, d);
}

// ---------------------------------------------------------------------
// REVISIÓN
// ---------------------------------------------------------------------
function vRevision(v, lista) {
  var tipos = ['', 'Factura a revisar', 'Albarán a revisar', 'Albarán sin factura', 'Revisión manual'];
  v.appendChild(h('div', { class: 'barra' }, h('div', { class: 'chips' }, tipos.map(function (t) {
    return h('button', { class: S.filtro === t ? 'activo' : '', onclick: function () { S.filtro = t; pintar(); } }, (t || 'Todo') + ' (' + lista.filter(function (x) { return !t || x.tipo === t; }).length + ')');
  }))));
  var filas = lista.filter(function (x) { return !S.filtro || x.tipo === S.filtro; });
  if (!filas.length) { v.appendChild(h('div', { class: 'tarjeta vacio' }, 'No hay nada pendiente de revisar.')); return; }
  tabla(v, ['Qué pasa', 'Empresa', 'ID', { t: 'Documento', largo: 1 }, 'Fecha', 'Cliente / proveedor', { t: 'Importe', num: 1 }, { t: 'Motivo', largo: 1 }], filas.map(function (x) {
    return { abrir: function () { abrirFichaPorId(x.hoja === 'facturas' ? 'Factura' : x.hoja === 'albaranes' ? 'Albarán' : 'Revisión manual', x.empresa, x.hoja, x.id); },
      celdas: [pillEstado(x.tipo === 'Albarán sin factura' ? 'PENDIENTE DE FACTURA' : x.tipo), x.empresa === '_revision' ? 'Revisión' : x.empresa, x.id, x.numero, fecha(x.fecha), x.nombre, { t: euros(x.total), num: 1 }, x.motivo] };
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
  v.appendChild(h('h3', {}, 'Usuarios del panel'));
  var reenviar = h('button', { class: 'boton', type: 'button', onclick: function () {
    if (!email.value.trim()) { msg.className = 'mensaje error'; msg.textContent = 'Elige primero un usuario de la lista.'; return; }
    rpc('panel_reenviar_invitacion', { p_email: email.value.trim() })
      .then(function () { msg.className = 'mensaje ok'; msg.textContent = 'Invitación pendiente: se enviará en menos de un minuto.'; cargar(false); })
      .catch(function (e) { msg.className = 'mensaje error'; msg.textContent = mensajeError(e); });
  } }, 'Reenviar invitación');
  v.appendChild(h('div', { class: 'tarjeta' }, [h('p', { class: 'sub' }, 'El acceso es solo por invitación. Al guardar un correo nuevo, le llegará en menos de un minuto un correo para elegir su contraseña (si el ordenador del servicio está encendido).'),
    h('div', { class: 'formulario' }, [h('label', {}, ['Correo', email]), h('label', {}, ['Nombre', nombre]), h('label', {}, ['Rol', rol]), h('label', { class: 'en-linea' }, [activo, ' Activo']),
      h('div', { class: 'en-linea' }, [h('button', { class: 'boton principal', onclick: function () {
        if (!email.value.trim()) { msg.className = 'mensaje error'; msg.textContent = 'Escribe el correo de la persona.'; return; }
        rpc('panel_guardar_usuario', { p_email: email.value.trim(), p_nombre: nombre.value.trim(), p_rol: rol.value, p_activo: activo.checked })
          .then(function () { cargar(true); }).catch(function (e) { msg.className = 'mensaje error'; msg.textContent = mensajeError(e); });
      } }, 'Guardar e invitar'), reenviar])]), msg]));
  function estadoInvitacion(u) {
    if (!u.activo) return 'Desactivado';
    if (u.invitacion_error) return 'Error al invitar';
    return u.invitado_en ? 'Enviada ' + fecha(String(u.invitado_en).slice(0, 10)) : 'Pendiente de enviar';
  }
  tabla(v, ['Correo', 'Nombre', 'Rol', 'Activo', 'Invitación'], usuarios.map(function (u) {
    return { celdas: [u.email, u.nombre, u.rol, u.activo ? 'Sí' : 'No', estadoInvitacion(u)], abrir: function () { email.value = u.email; nombre.value = u.nombre || ''; rol.value = u.rol; activo.checked = !!u.activo; email.focus(); } };
  }));
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
    return consulta(sb.from('documentos').select('id_doc,archivo_original').eq('empresa', empresa).in('id_doc', facturas.map(function (f) { return f.id_doc; }))).then(function (rd) {
      var docs = {}; (rd.data || []).forEach(function (d) { docs[d.id_doc] = d; });
      return facturas.reduce(function (p, f) {
        return p.then(function () {
          var d = docs[f.id_doc]; if (!d || !d.archivo_original) { faltan.push(f.id_doc); return; }
          var ruta = 'originales/' + empresa + '/' + f.id_doc + '_' + d.archivo_original;
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
      return h('td', { class: clases(columnas[i] || {}) }, obj ? c.t : c);
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
  function valorEntrada(c) { return c === 'fecha_vencimiento' && (base[c] === null || base[c] === undefined) ? '' : texto(base[c]); }
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
      base = Object.assign({}, r.fila);
      Object.keys(entradas).forEach(function (c) { entradas[c].value = c === 'estado_cobro_pago' && !base[c] ? 'Pendiente' : valorEntrada(c); });
      estado.textContent = base.estado || 'Sin estado'; estado.className = 'pill ' + (base.estado === 'Procesado' ? 'ok' : 'aviso');
      mensaje.className = 'mensaje-ficha exito'; mensaje.textContent = revisar ? 'Cambios guardados y documento revisado.' : 'Cambios guardados.';
      ocupado(false); cargar(false);
    }).catch(function (e) { mensaje.className = 'mensaje-ficha fallo'; mensaje.textContent = mensajeError(e); ocupado(false); });
  }
  if (editable) {
    guardar = h('button', { type: 'button', class: 'boton principal', onclick: function () { guardarCambios(false); } }, 'Guardar cambios');
    marcar = h('button', { type: 'button', class: 'boton revisar', onclick: function () { guardarCambios(true); } }, 'Guardar y marcar revisado');
    descartar = h('button', { type: 'button', class: 'boton peligro', onclick: function () {
      if (guardandoFicha || !confirm('¿Quieres descartar este documento? Los cambios sin guardar no se aplicarán.')) return;
      ocupado(true); mensaje.textContent = 'Descartando documento…';
      rpc('panel_descartar', { p_empresa: empresa, p_hoja: hoja, p_id: id }).then(function () { pendientes = 0; fichaSucia = null; guardandoFicha = false; cerrarModal(); cargar(true); })
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
        estadoArchivo.appendChild(h('a', { href: url, target: '_blank', rel: 'noopener', class: 'boton' }, 'Abrir en otra pestaña'));
        if (S.rol === 'Administrador') estadoArchivo.appendChild(h('button', { class: 'boton', onclick: function () { descargar(archivo.ruta, archivo.nombre); } }, 'Descargar'));
      }).catch(function () { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); });
    }
    [['Original', 'original', d.original], ['Copia tachada', 'tachado', d.tachado]].forEach(function (x) { if (x[2]) opcionesDocumento.appendChild(h('button', { class: 'boton', type: 'button', onclick: function () { mostrar(x[1], x[2]); } }, x[0])); });
    if (d.original) mostrar('original', d.original); else if (d.tachado) mostrar('tachado', d.tachado);
    else { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'No hay archivo guardado para este documento (los documentos anteriores al almacén nuevo siguen en la carpeta de Drive).')); }
  }).catch(function () { if (numero === secuenciaFicha) { visor.textContent = ''; visor.appendChild(h('p', { class: 'vacio' }, 'La vista previa no está disponible. Puedes continuar revisando los datos.')); } });
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

// ---------------------------------------------------------------------
// Arranque: ¿hay sesión? → panel; si no → pantalla de entrada
// ---------------------------------------------------------------------
function arrancar() {
  seleccionExcel.clear();
  ++secuenciaCarga;
  tablaElegida = 'facturas'; empresaTablas = '';
  S.denegado = false; S.vista = 'inicio'; S.rol = null;
  sb.auth.getSession().then(function (r) {
    if (!r.data || !r.data.session) { pantallaAcceso('entrar'); return; }
    document.getElementById('vista').textContent = ''; document.getElementById('vista').appendChild(h('div', { class: 'cargando' }, 'Cargando…'));
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
function interaccionExcel() {
  return !!document.querySelector('.excel-opciones[open], [aria-busy="true"], .servicio-detalle[open], .detalle-empresa[open]');
}
setInterval(function () {
  if (interaccionExcel()) return;
  var escribiendo = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (S.rol && !S.denegado && !document.getElementById('modal').classList.contains('abierto') && !escribiendo && !document.hidden) cargar(false);
}, 30000);
