-- LUMIN NOTAS · Ingresos por servicio y especialista
-- psql -U lumin_notas -d lumin_notas -f schema.sql

CREATE TABLE IF NOT EXISTS usuarios (
  id         SERIAL PRIMARY KEY,
  usuario    TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  nombre     TEXT NOT NULL,
  rol        TEXT NOT NULL DEFAULT 'admin' CHECK (rol IN ('admin','especialista')),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notas (
  id             SERIAL PRIMARY KEY,
  fecha          DATE NOT NULL,
  folio          TEXT NOT NULL DEFAULT 'SN',
  cliente        TEXT NOT NULL DEFAULT '',
  especialista   TEXT NOT NULL DEFAULT '',
  metodo_pago    TEXT NOT NULL CHECK (metodo_pago IN ('Efectivo','Tarjeta','Transferencia')),
  total_nota     NUMERIC(10,2) NOT NULL DEFAULT 0,
  creado_por     INTEGER REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Folios repetidos no entran (excepto 'SN' para notas sin número)
CREATE UNIQUE INDEX IF NOT EXISTS ux_folio_nota
  ON notas (folio) WHERE folio <> 'SN';

CREATE TABLE IF NOT EXISTS servicios (
  id             SERIAL PRIMARY KEY,
  nota_id        INTEGER NOT NULL REFERENCES notas(id) ON DELETE CASCADE,
  descripcion    TEXT NOT NULL,
  categoria      TEXT NOT NULL DEFAULT 'Uñas',
  precio         NUMERIC(10,2) NOT NULL,
  propina        NUMERIC(10,2) NOT NULL DEFAULT 0,
  garantia       TEXT NOT NULL DEFAULT 'N/A',
  notas_obs      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_servicios_nota ON servicios (nota_id);
CREATE INDEX IF NOT EXISTS ix_notas_fecha    ON notas (fecha);
CREATE INDEX IF NOT EXISTS ix_notas_esp      ON notas (especialista);

CREATE OR REPLACE VIEW v_ingresos AS
SELECT n.fecha, EXTRACT(YEAR FROM n.fecha)::int AS anio, EXTRACT(MONTH FROM n.fecha)::int AS mes,
       EXTRACT(WEEK FROM n.fecha)::int AS semana,
       n.folio, n.especialista, s.descripcion, s.categoria, s.precio, s.propina,
       n.metodo_pago, s.garantia, s.notas_obs, n.cliente, n.total_nota
FROM servicios s JOIN notas n ON n.id = s.nota_id
ORDER BY n.fecha, n.id, s.id;
