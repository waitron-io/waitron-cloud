import { calculateCosts, defaultControls, controlLimits } from './calculator.mjs';

const text = {
  en: { title: 'What Cloud could cost', intro: 'Compare the platform cost and the cost per venue. This is an incomplete estimate: the priced subtotal leaves out the costs listed below.',
    language: 'Language', theme: 'Theme', light: 'Light', dark: 'Dark', assumptions: 'Your assumptions', advanced: 'More assumptions',
    advancedNote: 'Every editable number is assumed. Blank means unknown. These are illustrative configurations, not a deployment choice or a capacity promise.',
    incomplete: 'Incomplete. The subtotal includes only priced lines. The full bill is unknown.', invalid: 'Check the values. Counts need whole numbers; negative values and values outside the shown limits are refused.',
    prices: 'Price snapshot: 14 October 2026', local: 'Local measurements: 21 October 2026', noLive: 'AWS trial: stopped before creation',
    results: 'Monthly priced subtotal', venue: 'Venues', fixed: 'Shared platform', variable: 'Venue usage', subtotal: 'Priced subtotal', range: 'Assumed low–high', average: 'Subtotal / venue',
    resultNote: 'USD/month, before allowances, credits and tax. Missing lines are excluded from the subtotal; the total remains unknown.',
    sensitivity: 'Low/base/high vary future archive growth, sales-request cadence and owner-session volume by 0.5 / 1 / 2. Capacity varies inversely. Startup and idle stay separate.',
    storage: 'Storage keeps growing', monthOne: 'Month one', mature: 'Later retention window', storageNote: 'Assumed average retained bytes per venue. Daily copies keep 30 days; separate monthly copies use your retention setting. The later window includes continued growth, not a steady database size.',
    storageMissing: 'Archive growth cannot be calculated until its assumptions are filled.', trial: 'The AWS trial did not run', trialNote: 'Object sizes, lifetimes, schedules and retry limits are incomplete. The illustrative high-cadence request scenario also exceeds the 10,000-request cap. Nothing was created and no billing read is due for this trial.',
    evidence: 'What the evidence covers', evidenceNote: 'The samples cover separate local experiments. Repeating them in a forecast is an assumption; it does not measure a typical trading day or a production bill.',
    sales: 'Successfully replayed sales', archiveBytes: 'Selected-sale archive', sessionBytes: 'Encrypted response bytes in one generated owner journey', measured: 'Measured locally', assumed: 'Assumed', unknown: 'Unknown',
    gaps: 'Costs and evidence still missing', inventory: 'Complete capability inventory', sources: 'Price sources and dates',
    required: 'Required; cost coverage incomplete', candidate: 'Alternative; not selected', excluded: 'Outside the initial service',
    footer: 'Runs offline. No private data, provider calls or remote dependencies. Workload quantities use an assumed 31-day month; running resources use 730 hours. Archive storage uses calendar windows from January 2027. Noncurrent versions, failed replacement protection, restores and traffic paths remain gaps. Gross list cost is separate from free allowances, credits, tax and external mail, fiscal API and GitHub charges. The prior storage rehearsal and its billing follow-up are separate.',
    single: 'Single zone (assumption)', redundant: 'Redundant (assumption)', spain: 'Spain', stockholm: 'Stockholm', bounds: 'Allowed', units: 'bytes',
    breakdown: 'Line quantities and costs at 10 venues', alternative: 'Month-one alternative; excluded from this subtotal',
  },
  es: { title: 'Cuánto podría costar Cloud', intro: 'Compara el coste de la plataforma y el coste por local. La estimación está incompleta: el subtotal excluye los costes que se indican más abajo.',
    language: 'Idioma', theme: 'Tema', light: 'Claro', dark: 'Oscuro', assumptions: 'Tus supuestos', advanced: 'Más supuestos',
    advancedNote: 'Cada cifra editable es un supuesto. Un campo vacío indica que se desconoce. Son configuraciones ilustrativas, sin decisión de despliegue ni garantía de capacidad.',
    incomplete: 'Estimación incompleta. El subtotal solo incluye conceptos con precio. El total se desconoce.', invalid: 'Revisa los valores. Usa enteros para los recuentos; no se admiten cifras negativas ni fuera de los límites indicados.',
    prices: 'Precios consultados: 14 de octubre de 2026', local: 'Mediciones locales: 21 de octubre de 2026', noLive: 'Prueba de AWS: detenida antes de crear recursos',
    results: 'Subtotal mensual con precio', venue: 'Locales', fixed: 'Plataforma compartida', variable: 'Uso de los locales', subtotal: 'Subtotal con precio', range: 'Supuesto bajo–alto', average: 'Subtotal / local',
    resultNote: 'USD/mes, antes de franquicias, créditos e impuestos. El subtotal excluye los conceptos pendientes; el total sigue sin conocerse.',
    sensitivity: 'Los escenarios bajo/base/alto multiplican el crecimiento del archivo, las solicitudes por venta y las sesiones por 0,5 / 1 / 2. La capacidad varía a la inversa. El arranque y la inactividad se calculan por separado.',
    storage: 'El almacenamiento sigue creciendo', monthOne: 'Primer mes', mature: 'Ventana de retención posterior', storageNote: 'Supuesto de bytes retenidos medios por local. Las copias diarias se guardan 30 días; las mensuales independientes usan tu retención. La ventana posterior incluye crecimiento continuo.',
    storageMissing: 'Completa los supuestos del archivo para calcular su crecimiento.', trial: 'La prueba de AWS no se ejecutó', trialNote: 'Faltan tamaños, duraciones, calendarios y límites de reintentos. El escenario ilustrativo de cadencia alta también supera el límite de 10.000 solicitudes. No se crearon recursos ni corresponde consultar su facturación.',
    evidence: 'Qué cubren las mediciones', evidenceNote: 'Las muestras corresponden a experimentos locales independientes. Repetirlas en una previsión es un supuesto; no mide un día típico ni una factura de producción.',
    sales: 'Ventas reproducidas correctamente', archiveBytes: 'Archivo de las ventas seleccionadas', sessionBytes: 'Bytes cifrados de respuesta en una sesión generada del propietario', measured: 'Medido localmente', assumed: 'Supuesto', unknown: 'Desconocido',
    gaps: 'Costes y pruebas pendientes', inventory: 'Inventario completo de funciones', sources: 'Fuentes de precios y fechas',
    required: 'Necesario; coste incompleto', candidate: 'Alternativa sin seleccionar', excluded: 'Fuera del servicio inicial',
    footer: 'Funciona sin conexión. Sin datos privados, llamadas al proveedor ni dependencias remotas. El uso supone meses de 31 días; los recursos en ejecución, 730 horas. Los archivos usan ventanas de calendario desde enero de 2027. Siguen pendientes versiones anteriores, protección ante verificaciones fallidas, restauraciones y rutas de tráfico. Precios brutos separados de franquicias, créditos, impuestos y cargos externos de correo, API fiscal y GitHub. El ensayo de almacenamiento previo y su facturación son independientes.',
    single: 'Una zona (supuesto)', redundant: 'Redundante (supuesto)', spain: 'España', stockholm: 'Estocolmo', bounds: 'Límites', units: 'bytes',
    breakdown: 'Cantidades y costes para 10 locales', alternative: 'Alternativa del primer mes; excluida del subtotal',
  },
};
const fields = {
  region: ['Region', 'Región'], ordersPerDay: ['Orders per day', 'Pedidos por día'], retentionMonths: ['Monthly archive retention (months)', 'Retención de archivos mensuales (meses)'],
  sessionsPerMonth: ['Owner sessions per month', 'Sesiones del propietario por mes'], topology: ['Illustrative layout', 'Configuración ilustrativa'],
  capacity: ['Venues per gateway group', 'Locales por grupo de pasarelas'], databaseCapacity: ['Venues per database', 'Locales por base de datos'],
  warmCells: ['Cells running with no venues', 'Grupos activos sin locales'], controlDiskGB: ['Control disk (billed GB)', 'Disco de control (GB facturados)'],
  gatewayDiskGB: ['Gateway disk (billed GB)', 'Disco de pasarela (GB facturados)'], databaseGB: ['Database disk (billed GB)', 'Disco de base de datos (GB facturados)'],
  natGateways: ['Private network exits (NAT)', 'Salidas de red privada (NAT)'], platformKeys: ['Platform encryption keys (KMS)', 'Claves de cifrado de plataforma (KMS)'], venueKeys: ['KMS encryption keys per venue', 'Claves de cifrado KMS por local'],
  archiveBaseBytes: ['Starting archive size (bytes)', 'Tamaño inicial del archivo (bytes)'], growthFactor: ['Future growth multiplier', 'Multiplicador de crecimiento futuro'],
  cadenceFactor: ['Sales-request cadence multiplier', 'Multiplicador de solicitudes por venta'], idleSeconds: ['Idle seconds per day', 'Segundos de inactividad por día'],
  startsPerDay: ['Starts per day', 'Arranques por día'], sessionOverhead: ['Session traffic multiplier', 'Multiplicador del tráfico por sesión'],
  egressBytesPerGB: ['Assumed bytes per billed transfer GB', 'Supuesto de bytes por GB de transferencia facturado'], publicGB: ['Public transfer per venue (billed GB/month)', 'Tráfico público por local (GB facturados/mes)'],
};
const capabilities = {
  'control-compute': ['Control compute', 'Cómputo de control'], 'control-disks': ['Control disks', 'Discos de control'],
  'gateway-compute': ['Gateway compute', 'Cómputo de pasarela'], 'gateway-disks': ['Gateway disks', 'Discos de pasarela'],
  'database-compute': ['Database compute', 'Cómputo de base de datos'], 'database-disks': ['Database disks', 'Discos de base de datos'],
  'public-addresses': ['Public addresses', 'Direcciones públicas'], 'nat-hours': ['Private network exit hours', 'Horas de salida de red privada'],
  'platform-keys': ['Platform keys', 'Claves de plataforma'], 'dns-zone': ['DNS zone', 'Zona DNS'], 'venue-keys': ['Venue keys', 'Claves por local'],
  'stream-write-list': ['Stream writes and listings', 'Escrituras y listados de copia'], 'stream-read': ['Stream reads', 'Lecturas de copia'],
  'archive-month-one': ['Month-one archive storage', 'Almacenamiento del primer mes'], 'archive-mature': ['Later archive storage', 'Almacenamiento posterior'],
  'internet-transfer': ['Internet transfer', 'Transferencia de internet'],
  'control-runtime': ['API and workers', 'API y procesos'], 'runtime-disks': ['Runtime disks', 'Discos de ejecución'],
  'runtime-images': ['Container images and pulls', 'Imágenes y descargas'], 'provision-cleanup': ['Provisioning and cleanup', 'Creación y limpieza'],
  'management-postgres': ['Management database and capacity', 'Base de datos de gestión y capacidad'], 'database-backup': ['Database recovery', 'Recuperación de la base de datos'],
  'public-ingress': ['Public HTTPS entry', 'Entrada HTTPS pública'], 'cell-gateway': ['Staff and public gateways', 'Pasarelas de personal y público'],
  certificates: ['Certificates and renewal', 'Certificados y renovación'], 'public-ipv4': ['Public IPv4 addresses', 'Direcciones IPv4 públicas'],
  'internet-paths': ['Internet transfer and paths', 'Transferencia y rutas de internet'], 'regional-paths': ['Regional and cross-zone transfer', 'Transferencia regional y entre zonas'],
  'internet-gateway': ['Internet gateway', 'Pasarela de internet'], dns: ['DNS zones and queries', 'Zonas y consultas DNS'], domain: ['Domain registration', 'Registro del dominio'],
  'iam-sts': ['Identity and temporary credentials', 'Identidad y credenciales temporales'], 'venue-key': ['Venue encryption keys', 'Claves de cifrado por local'],
  'platform-secrets': ['Platform secrets', 'Secretos de plataforma'], 'retained-keys': ['Retained and rotated keys', 'Claves retenidas y rotadas'],
  'continuous-stream': ['Continuous backup stream', 'Copia continua'], 'retained-archives': ['Retained archives and verification', 'Archivos retenidos y verificación'],
  'versions-multipart': ['Versions and unfinished uploads', 'Versiones y cargas incompletas'], verification: ['Backup verification capacity', 'Capacidad de verificación'],
  'venue-restore': ['Venue restore capacity', 'Capacidad de restauración'], logs: ['Logs and queries', 'Registros y consultas'],
  'metrics-alerts': ['Metrics and external alerts', 'Métricas y alertas externas'], audit: ['Audit history', 'Historial de auditoría'],
  'spend-controls': ['Budget and billing controls', 'Controles de presupuesto y facturación'], mail: ['Transactional email', 'Correo transaccional'],
  ci: ['GitHub Actions', 'GitHub Actions'], 'fiscal-api': ['Fiscal API and scenario frequency', 'API fiscal y frecuencia de uso'],
  'stream-object-lifetimes': ['Stream object sizes and lifetimes', 'Tamaños y duraciones de los objetos de copia'],
  'scheduled-stream-boundaries': ['Scheduled snapshots and compaction', 'Instantáneas y compactación programadas'],
  'noncurrent-retention': ['Old-version retention', 'Retención de versiones anteriores'],
  'archive-selection-and-protection': ['Archive selection, failures and protected copies', 'Selección de archivos, fallos y copias protegidas'],
  'operation-billing': ['Request classes and failure billing', 'Tipos de solicitud y facturación de fallos'],
  'provider-billing': ['Provider validation and billing comparison', 'Validación del proveedor y comparación de facturación'],
};
const el = (tag, content, attributes = {}) => {
  const node = document.createElement(tag); if (content !== undefined) node.textContent = content;
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value); return node;
};
const $ = id => document.getElementById(id);
const data = JSON.parse($('cost-data').textContent);
let controls = defaultControls(data), language = 'en';
const t = key => text[language][key];
const label = key => fields[key]?.[language === 'en' ? 0 : 1] ?? capabilities[key]?.[language === 'en' ? 0 : 1] ?? key.replaceAll('-', ' ');
const number = value => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
const money = value => value === null ? t('unknown') : new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
function form() {
  $('primary').replaceChildren(); $('secondary').replaceChildren();
  for (const key of ['region', 'ordersPerDay', 'retentionMonths', 'sessionsPerMonth', 'topology', ...Object.keys(controlLimits)
    .filter(key => !['ordersPerDay', 'retentionMonths', 'sessionsPerMonth'].includes(key))]) {
    const wrapper = el('div'), caption = el('label', label(key), { for: key });
    let input;
    if (['region', 'topology'].includes(key)) {
      input = el('select', undefined, { id: key });
      for (const [value, title] of key === 'region' ? [['eu-south-2', 'spain'], ['eu-north-1', 'stockholm']]
        : [['single', 'single'], ['redundant', 'redundant']]) input.append(el('option', t(title), { value }));
    } else {
      const [min, max, integer] = controlLimits[key];
      input = el('input', undefined, { id: key, type: 'number', min, max, step: integer ? 1 : 'any', inputmode: integer ? 'numeric' : 'decimal',
        'aria-describedby': key + '-hint' });
      wrapper.append(el('small', `${t('assumed')} · ${t('bounds')}: ${number(min)}–${number(max)}`, { id: key + '-hint' }));
    }
    input.value = controls[key] ?? ''; wrapper.prepend(caption, input);
    input.addEventListener('input', update); input.addEventListener('change', update);
    (['region', 'ordersPerDay', 'retentionMonths', 'sessionsPerMonth'].includes(key) ? $('primary') : $('secondary')).append(wrapper);
  }
}
function update() {
  for (const key of Object.keys(controls)) {
    const value = $(key).value; controls[key] = ['region', 'topology'].includes(key) ? value : value.trim() === '' ? null : Number(value);
  }
  window.cloudCostControls = structuredClone(controls);
  try {
    const result = calculateCosts({ data, controls }); window.cloudCostResult = result; $('error').textContent = '';
    const results = $('results'); results.replaceChildren(el('h2', t('results')), el('p', t('resultNote'), { class: 'muted' }));
    const table = el('table'), head = el('thead'), tr = el('tr'), headers = ['venue', 'fixed', 'variable', 'range', 'subtotal', 'average'];
    for (const key of headers) tr.append(el('th', t(key), { scope: 'col' })); head.append(tr); table.append(head);
    const body = el('tbody'), max = Math.max(...result.scenarios.base.rows.map(row => row.subtotal), 1);
    for (const [i, row] of result.scenarios.base.rows.entries()) {
      const tr = el('tr', undefined, { 'data-venues': row.venues });
      const values = [number(row.venues), money(row.fixedSubtotal), money(row.venueSubtotal),
        money(result.scenarios.low.rows[i].subtotal) + ' – ' + money(result.scenarios.high.rows[i].subtotal), money(row.subtotal), money(row.averageSubtotal)];
      for (const [j, value] of values.entries()) {
        const cell = el('td', undefined, { 'data-label': t(headers[j]) }); cell.append(el(j === 4 ? 'strong' : 'span', value));
        if (j === 4) { const bar = el('div', undefined, { class: 'bars', 'aria-hidden': 'true' });
          for (const amount of [row.fixedSubtotal, row.venueSubtotal]) { const part = el('span'); part.style.width = (amount / max * 100) + '%'; bar.append(part); } cell.append(bar); }
        tr.append(cell);
      }
      body.append(tr);
    }
    table.append(body); results.append(table);
    const legend = el('p', undefined, { class: 'legend' });
    for (const key of ['fixed', 'variable']) { const item = el('span'); item.append(el('i'), document.createTextNode(t(key))); legend.append(item); }
    results.append(legend, el('small', t('sensitivity')));
    const breakdown = el('details', undefined, { id: 'breakdown' }); breakdown.append(el('summary', t('breakdown')));
    const list = el('ul', undefined, { class: 'source-list' });
    for (const row of result.scenarios.base.rows[2].lines) {
      const item = el('li', `${label(row.id)}: ${row.quantity === null ? t('unknown') : number(row.quantity)} ${row.unit} · ${money(row.cost)}`,
        { 'data-line-id': row.id });
      item.append(el('small', row.cost === null ? t('unknown') : t('assumed')));
      if (row.id === 'archive-month-one') item.append(el('small', t('alternative')));
      list.append(item);
    }
    breakdown.append(list); results.append(breakdown);
    const archive = result.scenarios.base.archive, storage = $('storage'); storage.replaceChildren(el('h2', t('storage')));
    if (archive) storage.append(el('p', `${t('monthOne')}: ${number(archive.monthOneByteSeconds / archive.monthOneSeconds)} ${t('units')}`),
      el('p', `${t('mature')}: ${number(archive.matureByteSeconds / archive.matureSeconds)} ${t('units')}`), el('small', t('storageNote')));
    else storage.append(el('p', t('storageMissing')));
    $('gaps').replaceChildren(...[...new Set([...result.gaps, ...result.scenarios.base.rows[1].gaps])]
      .map(gap => el('li', label(gap.split(':')[0] === 'inventory' ? gap.split(':')[1] : gap.split(':')[0]))));
  } catch {
    window.cloudCostResult = null; $('error').textContent = t('invalid'); $('results').replaceChildren(); $('storage').replaceChildren();
  }
  document.body.dataset.ready = 'true';
}
function translate() {
  document.documentElement.lang = language; document.title = t('title') + ' · Waitron Cloud';
  document.querySelector('h1').textContent = t('title');
  for (const [id, key] of [['intro', 'intro'], ['language-label', 'language'], ['theme-label', 'theme'],
    ['assumption-heading', 'assumptions'], ['advanced-label', 'advanced'], ['advanced-note', 'advancedNote'], ['status', 'incomplete'],
    ['evidence-heading', 'evidence'], ['evidence-note', 'evidenceNote'], ['gaps-label', 'gaps'], ['inventory-label', 'inventory'],
    ['sources-label', 'sources'], ['footer', 'footer']]) $(id).textContent = t(key);
  for (const option of $('theme').options) option.textContent = t(option.value);
  $('tags').replaceChildren(...['prices', 'local', 'noLive'].map(key => el('span', t(key), { class: 'tag' })));
  $('trial').replaceChildren(el('h2', t('trial')), el('p', t('trialNote')));
  $('evidence').replaceChildren(...[['sales', data.basis.sales], ['archiveBytes', data.basis.archiveBytes], ['sessionBytes', data.basis.ownerBytesOut]]
    .map(([key, value]) => el('p', `${label(key) === key ? t(key) : label(key)}: ${number(value)} · ${t('measured')}`)));
  for (const source of Object.values(data.basis.sources)) {
    const item = el('p', undefined, { class: 'source-list', 'data-evidence-source': source.file });
    item.append(el('a', source.file, { href: 'cost-model/' + source.file }),
      el('small', `${source.observedAt} · ${source.revision}`)); $('evidence').append(item);
  }
  $('inventory').replaceChildren(...data.inventory.map(row => {
    const node = el('div', label(row.id), { class: 'inventory-row' }); node.append(el('small', t(row.inclusion === 'required' ? 'required' : row.inclusion === 'candidate' ? 'candidate' : 'excluded'))); return node;
  }));
  $('sources').replaceChildren(...data.prices.map(rate => {
    const node = el('li'); node.append(el('a', `${rate.id} · ${rate.region} · USD ${rate.value} / ${rate.unit}`, { href: rate.source, rel: 'noreferrer' }),
      el('small', `SKU ${rate.sku} · ${rate.rateCode} · ${rate.retrievedAt} · ${rate.effectiveAt}`)); return node;
  }));
  form(); update();
}
$('language').addEventListener('change', () => { language = $('language').value; translate(); });
$('theme').value = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
document.body.dataset.theme = $('theme').value;
$('theme').addEventListener('change', () => { document.body.dataset.theme = $('theme').value; });
translate();
