// Roda a verificação de estoque uma vez e encerra: npm run check-stock
import {validateConfig} from '../config.js';
import {migrate, pool} from '../db.js';
import {checkStock} from './check-stock.js';

const logger = {
  info: (obj, msg) => console.log(msg || '', JSON.stringify(obj)),
  error: (obj, msg) => console.error(msg || '', obj?.err?.message || '', JSON.stringify({...obj, err: undefined}))
};

try {
  validateConfig();
  await migrate(logger);
  const result = await checkStock(logger);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
