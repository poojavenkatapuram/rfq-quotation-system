import { PrismaClient } from "@prisma/client";
import { requireSyntheticDatabaseTarget } from "../src/services/synthetic-demo-safety.service.js";
import { seedSyntheticManufacturing } from "../src/services/synthetic-demo-seed.service.js";

async function main() {
  const target = requireSyntheticDatabaseTarget(process.env.SYNTHETIC_DEMO_DATABASE_URL, process.env.SYNTHETIC_DEMO_DB_APPROVED);
  if (!process.env.SYNTHETIC_DEMO_ACTOR_ID) throw new Error("SYNTHETIC_DEMO_ACTOR_ID must identify an existing Admin or Estimator in the isolated database");
  console.log({ host: target.host, port: target.port, database: target.database, schema: target.schema });
  const prisma = new PrismaClient({ datasources: { db: { url: target.url } } });
  try { console.log(await seedSyntheticManufacturing(prisma, process.env.SYNTHETIC_DEMO_ACTOR_ID)); }
  finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Synthetic seed failed"); process.exitCode = 1; });
