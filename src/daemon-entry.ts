process.on('unhandledRejection', (reason) => {
  console.error('[daemon] Unhandled rejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[daemon] Uncaught exception:', err);
  process.exit(1);
});

import { daemonCommand } from './cli/commands/daemon.js';
await daemonCommand(process.argv[2]);
