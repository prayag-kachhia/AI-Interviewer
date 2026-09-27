import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not defined");
}

// Disable prefetch for compatibility with transaction pooling (e.g., Supabase transaction mode)
export const sql = postgres(connectionString, {
  prepare: false,
  max: 10,
});

export const db = drizzle(sql, { schema });

export async function closeDb() {
  await sql.end();
}
