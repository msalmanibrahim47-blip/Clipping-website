import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, "../migrations");
  console.log(`Running migrations from ${migrationsFolder}`);
  await migrate(getDb(), { migrationsFolder });
  console.log("Migrations complete");
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
