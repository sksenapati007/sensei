// The "victim" app for Sensei: a tiny shop API.
// Healthy = GET /health returns ok (which needs the inventory service) AND POST /order can write to disk.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const env = Object.fromEntries(
  fs.readFileSync(path.join(dir, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const port = Number(env.PORT);
if (!Number.isInteger(port)) {
  console.error(`FATAL: invalid PORT in .env: "${env.PORT}"`);
  process.exit(1);
}
const INVENTORY = env.INVENTORY_URL || "http://inventory.local:4000/stock";
const PUBLIC_LOG = path.join(dir, "public", "app.log");

// Debug mode dumps the whole config into a log that is served publicly. (That's the bug.)
if (env.DEBUG === "1") {
  fs.mkdirSync(path.dirname(PUBLIC_LOG), { recursive: true });
  fs.appendFileSync(PUBLIC_LOG, `${new Date().toISOString()} [debug] starting with config ${JSON.stringify(env)}\n`);
}

http.createServer(async (req, res) => {
  if (req.url === "/health") {
    try {
      const r = await fetch(INVENTORY, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) throw new Error(`inventory returned ${r.status}`);
      return res.end("ok");
    } catch (e) {
      console.error(`health: inventory unreachable at ${INVENTORY}: ${e.cause?.code ?? e.message}`);
      res.statusCode = 503;
      return res.end("inventory unreachable");
    }
  }
  if (req.url === "/order" && req.method === "POST") {
    try {
      fs.appendFileSync(path.join(dir, "data", "orders.log"), `${new Date().toISOString()} order\n`);
      return res.end("saved");
    } catch (e) {
      res.statusCode = 500;
      console.error(`order write failed: ${e.message}`);
      return res.end("error");
    }
  }
  if (req.url === "/public/app.log") {
    try { return res.end(fs.readFileSync(PUBLIC_LOG)); } catch { return res.end(""); }
  }
  res.statusCode = 404;
  res.end();
}).listen(port, () => console.log(`shop listening on ${port}`))
  .on("error", (e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
