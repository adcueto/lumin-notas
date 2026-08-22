-- Ejecutar UNA vez si ya habías creado la base con el schema anterior:
--   psql -U lumin_notas -d lumin_notas -h localhost -f migracion-columnas.sql
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS categoria  TEXT NOT NULL DEFAULT 'Uñas';
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS propina    NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS garantia   TEXT NOT NULL DEFAULT 'N/A';
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS notas_obs  TEXT DEFAULT '';

CREATE OR REPLACE VIEW v_ingresos AS
SELECT n.fecha, EXTRACT(YEAR FROM n.fecha)::int AS anio, EXTRACT(MONTH FROM n.fecha)::int AS mes,
       EXTRACT(WEEK FROM n.fecha)::int AS semana,
       n.folio, n.especialista, s.descripcion, s.categoria, s.precio, s.propina,
       n.metodo_pago, s.garantia, s.notas_obs, n.cliente, n.total_nota
FROM servicios s JOIN notas n ON n.id = s.nota_id
ORDER BY n.fecha, n.id, s.id;
