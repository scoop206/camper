import type { CamperConfig } from '../config.js';
import { send } from '../tmux.js';

export function clear(config: CamperConfig, agentName?: string): void {
  const targets = agentName
    ? [config.agents.find(a => a.name === agentName)].filter(Boolean)
    : config.agents.filter(a => a.role !== 'coordinator');

  for (const agent of targets) {
    if (!agent) continue;
    send(config.session, agent.name, '/clear');
    console.log(`↺ /clear → ${agent.name}`);
  }
}
