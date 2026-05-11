import type { CamperConfig } from '../config.js';
import { send as tmuxSend } from '../tmux.js';

export function sendMessage(config: CamperConfig, agentName: string, message: string): void {
  const agent = config.agents.find(a => a.name === agentName);
  if (!agent) throw new Error(`Unknown agent: ${agentName}`);
  tmuxSend(config.session, agentName, message);
  console.log(`→ ${agentName}: ${message}`);
}
