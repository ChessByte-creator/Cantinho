import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";

/**
 * Chat de texto guardado no banco (Neon). Serve de garantia: mesmo quando a
 * conexao direta entre os aparelhos (P2P) nao abre, as mensagens chegam.
 * Imagens, arquivos, voz e tela continuam indo direto entre os aparelhos.
 * Mensagens com mais de 7 dias sao apagadas automaticamente.
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

export const listMessages = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ serverId: ID, since: z.number().int().min(0) }).parse(input),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSchema(sql);
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
    return {
      rows: raw.map((r) => ({ ...r, seq: Number(r.seq), ts: Number(r.ts) })) as MessageRow[],
    };
  });
