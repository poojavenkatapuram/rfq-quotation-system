import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const adminName = process.env.BOOTSTRAP_ADMIN_NAME;
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!adminName || !adminEmail || !adminPassword) {
    throw new Error("Bootstrap admin environment variables are missing.");
  }

  if (adminPassword.length < 12) {
    throw new Error("Bootstrap admin password must contain at least 12 characters.");
  }

  const adminHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      name: adminName,
      email: adminEmail,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  console.log("Bootstrap administrator account is ready.");

  const salesHeadName = process.env.SALES_HEAD_NAME?.trim();
  const salesHeadEmail = process.env.SALES_HEAD_EMAIL?.toLowerCase().trim();
  const salesHeadPassword = process.env.SALES_HEAD_PASSWORD;

  if (salesHeadName && salesHeadEmail && salesHeadPassword) {
    if (salesHeadPassword.length < 12) {
      throw new Error("Sales Head password must contain at least 12 characters.");
    }

    const salesHeadHash = await bcrypt.hash(salesHeadPassword, 12);

    await prisma.user.upsert({
      where: { email: salesHeadEmail },
      update: {},
      create: {
        name: salesHeadName,
        email: salesHeadEmail,
        passwordHash: salesHeadHash,
        role: UserRole.SALES_HEAD,
        isActive: true,
      },
    });

    console.log("Sales Head account is ready.");
  } else {
    console.log("Sales Head credentials not supplied; skipping Sales Head setup.");
  }
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
