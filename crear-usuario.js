// node crear-usuario.js elena "Elena" "suPassword"
import pg from 'pg';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
const [usuario, nombre, password] = process.argv.slice(2);
if (!usuario || !nombre || !password) {
  console.log('Uso: node crear-usuario.js <usuario> "<nombre>" "<password>"');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(
  `INSERT INTO usuarios (usuario, nombre, pass_hash) VALUES ($1,$2,$3)
   ON CONFLICT (usuario) DO UPDATE SET pass_hash=EXCLUDED.pass_hash, nombre=EXCLUDED.nombre`,
  [usuario, nombre, bcrypt.hashSync(password, 10)]
);
console.log(`Listo: ${usuario} (${nombre})`);
await pool.end();
