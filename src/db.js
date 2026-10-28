import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {config} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, '..', 'sql');

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10
});

export const query = (text, params) => pool.query(text, params);

/**
 * Executa os arquivos .sql da pasta /sql em ordem alfabética.
 * Os scripts são idempotentes (CREATE ... IF NOT EXISTS), então rodar a cada start é seguro.
 */
export const migrate = async logger => {
  const files = (await fs.readdir(SQL_DIR)).filter(file => file.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await fs.readFile(path.join(SQL_DIR, file), 'utf8');
    await pool.query(sql);
    logger?.info({file}, 'migração aplicada');
  }
};

/**
 * Executa fn segurando um advisory lock do Postgres.
 * Garante que só uma instância rode o job por vez (útil se o serviço tiver mais de uma réplica).
 * Retorna {skipped: true} se outra execução já estiver em andamento.
 */
export const withAdvisoryLock = async (lockKey, fn) => {
  const client = await pool.connect();

  try {
    const {rows} = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);

    if (!rows[0].locked) {
      return {skipped: true};
    }

    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
    }
  } finally {
    client.release();
  }
};
