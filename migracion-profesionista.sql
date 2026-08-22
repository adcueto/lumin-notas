-- Mueve la profesionista de la nota a cada servicio (una clienta puede recibir
-- servicios de varias profesionistas en la misma nota).
-- Ejecutar UNA vez:
--   psql -U lumin_notas -d lumin_notas -h localhost -f migracion-profesionista.sql

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS profesionista TEXT NOT NULL DEFAULT '';

-- Los servicios ya capturados heredan la profesionista que tenía su nota
UPDATE servicios s
   SET profesionista = n.especialista
  FROM notas n
 WHERE n.id = s.nota_id
   AND s.profesionista = ''
   AND coalesce(n.especialista,'') <> '';

CREATE INDEX IF NOT EXISTS ix_serv_prof ON servicios (profesionista);

CREATE OR REPLACE VIEW v_ingresos AS
SELECT n.fecha, EXTRACT(YEAR FROM n.fecha)::int AS anio, EXTRACT(MONTH FROM n.fecha)::int AS mes,
       EXTRACT(WEEK FROM n.fecha)::int AS semana,
       n.folio, s.profesionista, s.descripcion, s.categoria, s.precio, s.propina,
       n.metodo_pago, s.garantia, s.notas_obs, n.cliente, n.total_nota
FROM servicios s JOIN notas n ON n.id = s.nota_id
ORDER BY n.fecha, n.id, s.id;

-- La columna notas.especialista se deja como estaba por si quieres consultarla;
-- ya no la usa la aplicación.
