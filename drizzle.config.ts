import { defineConfig } from "drizzle-kit";

// DATABASE_URL is now optional - connections are stored in JSON file
// This config is kept for backwards compatibility with drizzle-kit commands
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://localhost/eventhorizen";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
