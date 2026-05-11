import { existsSync } from 'fs';
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

  const watcherWindow = config.watcher!.tmuxWindow!;

  // Watcher window — first so it's always index 0
  tmux.newSession(session, watcherWindow, coordCwd);
  tmux.send(session, watcherWindow, `node ${process.argv[1]} watch`);

  // Coordinator window
  tmux.newWindow(session, coordinator.tmuxWindow!, coordCwd);
  tmux.send(session, coordinator.tmuxWindow!, config.claude!.command!);

  // Agent windows
  for (const agent of config.agents) {
    if (agent.role === 'coordinator') continue;
    const resolved = agent.worktree!;
    const cwd = existsSync(resolved) ? resolved : root;
    tmux.newWindow(session, agent.tmuxWindow!, cwd);
    tmux.send(session, agent.tmuxWindow!, config.claude!.command!);
  }

  // Service windows
  for (const service of config.services ?? []) {
    const cwd = resolve(root, service.cwd);
    tmux.newWindow(session, service.name, cwd);
    tmux.send(session, service.name, service.command);
  }

  // Local scratch
  tmux.newWindow(session, 'local', coordCwd);

  tmux.selectWindow(session, coordinator.tmuxWindow!);
  tmux.attach(session);
}
