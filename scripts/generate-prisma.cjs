const { spawnSync } = require('node:child_process');

const env = { ...process.env };

// Force a local engine-based Prisma client even if the shell/machine has
// leftover Accelerate/no-engine variables from another project.
delete env.PRISMA_GENERATE_NO_ENGINE;
delete env.PRISMA_CLIENT_ENGINE_TYPE;
delete env.PRISMA_CLI_QUERY_ENGINE_TYPE;

const prismaCli = require.resolve('prisma/build/index.js');

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  stdio: 'inherit',
  env,
  shell: false,
});

if (result.error) {
  console.error('[prisma] Failed to run prisma generate:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
