import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";

/**
 * Sincronizacao da sala pelo banco (Neon):
 * - mensagens de texto (guardadas por 7 dias);
 * - presenca (quem esta online, em qual sala de voz, mutado, transmitindo).
 * Serve de garantia: mesmo quando a conexao direta entre os aparelhos (P2P)
 * atrasa ou falha, texto e lista de pessoas continuam certos.
 * Imagens, arquivos, voz e tela continuam indo direto entre os aparelhos.
 */

const ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export type MessageRow = {
  seq: number;
  id: string;
  channelId: string;
  authorId: string;
  name: string;
  color: string;
  text: string;
  ts: number;
};

export type PresenceRow = {
  id: string;
  v: number;
  presence: {
    name: string;
    color: string;
    status: string;
    avatar: string;
    voiceId: string | null;
    muted: boolean;
    deaf: boolean;
    sharing: boolean;
  };
};

const globalRef = globalThis as typeof globalThis & {
  __chatSchemaPromise__?: Promise<void>;
};

function ensureSchema(sql: Sql): Promise<void> {
  globalRef.__chatSchemaPromise__ ??= (async () => {
    await sql.query(
      `CREATE TABLE IF NOT EXISTS chat_messages (
         seq BIGSERIAL PRIMARY KEY,
         id TEXT NOT NULL UNIQUE,
         server_id TEXT NOT NULL,
         channel_id TEXT NOT NULL,
         author_id TEXT NOT NULL,
         name TEXT NOT NULL,
         color TEXT NOT NULL,
         text TEXT NOT NULL,
         ts BIGINT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    await sql.query(
      `CREATE INDEX IF NOT EXISTS chat_messages_server_seq ON chat_messages (server_id, seq)`,
    );
    await sql.query(
      `CREATE TABLE IF NOT EXISTS chat_presence (
         server_id TEXT NOT NULL,
         peer_id TEXT NOT NULL,
         data JSONB NOT NULL,
         v BIGINT NOT NULL DEFAULT 0,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         PRIMARY KEY (server_id, peer_id)
       )`,
    );
  })().catch((err) => {
    globalRef.__chatSchemaPromise__ = undefined;
    throw err;
  });
  return globalRef.__chatSchemaPromise__;
}

export const postMessage = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        serverId: ID,
        id: ID,
        channelId: ID,
        authorId: ID,
        name: z.string().trim().min(1).max(40),
        color: z.string().max(32),
        text: z.string().trim().min(1).max(2000),
        ts: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSchema(sql);
    await sql.query(
      `INSERT INTO chat_messages (id, server_id, channel_id, author_id, name, color, text, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [data.id, data.serverId, data.channelId, data.authorId, data.name, data.color, data.text, data.ts],
    );
    if (Math.random() < 0.02) {
      await sql.query(`DELETE FROM chat_messages WHERE created_at < now() - interval '7 days'`);
    }
    return { ok: true as const };
  });

const presenceSchema = z.object({
  name: z.string().max(24),
  color: z.string().max(32),
  status: z.string().max(60),
  voiceId: z.string().max(40).nullable(),
  muted: z.boolean(),
  deaf: z.boolean(),
  sharing: z.boolean(),
});

/** Uma unica chamada por ciclo: grava minha presenca e devolve mensagens novas + presenca dos outros. */
export const syncRoom = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        serverId: ID,
        peerId: ID,
        since: z.number().int().min(0),
        v: z.number().int().min(0),
        presence: presenceSchema.optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSchema(sql);

    if (data.presence) {
      await sql.query(
        `INSERT INTO chat_presence (server_id, peer_id, data, v, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, now())
         ON CONFLICT (server_id, peer_id)
         DO UPDATE SET data = EXCLUDED.data, v = EXCLUDED.v, updated_at = now()`,
        [data.serverId, data.peerId, JSON.stringify(data.presence), data.v],
      );
    }
    if (Math.random() < 0.02) {
      await sql.query(`DELETE FROM chat_presence WHERE updated_at < now() - interval '1 day'`);
    }

    const cols = `seq, id, channel_id AS "channelId", author_id AS "authorId", name, color, text, ts`;
    const raw =
      data.since > 0
        ? await sql.query<MessageRow>(
            `SELECT ${cols} FROM chat_messages WHERE server_id = $1 AND seq > $2 ORDER BY seq LIMIT 200`,
            [data.serverId, data.since],
          )
        : (
            await sql.query<MessageRow>(
              `SELECT ${cols} FROM chat_messages WHERE server_id = $1 ORDER BY seq DESC LIMIT 100`,
              [data.serverId],
            )
          ).reverse();

    const others = await sql.query<{ id: string; v: number; data: PresenceRow["presence"] }>(
      `SELECT peer_id AS id, v, data FROM chat_presence
       WHERE server_id = $1 AND peer_id <> $2 AND updated_at > now() - interval '20 seconds'`,
      [data.serverId, data.peerId],
    );

    return {
      messages: raw.map((r) => ({ ...r, seq: Number(r.seq), ts: Number(r.ts) })) as MessageRow[],
      presences: others.map((r) => ({
        id: r.id,
        v: Number(r.v),
        presence: { ...r.data, avatar: "" },
      })) as PresenceRow[],
    };
  });
