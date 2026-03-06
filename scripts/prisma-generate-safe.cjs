#!/usr/bin/env node

const { spawn } = require('node:child_process');

const maxAttempts = Number(process.env.PRISMA_GENERATE_MAX_ATTEMPTS || 5);
const retryDelayMs = Number(process.env.PRISMA_GENERATE_RETRY_DELAY_MS || 1500);
const command = 'pnpm exec prisma generate';

function isLockError(text) {
  return (
    (/EPERM: operation not permitted, rename/i.test(text) &&
      /query_engine.*\.dll\.node/i.test(text)) ||
    /EBUSY: resource busy or locked/i.test(text)
  );
}

function runPrismaGenerate() {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => {
      resolve({
        code: 1,
        output: `${stdout}\n${stderr}\n${String(error)}`,
      });
    });

    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        output: `${stdout}\n${stderr}`,
      });
    });
  });
}

async function main() {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runPrismaGenerate();

    if (result.code === 0) {
      return;
    }

    const canRetry = isLockError(result.output) && attempt < maxAttempts;
    if (!canRetry) {
      process.exit(result.code || 1);
    }

    console.warn(
      `[postinstall] Prisma engine appears to be locked (attempt ${attempt}/${maxAttempts}). Retrying in ${retryDelayMs}ms...`
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
