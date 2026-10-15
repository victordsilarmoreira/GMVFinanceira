import { readFile } from 'node:fs/promises';
import { pool, transaction } from './db.js';
try {
  await transaction(async c => {
    await c.query("SELECT pg_advisory_xact_lock(68410329)");
    await c.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  });
  console.log('Estrutura GMVFinanceira criada/verificada.');
} catch (e) { console.error('Falha na migração:', e.code || e.message); process.exitCode = 1; }
finally { await pool.end(); }
