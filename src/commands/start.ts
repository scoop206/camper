import { resolve } from 'path';
import type { CamperConfig } from '../config.js';
import { getCoordinator } from '../config.js';
import * as tmux from '../tmux.js';

export function start(config: CamperConfig, root: string): void {
  const { session } = config;

  if (tmux.sessionExists(session)) {
    console.log(`Session '${session}' already exists — attaching.`);
    tmux.attach(session);
  }

  const coordinator = getCoordinator(config);
  const coordCwd = coordinator.worktree ?? resolve(root, '.');

  // Watcher window — first so it's always index 0
  tmux.newSession(session, 'watcher', coordCwd);
  tmux.send(session, 'watcher', `node ${process.argv[1]} watch`);

  // Coordinator window
  tmux.newWindow(session, coordinator.name, coordCwd);
  tmux.send(session, coordinator.name, config.claude!.command!);

  // Agent windows
  for (const agent of config.agents) {
    if (agent.role === 'coordinator') continue;
    const cwd = agent.worktree ?? resolve(root, `${session}-${agent.name}`);
    tmux.newWindow(session, agent.name, cwd);
    tmux.send(session, agent.name, config.claude!.command!);
  }

  // Service windows
  for (const service of config.services ?? []) {
    const cwd = resolve(root, service.cwd);
    tmux.newWindow(session, service.name, cwd);
    tmux.send(session, service.name, service.command);
  }

  // Local scratch
  tmux.newWindow(session, 'local', coordCwd);

  tmux.selectWindow(session, coordinator.name);
  tmux.attach(session);
}
