import './env.js';
import pg from 'pg';
export const pool = new pg.Pool({
  host: process.env.DL_DB_HOST, port: Number(process.env.DL_DB_PORT || 5432),
  database: process.env.DL_DB_NAME, user: process.env.DL_DB_USER,
  password: process.env.DL_DB_PASSWORD,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : false,
  max: 10, connectionTimeoutMillis: 10000,
  options: '-c search_path=gmvfinanceira,public'
});
export async function transaction(fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
