const { Pool } = require('pg');
const p = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db' });

(async () => {
  const ints = await p.query('SELECT id, restaurant_id, status, endpoint_url FROM restaurant_integrations');
  console.log('INTEGRATIONS:');
  console.table(ints.rows);

  const evs = await p.query(`SELECT id, integration_id, event_type, status, last_error, last_http_status, direction FROM webhook_events WHERE direction = 'outbound' ORDER BY id DESC LIMIT 8`);
  console.log('OUTBOUND:');
  console.table(evs.rows);

  await p.end();
})();
