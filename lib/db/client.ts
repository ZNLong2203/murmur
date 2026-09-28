import "server-only";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

// One tiny interface over two drivers: Neon's HTTP driver in production
// (DATABASE_URL set) and PGlite, an in-process Postgres, for local dev and
// tests. Plain parameterised SQL keeps both honest and dependency-light.

export interface Query {
  text: string;
  params?: unknown[];
}

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run statements atomically. */
  batch(queries: Query[]): Promise<void>;
}

const SCHEMA = readFileSync(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");

async function neonDb(url: string): Promise<Db> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    query: async <T,>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
    batch: async (queries) => {
      await sql.transaction(queries.map((q) => sql.query(q.text, q.params ?? [])));
    },
  };
}

async function pgliteDb(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = await PGlite.create(dataDir);
  return {
    query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    batch: async (queries) => {
      await pg.transaction(async (tx) => {
        for (const q of queries) await tx.query(q.text, q.params ?? []);
      });
    },
  };
}

async function migrate(db: Db) {
  for (const statement of SCHEMA.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) {
    await db.query(statement);
  }
}

const globalForDb = globalThis as unknown as { murmurDb?: Promise<Db> };

/** The shared database, migrated on first use. `memory` gives a throwaway one (tests). */
export function getDb(options: { memory?: boolean } = {}): Promise<Db> {
  if (options.memory) return pgliteDb(undefined).then(async (db) => (await migrate(db), db));
  globalForDb.murmurDb ??= (async () => {
    const url = process.env.DATABASE_URL;
    const db = url ? await neonDb(url) : await pgliteDb(path.join(process.cwd(), ".data", "pglite"));
    await migrate(db);
    return db;
  })().catch((err) => {
    globalForDb.murmurDb = undefined;
    throw err;
  });
  return globalForDb.murmurDb;
}
