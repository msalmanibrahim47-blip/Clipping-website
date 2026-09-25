import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  // Only used by `drizzle-kit` commands; set DATABASE_URL in your shell or .env.
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
