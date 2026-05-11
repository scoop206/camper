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
  const watcherWindow = config.watcher!.tmuxWindow!;
  const watcherOk = windowExists(session, watcherWindow);
  console.log(`  ${watcherWindow.padEnd(12)} ${watcherOk ? '✓' : '✗ MISSING'} (watcher)`);

  // Agents
  for (const agent of agents) {
    const win = agent.tmuxWindow!;
    const ok = windowExists(session, win);
    const role = agent.role === 'coordinator' ? '(coordinator)' : `(${agent.role})`;
    console.log(`  ${win.padEnd(12)} ${ok ? '✓' : '✗ MISSING'} ${role}`);
  }

  // Services
  for (const service of services ?? []) {
    const ok = windowExists(session, service.name);
    console.log(`  ${service.name.padEnd(12)} ${ok ? '✓' : '✗ MISSING'} (service)`);
  }

  console.log(`  ${'local'.padEnd(12)} ${windowExists(session, 'local') ? '✓' : '✗'} (scratch)`);
}
