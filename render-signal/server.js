// Servidor de sinalização do Cantinho para o Render.
// Não carrega voz, tela nem arquivos: só apresenta quem está na sala
// e repassa as ofertas WebRTC. Chat e mídia seguem direto entre os celulares.

import http from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 3000);
const MAX_USERS = Number(process.env.MAX_USERS || 8);
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, name: string }>>} */
const rooms = new Map();

function roster(room) {
  const members = rooms.get(room);
  if (!members) return [];
  return [...members.entries()].map(([id, c]) => ({ id, name: c.name }));
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastRoster(room) {
  const members = rooms.get(room);
  if (!members) return;
  const peers = roster(room);
  for (const c of members.values()) send(c.ws, { t: "roster", peers });
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/healthz" || path === "/") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, service: "cantinho-signal" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "/ws", "http://localhost");
  const room = url.searchParams.get("room") || "";
  const peer = url.searchParams.get("peer") || "";
  const name = (url.searchParams.get("name") || "").slice(0, 64);
  if (!ID.test(room) || !ID.test(peer)) {
    ws.close(1008, "id");
    return;
  }
  if (!rooms.has(room)) rooms.set(room, new Map());
  const members = rooms.get(room);
  if (members.size >= MAX_USERS && !members.has(peer)) {
    send(ws, { t: "denied", reason: "Sala cheia." });
    ws.close();
    return;
  }
  members.set(peer, { ws, name });
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  broadcastRoster(room);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const me = members.get(peer);
    if (!me || me.ws !== ws) return;
    if (msg.t === "signal") {
      if (typeof msg.to !== "string" || !ID.test(msg.to)) return;
      if (!["offer", "answer", "ice"].includes(msg.kind)) return;
      const payload = JSON.stringify(msg.payload ?? null);
      if (payload.length > 32_000) return;
      const target = members.get(msg.to);
      if (!target) return;
      send(target.ws, { t: "signal", id: Date.now(), from: peer, kind: msg.kind, payload: msg.payload });
    } else if (msg.t === "name" && typeof msg.name === "string") {
      me.name = msg.name.slice(0, 64);
      broadcastRoster(room);
    }
  });

  ws.on("close", () => {
    if (members.get(peer)?.ws === ws) members.delete(peer);
    if (members.size === 0) rooms.delete(room);
    else broadcastRoster(room);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`cantinho-signal listening on ${PORT}`);
});
