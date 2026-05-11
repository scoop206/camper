import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

export interface Repo {
  path: string;
  github?: string;
}

export interface Agent {
  name: string;
  role: 'coordinator' | 'developer' | 'qa';
  repo: string | null; // null = coordinator, operates across repos
  branch?: string; // defaults to agent/<name>
  worktree?: string; // defaults to ../<workspace>-<name>
  reviewedBy?: string; // agent name that QAs this agent's output
  reviews?: string; // agent name this agent QAs
  description: string; // injected into CLAUDE.md
}

export interface Service {
  name: string;
  cwd: string;
  command: string;
}

export interface WindowConfig {
  type: 'agent' | 'service' | 'utility';
  name: string;
}

export interface CamperConfig {
  workspace: string; // human-readable name
  session: string; // tmux session name
  coordinator: string; // agent name that acts as Boss
  repos: Record<string, Repo>;
  agents: Agent[];
  services?: Service[];
  watcher?: {
    interval?: number; // seconds, default 5
    issuesFile?: string; // default .beads/issues.jsonl
  };
  claude?: {
    command?: string; // default: claude --model sonnet --permission-mode auto
  };
}

export function loadConfig(cwd: string = process.cwd()): { config: CamperConfig; root: string } {
  const configPath = findConfig(cwd);
  if (!configPath) {
    throw new Error('No camper.json found. Run camper init to create one.');
  }
  const root = dirname(configPath);
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as CamperConfig;
  validateConfig(raw);
  return { config: applyDefaults(raw, root), root };
}

function validateConfig(config: CamperConfig): void {
  const agentNames = new Set(config.agents.map((a) => a.name));
  const repoNames = new Set(Object.keys(config.repos));

  if (!agentNames.has(config.coordinator)) {
    throw new Error(`Invalid config: coordinator '${config.coordinator}' is not in agents`);
  }
  for (const agent of config.agents) {
    if (agent.repo !== null && !repoNames.has(agent.repo)) {
      throw new Error(`Invalid config: agent '${agent.name}' references unknown repo '${agent.repo}'`);
    }
    if (agent.reviewedBy && !agentNames.has(agent.reviewedBy)) {
      throw new Error(`Invalid config: agent '${agent.name}' reviewedBy unknown agent '${agent.reviewedBy}'`);
    }
    if (agent.reviews && !agentNames.has(agent.reviews)) {
      throw new Error(`Invalid config: agent '${agent.name}' reviews unknown agent '${agent.reviews}'`);
    }
  }
}

function findConfig(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = resolve(dir, 'camper.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function applyDefaults(config: CamperConfig, root: string): CamperConfig {
  return {
    ...config,
    watcher: {
      interval: 5,
      issuesFile: '.beads/issues.jsonl',
      ...config.watcher,
    },
    claude: {
      command: 'claude --model sonnet --permission-mode auto',
      ...config.claude,
    },
    agents: config.agents.map((agent) => ({
      ...agent,
      branch: agent.branch ?? (agent.role === 'coordinator' ? 'master' : `agent/${agent.name}`),
      worktree:
        agent.worktree ??
        (agent.role === 'coordinator'
          ? resolve(root, config.repos[Object.keys(config.repos)[0]]?.path ?? '.')
          : resolve(root, `${config.session}-${agent.name}`)),
    })),
  };
}

export function getCoordinator(config: CamperConfig): Agent {
  const coord = config.agents.find((a) => a.name === config.coordinator);
  if (!coord) throw new Error(`Coordinator '${config.coordinator}' not found in agents`);
  return coord;
}

export function getAgent(config: CamperConfig, name: string): Agent {
  const agent = config.agents.find((a) => a.name === name);
  if (!agent) throw new Error(`Agent '${name}' not found`);
  return agent;
}
