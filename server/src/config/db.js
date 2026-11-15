import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  // Prevent multiple instances of Prisma Client in development during HMR/restarts
  if (!global.__prisma) {
    global.__prisma = new PrismaClient({
      log: ['warn', 'error'],
    });
  }
  prisma = global.__prisma;
}

export async function testDbConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ PostgreSQL Database connected successfully via Prisma.');
    return true;
  } catch (error) {
    console.error('❌ Failed to connect to PostgreSQL Database:', error.message);
    return false;
  }
}

export default prisma;

