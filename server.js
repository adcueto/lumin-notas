import express from 'express';
import session from 'express-session';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const CATS = ['Uñas','Pestañas','Cabello','Cejas','Maquillaje','Depilacion','Facial'];
const EMPLEADAS = ['Adrian','Andy','Ana','Celeste','Dany','Edy','Elena','Blanca','Yareth','Jessica',
  'Melissa','Joseline','Valeria','Lili','Lilian','Lisandro','Liz','Mely','Lupita','Mariana','Luz',
  'Palomina','Jazmin','Nayeli','Ivonne','Waldo','Ingrid','Zuley'];
const GARANTIAS = ['Sí','No','N/A'];
const METODOS = ['Efectivo','Tarjeta','Transferencia','Depósito','Mixto','Otro'];

/* Los valores SIEMPRE salen de las tablas del negocio: nunca se inventa uno nuevo.
   Si lo leído no coincide exacto, se elige el más parecido de la tabla. */
const norm = s => (s||'').toString().trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const distancia = (a, b) => {                        // Levenshtein
  const m = Array.from({length: a.length+1}, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return m[a.length][b.length];
};

// Devuelve el elemento de `tabla` más parecido a `valor` (o el default si viene vacío)
const deTabla = (valor, tabla, porDefecto) => {
  const v = norm(valor);
  if (!v) return porDefecto;
  const exacto = tabla.find(x => norm(x) === v);
  if (exacto) return exacto;
  let mejor = porDefecto, mejorPuntaje = Infinity;
  for (const opt of tabla) {
    const o = norm(opt);
    const puntaje = (o.startsWith(v) || v.startsWith(o))
      ? Math.abs(o.length - v.length) * 0.5
      : distancia(v, o);
    if (puntaje < mejorPuntaje) { mejorPuntaje = puntaje; mejor = opt; }
  }
  return mejor;
};

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*24*30 }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8*1024*1024 },
  fileFilter: (_r, f, cb) => cb(null, f.mimetype.startsWith('image/')) });

const auth = (req, res, next) => req.session.uid ? next() : res.status(401).json({ error: 'Inicia sesión para continuar.' });

/* ── sesión ── */
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE usuario=$1', [usuario]);
  const u = rows[0];
  if (!u || !bcrypt.compareSync(password || '', u.pass_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  req.session.uid = u.id; req.session.nombre = u.nombre;
  res.json({ nombre: u.nombre });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => req.session.uid ? res.json({ nombre: req.session.nombre }) : res.status(401).json({}));

/* ── extracción ── */
const PROMPT = `Eres un capturista de notas de remisión de un salón de belleza (LUMIN LASHES & NAILS) en Querétaro, México. Analiza la foto de la nota y devuelve SOLO un objeto JSON, sin markdown ni explicación.

Formato exacto:
{"fecha":"YYYY-MM-DD","folio":"numero o SN","cliente":"","metodo_pago":"Efectivo|Tarjeta|Transferencia|Depósito|Mixto|Otro","total":0,"servicios":[{"profesionista":"","descripcion":"","categoria":"","precio":0,"propina":0,"garantia":"N/A"}]}

Reglas:
- fecha: la nota trae DÍA/MES/AÑO, a veces con año de 2 dígitos (ej "17 08 26" = 17 de agosto de 2026). Interpreta años de 2 dígitos como 20XX. NUNCA leas el primer número como mes.
- folio: el número en el recuadro superior derecho (o el # de nota). Si no hay, "SN".
- cliente: el nombre escrito junto a "CLIENTE".
- profesionista: la columna "PROFESIONISTA" es POR RENGLÓN: cada servicio puede tener una profesionista distinta (a una misma clienta la pueden atender varias). Lee el nombre de CADA renglón por separado. Si un renglón tiene la celda vacía porque comparte la misma profesionista del renglón de arriba (es común que solo la escriban una vez), repite ese nombre. OBLIGATORIO: devuelve SIEMPRE uno de estos nombres exactos del catálogo, nunca uno distinto: ${EMPLEADAS.join(', ')}. La letra es manuscrita y puede estar abreviada o mal escrita; elige el del catálogo más parecido. Alias: "Melina"=Mely, "Wualdo"=Waldo. NUNCA inventes un nombre fuera del catálogo.
- metodo_pago: revisa cuál casilla está marcada (Efvo./Efectivo, Tarjeta, Transf./Transferencia, Depósito, o si hay más de una marcada usa "Mixto"). Si ninguna casilla está marcada o el campo está vacío, usa SIEMPRE "Efectivo".
- servicios: cada renglón de la tabla con su descripción y precio. Ignora renglones vacíos o tachados.
- categoria: clasifica cada servicio en una de estas categorías exactas: ${CATS.join(', ')}. Uñas: gel, acrílico, relleno, manicure, pedicure, esmaltado, retiro. Pestañas: lash, extensiones, mirada, aplicación, rizado, anime. Cabello: TODO lo que sea corte (corte de dama, corte caballero, corte niño, "corte" a secas), tinte, peinado, alaciado, mechas. Maquillaje: maquillaje social, novia. Facial: limpieza, hidratación.
  IMPORTANTE para Cejas vs Depilacion:
  * "Depilacion" = CUALQUIER depilación, de cualquier zona del cuerpo, incluidas las cejas. Abreviaciones comunes: "Depi", "Dep.", "Depil". Si el texto solo dice "Depi" sin más contexto, la descripción estándar es "Depilación de Cejas".
  * "Cejas" = SOLO planchado (laminado), henna, o paquete de cejas. Nada de depilación.
  Elige SIEMPRE una categoría de la tabla, la que mejor corresponda. NUNCA uses una categoría que no esté en la tabla.
- propina: solo si el ticket la menciona explícitamente por separado del cobro del servicio. Si no se menciona, usa 0.
- garantia: usa "N/A" salvo que la nota indique explícitamente garantía Sí o No para ese servicio.
- total: el número junto a "TOTAL".
- Todo el texto manuscrito debe interpretarse con cuidado; si una palabra es ambigua, usa tu mejor lectura sin inventar.`;

app.post('/api/extract', auth, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No llegó ninguna imagen.' });
  try {
    const msg = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') } },
        { type: 'text', text: PROMPT }
      ]}]
    });
    const txt = msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s < 0) return res.status(422).json({ error: 'No se reconoció una nota en esta foto.' });
    const n = JSON.parse(txt.slice(s, e + 1));
    const ALIAS = { melina: 'Mely', wualdo: 'Waldo', lupe: 'Lupita', guadalupe: 'Lupita' };
    const resolverProf = v => {
      const p = norm(v);
      if (!p) return '';
      return ALIAS[p] || deTabla(v, EMPLEADAS, '');
    };
    n.servicios = (n.servicios || []).map(x => ({
      profesionista: resolverProf(x.profesionista),
      descripcion: x.descripcion || '',
      categoria: deTabla(x.categoria, CATS, 'Uñas'),
      precio: Number(x.precio) || 0,
      propina: Number(x.propina) || 0,
      garantia: deTabla(x.garantia, GARANTIAS, 'N/A')
    }));
    // Si un renglón trae la celda vacía, hereda la profesionista del anterior
    let ultima = '';
    n.servicios.forEach(s => {
      if (s.profesionista) ultima = s.profesionista; else s.profesionista = ultima;
    });
    n.metodo_pago = deTabla(n.metodo_pago, METODOS, 'Efectivo');
    // Normalizar descripciones abreviadas a nombre estándar
    const SERV_ESTANDAR = [
      [/^dep(i|il)?\.?$/i,                      'Depilación de Cejas'],
      [/^dep(i|il)?\.?\s*(de\s*)?cejas?$/i,     'Depilación de Cejas'],
      [/^dep(i|il)?\.?\s*(de\s*)?bozo$/i,       'Depilación de Bozo'],
      [/^dep(i|il)?\.?\s*(de\s*)?axilas?$/i,    'Depilación de Axilas'],
      [/^dep(i|il)?\.?\s*(de\s*)?piernas?$/i,   'Depilación de Piernas'],
      [/^planchado(\s*de\s*cejas?)?$/i,        'Planchado de Cejas'],
      [/^henna(\s*de\s*cejas?)?$/i,            'Henna de Cejas'],
      [/^paquete\s*(de\s*)?cejas?$/i,          'Paquete de Cejas']
    ];
    n.servicios = n.servicios.map(s => {
      const d = (s.descripcion || '').trim();
      for (const [re, estandar] of SERV_ESTANDAR)
        if (re.test(d)) return { ...s, descripcion: estandar };
      return s;
    });

    // Reglas fijas de categoría (mandan sobre lo que haya clasificado la IA)
    const sinAcentos = s => (s||'').toString().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Palabras que delatan uñas o pestañas: protegen de falsos positivos
    // (ej. "gel color" es uñas, no cabello, aunque diga "color")
    const ES_UNAS_O_PESTANAS = /gel|acr[ií]lic|u[ñn]a|manicure|pedicure|\btips?\b|pesta[ñn]a|lash|nagaraku|rizado|extensi[oó]n|mirada|anime|relleno|esmalt|cut[ií]cula|dise[ñn]o\s*de\s*cejas?/;
    const REGLAS_CAT = [
      // Cabello: cualquier servicio capilar
      [/\bcorte|tinte|\bcolor|decolora|mecha|balaya|baliag|ombre|rayito|matiz|alacia|alisad|keratin|queratin|botox|peinad|secado|cepillad|permanente|cabello|\bpelo\b|tratamiento\s*capilar|shampoo|ampolleta/, 'Cabello'],
      [/\bdepi|\bdepil/,                            'Depilacion'],
      [/planchado|henna|paquete\s*(de\s*)?cejas/,   'Cejas']
    ];
    n.servicios = n.servicios.map(s => {
      const d = sinAcentos(s.descripcion);
      for (const [re, cat] of REGLAS_CAT) {
        // La regla de Cabello no aplica si el texto habla claramente de uñas o pestañas
        if (cat === 'Cabello' && ES_UNAS_O_PESTANAS.test(d)) continue;
        if (re.test(d)) return { ...s, categoria: cat };
      }
      return s;
    });

    // Guardia de fecha: si quedó en el futuro, probable día/mes volteado
    if (n.fecha && /^\d{4}-\d{2}-\d{2}$/.test(n.fecha)) {
      const hoy = new Date().toISOString().slice(0,10);
      if (n.fecha > hoy) {
        const [y,m,d] = n.fecha.split('-');
        const c = `${y}-${d}-${m}`;
        if (Number(d) <= 12 && c <= hoy) n.fecha = c;
      }
    }
    n.duplicado = false;
    if (n.folio && n.folio.toUpperCase() !== 'SN') {
      const { rowCount } = await pool.query('SELECT 1 FROM notas WHERE folio=$1', [n.folio]);
      n.duplicado = rowCount > 0;
    }
    res.json(n);
  } catch (err) {
    console.error('extract:', err);
    res.status(500).json({ error: 'La lectura falló. Intenta de nuevo.' });
  }
});

/* ── guardar ── */
app.post('/api/notas', auth, async (req, res) => {
  const n = req.body;
  if (!n?.fecha || !n.servicios?.length) return res.status(400).json({ error: 'Faltan datos de la nota.' });
  const folio = (n.folio || 'SN').trim() || 'SN';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO notas (fecha,folio,cliente,especialista,metodo_pago,total_nota,creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [n.fecha, folio, n.cliente||'', '', n.metodo_pago, round2(n.total)||0, req.session.uid]);
    const nid = rows[0].id;
    for (const sv of n.servicios)
      await c.query(
        `INSERT INTO servicios (nota_id,profesionista,descripcion,categoria,precio,propina,garantia,notas_obs)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [nid, sv.profesionista||'', sv.descripcion, sv.categoria || 'Uñas', round2(sv.precio), round2(sv.propina)||0, sv.garantia||'N/A', sv.notas_obs||'']);
    await c.query('COMMIT');
    res.json({ ok: true, nota_id: nid });
  } catch (err) {
    await c.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: `El folio ${folio} ya estaba capturado.` });
    console.error('save:', err);
    res.status(500).json({ error: 'No se pudo guardar la nota.' });
  } finally { c.release(); }
});

/* ── consultas ── */
app.get('/api/ingresos', auth, async (req, res) => {
  const { desde, hasta } = req.query;
  const { rows } = await pool.query(
    `SELECT * FROM v_ingresos WHERE ($1::date IS NULL OR fecha>=$1) AND ($2::date IS NULL OR fecha<=$2)`,
    [desde||null, hasta||null]);
  res.json(rows);
});

app.get('/api/resumen', auth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT (SELECT count(*) FROM notas) AS notas,
           (SELECT count(*) FROM servicios) AS servicios,
           (SELECT coalesce(sum(precio),0) FROM servicios) AS total,
           (SELECT coalesce(sum(s.precio),0) FROM servicios s JOIN notas n ON n.id=s.nota_id WHERE n.metodo_pago='Efectivo') AS total_efectivo,
           (SELECT coalesce(sum(s.precio),0) FROM servicios s JOIN notas n ON n.id=s.nota_id WHERE n.metodo_pago='Tarjeta') AS total_tarjeta,
           (SELECT coalesce(sum(s.precio),0) FROM servicios s JOIN notas n ON n.id=s.nota_id WHERE n.metodo_pago='Transferencia') AS total_transferencia`);
  res.json(rows[0]);
});

app.get('/api/dashboard', auth, async (_req, res) => {
  const q = sql => pool.query(sql).then(r => r.rows);
  try {
    const [porEspecialista, porServicio, porDia, topClientes] = await Promise.all([
      q(`SELECT s.profesionista AS etiqueta, count(*) AS servicios, sum(s.precio) AS total
         FROM servicios s JOIN notas n ON n.id=s.nota_id
         WHERE s.profesionista <> '' GROUP BY 1 ORDER BY 3 DESC`),
      q(`SELECT s.descripcion AS etiqueta, count(*) AS veces, sum(s.precio) AS total
         FROM servicios s GROUP BY 1 ORDER BY 3 DESC LIMIT 10`),
      q(`SELECT to_char(n.fecha,'DD/MM') AS etiqueta, sum(s.precio) AS total
         FROM servicios s JOIN notas n ON n.id=s.nota_id
         WHERE n.fecha >= CURRENT_DATE - 30 GROUP BY n.fecha ORDER BY n.fecha`),
      q(`SELECT n.cliente AS etiqueta, count(*) AS visitas, sum(s.precio) AS total
         FROM servicios s JOIN notas n ON n.id=s.nota_id
         WHERE n.cliente <> '' GROUP BY 1 ORDER BY 3 DESC LIMIT 10`)
    ]);
    res.json({ porEspecialista, porServicio, porDia, topClientes });
  } catch (err) { console.error('dashboard:', err); res.status(500).json({ error: 'Error cargando dashboard.' }); }
});

app.get('/api/export.csv', auth, async (req, res) => {
  const { desde, hasta } = req.query;
  const { rows } = await pool.query(
    `SELECT * FROM v_ingresos WHERE ($1::date IS NULL OR fecha>=$1) AND ($2::date IS NULL OR fecha<=$2)`,
    [desde||null, hasta||null]);
  // Mismas columnas y orden que la plantilla LUMIN_Notas del negocio, listo para pegar
  const head = ['Fecha','Año','Mes','Semana','# Nota','Empleada','Servicio','Categoría','Cobro','Propina','Metodo_Pago','Garantía','Notas'];
  const q = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const body = rows.map(r => [r.fecha.toISOString().slice(0,10), r.anio, r.mes, r.semana, r.folio,
    r.profesionista, r.descripcion, r.categoria, r.precio, r.propina, r.metodo_pago, r.garantia, r.notas_obs].map(q).join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="lumin-notas.csv"');
  res.send('\uFEFF'+[head.map(q).join(','), ...body].join('\n'));
});

app.use(express.static('public'));
const port = process.env.PORT || 3001;
app.listen(port, '127.0.0.1', () => console.log('LUMIN notas en :' + port));
