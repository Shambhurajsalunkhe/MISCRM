import 'dotenv/config'
// Imported from `prisma/config` rather than `@prisma/config`: the former is a
// documented export of the declared `prisma` devDependency, the latter is a
// transitive package this project never declares.
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
