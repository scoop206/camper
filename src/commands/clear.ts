import type { CamperConfig } from '../config.js';
import { getAgent } from '../config.js';
import { send } from '../tmux.js';

export function clear(config: CamperConfig, agentName?: string): void {
  const targets = agentName
    ? [getAgent(config, agentName)]
    : config.agents.filter((a) => a.role !== 'coordinator');

  for (const agent of targets) {
    send(config.session, agent.tmuxWindow!, '/clear');
    console.log(`↺ /clear → ${agent.tmuxWindow!}`);
  }
}
