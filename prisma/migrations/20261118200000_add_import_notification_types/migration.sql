-- Aditiva: dois valores novos no enum de notificações. Não altera dados existentes.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'IMPORT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'IMPORT_FAILED';
