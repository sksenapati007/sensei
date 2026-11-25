// Inventory service the shop depends on. Listens on 127.0.0.1:4000; the shop finds it by name (inventory.local).
require("node:http").createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ stock: 42 }));
}).listen(4000, "127.0.0.1", () => console.log("inventory listening on 127.0.0.1:4000"));
