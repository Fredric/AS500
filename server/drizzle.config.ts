import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/core/db/schema.ts',
    './src/app/db/schema.ts',
  ],
  out: './src/core/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://as500:as500@localhost:5433/as500',
  },
});
