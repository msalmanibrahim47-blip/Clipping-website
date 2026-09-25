import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };

const globalForDb = globalThis as unknown as { __longcutDb?: Database; __longcutPool?: pg.Pool };

function sslFor(url: string): pg.PoolConfig["ssl"] {
  if (process.env.DATABASE_SSL === "false") return undefined;
  if (process.env.DATABASE_SSL === "true" || /sslmode=require/.test(url)) return { rejectUnauthorized: false };
  return undefined;
}

/**
 * Shared connection pool. On serverless (Netlify) keep DATABASE_POOL_MAX small and point
 * DATABASE_URL at a pooled endpoint (Supabase pooler / Neon pooled URL).
 */
export function getPool(): pg.Pool {
  if (!globalForDb.__longcutPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.__longcutPool = new pg.Pool({
      connectionString: url.replace(/[?&]sslmode=require/, ""),
      ssl: sslFor(url),
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb.__longcutPool;
}

export function getDb(): Database {
  if (!globalForDb.__longcutDb) {
    globalForDb.__longcutDb = drizzle(getPool(), { schema }) as Database;
  }
  return globalForDb.__longcutDb;
}
