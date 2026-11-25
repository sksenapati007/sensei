// Drive a ttyd terminal over its public Sprite URL exactly like a browser would.
// Usage: node tools/termtest.mjs https://<sprite-url>/t/<secret>/ ['command']
const base = process.argv[2];
const cmd = process.argv[3] ?? "echo SENSEI-$((6*7)); whoami";
const ws = new WebSocket(base.replace("https://", "wss://") + "ws", ["tty"]);
ws.binaryType = "arraybuffer";
let out = "";
ws.onopen = () => {
  ws.send(JSON.stringify({ AuthToken: "", columns: 100, rows: 30 }));
  setTimeout(() => ws.send("0" + cmd + "\r"), 1500);
  setTimeout(() => ws.close(), 6000);
};
ws.onmessage = (e) => {
  const buf = new Uint8Array(e.data);
  if (buf[0] === 48) out += new TextDecoder().decode(buf.slice(1)); // '0' = terminal output
};
ws.onclose = () => console.log(out.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, "").slice(-800));
ws.onerror = (e) => console.log("ws error", e.message ?? e);
