import type { CamperConfig } from '../config.js';
import { sessionExists, listWindows, windowExists } from '../tmux.js';

export function status(config: CamperConfig): void {
  const { session, agents, services } = config;

  if (!sessionExists(session)) {
    console.log(`Session '${session}': not running`);
    return;
  }

  const windows = listWindows(session);
  console.log(`Session '${session}': running (${windows.length} windows)\n`);

  // Watcher
  const watcherOk = windowExists(session, 'watcher');
  console.log(`  watcher   ${watcherOk ? '✓' : '✗ MISSING'}`);

  // Agents
  for (const agent of agents) {
    const ok = windowExists(session, agent.name);
    const role = agent.role === 'coordinator' ? '(coordinator)' : `(${agent.role})`;
    console.log(`  ${agent.name.padEnd(12)} ${ok ? '✓' : '✗ MISSING'} ${role}`);
  }

  // Services
  for (const service of services ?? []) {
    const ok = windowExists(session, service.name);
    console.log(`  ${service.name.padEnd(12)} ${ok ? '✓' : '✗ MISSING'} (service)`);
  }

  console.log(`  ${'local'.padEnd(12)} ${windowExists(session, 'local') ? '✓' : '✗'} (scratch)`);
}
