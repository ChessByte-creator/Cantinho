import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";

export type ServerRow = {
  id: string;
  name: string;
  initials: string;
  color: string;
  position: number;
};

export type ChannelRow = {
  id: string;
  serverId: string;
  name: string;
  kind: "text" | "voice";
  topic: string;
  position: number;
};

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

function slug(name: string) {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return s || "canal";
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return (name.trim()[0] ?? "?").toUpperCase();
}

function nid() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export const listDirectory = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const servers = await sql<{
    id: string;
    name: string;
    initials: string;
    color: string;
    position: number;
  }>`select id, name, initials, color, position from servers order by position, name`;
  const channels = await sql<{
    id: string;
    serverId: string;
    name: string;
    kind: "text" | "voice";
    topic: string;
    position: number;
  }>`select id, server_id as "serverId", name, kind, topic, position
     from channels order by position, name`;
  return {
    servers: servers.map((s) => ({ ...s, position: Number(s.position) })),
    channels: channels.map((c) => ({ ...c, position: Number(c.position) })),
  };
});

export const createServer = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ name: z.string().trim().min(2).max(32), color: hex }).parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const count = await sql<{ n: number }>`select count(*)::int as n from servers`;
    if (Number(count[0]?.n ?? 0) >= 24) throw new Error("Limite de sistemas atingido.");
    const pos = await sql<{ n: number }>`select (coalesce(max(position), 0) + 1)::int as n from servers`;
    const id = nid();
    await sql`insert into servers (id, name, initials, color, position)
      values (${id}, ${data.name}, ${initials(data.name)}, ${data.color}, ${Number(pos[0]?.n ?? 1)})`;
    return { id };
  });

export const createChannel = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        serverId: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
        name: z.string().trim().min(1).max(32),
        kind: z.enum(["text", "voice"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const owns = await sql<{ id: string }>`select id from servers where id = ${data.serverId}`;
    if (!owns.length) throw new Error("Sistema não encontrado.");
    const count = await sql<{ n: number }>`select count(*)::int as n from channels where server_id = ${data.serverId}`;
    if (Number(count[0]?.n ?? 0) >= 40) throw new Error("Limite de canais neste servidor.");
    const pos = await sql<{
      n: number;
    }>`select (coalesce(max(position), 0) + 1)::int as n from channels where server_id = ${data.serverId}`;
    const name = data.kind === "text" ? slug(data.name) : data.name.trim().slice(0, 24);
    const id = nid();
    await sql`insert into channels (id, server_id, name, kind, topic, position)
      values (${id}, ${data.serverId}, ${name}, ${data.kind}, ${""}, ${Number(pos[0]?.n ?? 1)})`;
    return { id, name };
  });
