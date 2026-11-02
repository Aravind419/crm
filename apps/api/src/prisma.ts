import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

// Configure sensible default timeouts for interactive transactions over cloud/pooled databases
const defaultTxOptions = {
  maxWait: 10000,
  timeout: 25000,
};

const originalTransaction = prisma.$transaction.bind(prisma);
prisma.$transaction = ((arg: any, options?: any) => {
  if (typeof arg === 'function') {
    return originalTransaction(arg, { ...defaultTxOptions, ...options });
  }
  return originalTransaction(arg, options);
}) as any;

export default prisma;
