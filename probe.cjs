const { Client } = require("pg");

const url = process.env.PROBE_URL;
const family = process.env.PROBE_FAMILY ? Number(process.env.PROBE_FAMILY) : undefined;
const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  ...(family ? { family } : {}),
  connectionTimeoutMillis: 20000,
});

client
  .connect()
  .then(() => {
    console.log("CONNECTED OK");
    return client.query("select count(*) as n from information_schema.tables where table_schema='public'");
  })
  .then((r) => {
    console.log("public tables:", r.rows[0].n);
    return client.query("select table_name from information_schema.tables where table_schema='public' order by table_name");
  })
  .then((r) => {
    console.log(r.rows.map((x) => x.table_name).join(", "));
    return client.end();
  })
  .catch((e) => {
    console.error("ERR:", e.message);
    process.exit(1);
  });
