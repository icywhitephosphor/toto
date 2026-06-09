// Drizzle client over postgres.js, initialised LAZILY on first use. Importing
// this module must not require DATABASE_URL or open a connection — `next build`
// imports route modules to collect metadata, with no DB and no env. The pool is
// created on the first query and cached on globalThis so dev HMR reuses it.
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { env } from "@/lib/env";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __totoSql?: ReturnType<typeof postgres>;
  __totoDb?: Db;
};

function init(): Db {
  if (globalForDb.__totoDb) return globalForDb.__totoDb;
  const client = globalForDb.__totoSql ?? postgres(env.databaseUrl, { max: 10 });
  globalForDb.__totoSql = client;
  const instance = drizzle(client, { schema });
  globalForDb.__totoDb = instance;
  return instance;
}

// Proxy so `db.select()/insert()/transaction()` work unchanged at call sites,
// while deferring pool creation until the first property access at runtime.
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    const real = init();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
