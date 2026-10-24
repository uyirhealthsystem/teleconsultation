import "dotenv/config";

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  // Migrations need a direct (non-pooled) connection when DATABASE_URL points at a pooler like Neon's.
  datasource: {
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});