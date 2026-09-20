-- AlterTable
-- Aditiva: duas colunas nulas, sem default e sem reescrita de linhas.
-- Linhas existentes ficam com NULL (a UI deriva cor/icone do nome).
ALTER TABLE "Category" ADD COLUMN "color" TEXT,
ADD COLUMN "icon" TEXT;
