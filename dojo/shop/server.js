// The "victim" app for Break/Fix Dojo: a tiny shop API.
// Healthy = GET /health returns ok AND POST /order can write to disk.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const env = Object.fromEntries(
  fs.readFileSync(path.join(dir, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => l.split("=").map((s) => s.trim())),
);
const port = Number(env.PORT);
if (!Number.isInteger(port)) {
  console.error(`FATAL: invalid PORT in .env: "${env.PORT}"`);
  process.exit(1);
}

http.createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
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
  res.statusCode = 404;
  res.end();
}).listen(port, () => console.log(`shop listening on ${port}`))
  .on("error", (e) => { console.error(`FATAL: ${e.message}`); process.exit(1); });
