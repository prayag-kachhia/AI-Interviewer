import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql, closeDb } from "./index";

export async function runMigrations() {
  console.log("Applying migrations from ./drizzle...");
  const drizzleDir = join(import.meta.dir, "../../drizzle");
  const files = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    console.log(`Running migration: ${file}`);
    const filePath = join(drizzleDir, file);
    const content = readFileSync(filePath, "utf-8");
    await sql.unsafe(content);
  }

  console.log("Migrations applied successfully!");
}

if (import.meta.main) {
  runMigrations()
    .then(async () => {
      await closeDb();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration failed:", err);
      await closeDb();
      process.exit(1);
    });
}
