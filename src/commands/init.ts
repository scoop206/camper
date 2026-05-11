import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import type { CamperConfig, Agent, Repo } from '../config.js';

const CLAUDE_SETTINGS = {
  permissions: {
    allow: ['Bash(*)', 'Edit(*)', 'Write(*)', 'Read(*)'],
    deny: [],
  },
};

// Accept git@github.com:org/repo.git, https://github.com/org/repo.git, or org/repo
function normalizeGithub(input: string): string {
  const ssh = input.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  const https = input.match(/^https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (https) return https[1];
  return input.replace(/\.git$/, '');
}

function cloneUrl(slug: string): string {
  return `git@github.com:${slug}.git`;
}

// ── table rendering ──────────────────────────────────────────────────────────

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const hr = '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
  const fmt = (cells: string[]): string =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';

  console.log(hr);
  console.log(fmt(headers));
  console.log(hr);
  for (const row of rows) console.log(fmt(row.map((c) => c ?? '')));
  console.log(hr);
}

// ── repo editor ──────────────────────────────────────────────────────────────

async function editRepos(
  ask: (q: string) => Promise<string>,
  initial: Record<string, Repo>,
): Promise<Record<string, Repo>> {
  const repos = { ...initial };

  while (true) {
    console.log('\nRepositories:');
    const repoList = Object.entries(repos);
    if (repoList.length === 0) {
      console.log('  (none)');
    } else {
      printTable(
        ['Name', 'Path', 'GitHub'],
        repoList.map(([name, r]) => [name, r.path, r.github ?? '']),
      );
    }
    console.log('  [a]dd  [r]remove  [enter] done');

    const cmd = (await ask('  > ')).trim().toLowerCase();
    if (!cmd) {
      if (Object.keys(repos).length === 0) {
        console.log('  At least one repo is required.');
        continue;
      }
      break;
    }

    if (cmd === 'a') {
      const name = (await ask('  repo name: ')).trim();
      if (!name) continue;
      const path = (await ask(`  path [./${name}]: `)).trim() || `./${name}`;
      const githubRaw = (await ask('  github remote (optional): ')).trim();
      const github = githubRaw ? normalizeGithub(githubRaw) : undefined;
      repos[name] = { path, ...(github ? { github } : {}) };
    } else if (cmd === 'r') {
      const name = (await ask('  repo name to remove: ')).trim();
      if (repos[name]) {
        delete repos[name];
      } else {
        console.log(`  Unknown repo '${name}'`);
      }
    }
  }

  return repos;
}

// ── agent editor ─────────────────────────────────────────────────────────────

function pairLabel(agent: Agent, agents: Agent[]): string {
  if (agent.reviews) return `← ${agent.reviews}`;
  const reviewer = agents.find((a) => a.reviews === agent.name);
  return reviewer ? `→ ${reviewer.name}` : '-';
}

async function editAgents(
  ask: (q: string) => Promise<string>,
  initial: Agent[],
  repos: Record<string, Repo>,
): Promise<Agent[]> {
  const agents = [...initial];

  while (true) {
    console.log('\nAgents:');
    printTable(
      ['Name', 'Role', 'Repo', 'Pair', 'Description'],
      agents.map((a) => [
        a.name,
        a.role,
        a.repo ?? '-',
        pairLabel(a, agents),
        a.description.slice(0, 40) + (a.description.length > 40 ? '…' : ''),
      ]),
    );
    console.log('  [a] add agent');
    console.log('  [p] add an adversarial pair of agents');
    console.log('  [r] remove');
    console.log('  [enter] done');

    const cmd = (await ask('  > ')).trim().toLowerCase();
    if (!cmd) break;

    if (cmd === 'a') {
      const name = (await ask('  agent name: ')).trim();
      if (!name) continue;
      if (agents.find((a) => a.name === name)) {
        console.log(`  Agent '${name}' already exists`);
        continue;
      }

      const repoNames = Object.keys(repos);
      const repoInput = (await ask(`  repo [${repoNames.join('/')}]: `)).trim();
      const repo = repos[repoInput] ? repoInput : repoNames[0];

      const roleInput = (await ask(`  role [developer/qa]: `)).trim();
      const role = roleInput === 'qa' ? 'qa' : 'developer';

      const description = (await ask(`  description: `)).trim();
      agents.push({ name, role, repo, description });
    } else if (cmd === 'p') {
      const repoNames = Object.keys(repos);
      const repoInput = (await ask(`\nRepo for the Agent Pair [${repoNames.join('/')}]: `)).trim();
      const repo = repos[repoInput] ? repoInput : repoNames[0];

      console.log(
        '  Note: First Agent will be assumed to be author/creator. Second will be assumed to be recipient/checker.',
      );

      const firstName = (await ask('\n  First Agent name: ')).trim();
      if (!firstName) continue;
      const firstRole = (await ask(`  First Agent role [developer]: `)).trim() || 'developer';
      const firstDesc = (await ask(`  First Agent description: `)).trim();

      const secondName = (await ask('\n  Second Agent name: ')).trim();
      if (!secondName) continue;
      const secondRole = (await ask(`  Second Agent role [qa]: `)).trim() || 'qa';
      const secondDesc = (await ask(`  Second Agent description: `)).trim();

      // Remove any existing agents with these names and clear stale pairings
      for (let i = agents.length - 1; i >= 0; i--) {
        if (agents[i].name === firstName || agents[i].name === secondName) agents.splice(i, 1);
      }
      for (const a of agents) {
        if (a.reviews === firstName || a.reviews === secondName) delete a.reviews;
      }

      const firstAgent: Agent = { name: firstName, role: firstRole === 'qa' ? 'qa' : 'developer', repo, description: firstDesc };
      const secondAgent: Agent = { name: secondName, role: secondRole === 'qa' ? 'qa' : 'developer', repo, description: secondDesc, reviews: firstName };
      agents.push(firstAgent, secondAgent);
      console.log(`\n  ✓ Paired: ${firstName} (${firstAgent.role}) ⟷ ${secondName} (${secondAgent.role})`);
    } else if (cmd === 'r') {
      const name = (await ask('  agent name to remove: ')).trim();
      const idx = agents.findIndex((a) => a.name === name);
      if (idx === -1) {
        console.log(`  Unknown agent '${name}'`);
        continue;
      }
      if (agents[idx].role === 'coordinator') {
        console.log(`  Cannot remove the coordinator`);
        continue;
      }
      // Check if this agent is part of a pair
      const partner =
        agents[idx].reviews
          ? agents.find((a) => a.name === agents[idx].reviews)
          : agents.find((a) => a.reviews === name);
      if (partner) {
        const confirm = (await ask(`  ⚠ '${name}' and '${partner.name}' are a pair. Both will be removed. Proceed? [y/n]: `)).trim().toLowerCase();
        if (confirm !== 'y') {
          console.log('  Cancelled.');
          continue;
        }
        const partnerIdx = agents.findIndex((a) => a.name === partner.name);
        agents.splice(Math.max(idx, partnerIdx), 1);
        agents.splice(Math.min(idx, partnerIdx), 1);
        console.log(`  ✓ Removed '${name}' and '${partner.name}'`);
      } else {
        agents.splice(idx, 1);
        console.log(`  ✓ Removed '${name}'`);
      }
    }
  }

  return agents;
}

// ── service editor ───────────────────────────────────────────────────────────

async function editServices(
  ask: (q: string) => Promise<string>,
  initial: Array<{ name: string; cwd: string; command: string }>,
): Promise<Array<{ name: string; cwd: string; command: string }>> {
  const services = [...initial];

  while (true) {
    console.log('\ntmux windows for services:');
    printTable(
      ['Name', 'CWD', 'Command'],
      [
        ['watcher', '(workspace root)', 'camper watch  [built-in]'],
        ...services.map((s) => [s.name, s.cwd, s.command]),
      ],
    );
    console.log('  [a]dd  [r]remove  [enter] done');

    const cmd = (await ask('  > ')).trim().toLowerCase();
    if (!cmd) break;

    if (cmd === 'a') {
      const name = (await ask('  service name: ')).trim();
      if (!name) continue;
      const cwd = (await ask(`  cwd [./${name}]: `)).trim() || `./${name}`;
      const command = (await ask('  start command: ')).trim();
      services.push({ name, cwd, command });
    } else if (cmd === 'r') {
      const name = (await ask('  service name to remove: ')).trim();
      if (name === 'watcher') {
        console.log('  watcher is a built-in window and cannot be removed.');
        continue;
      }
      const idx = services.findIndex((s) => s.name === name);
      if (idx === -1) {
        console.log(`  Unknown service '${name}'`);
      } else {
        services.splice(idx, 1);
      }
    }
  }

  return services;
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function init(parentCwd: string = process.cwd()): Promise<void> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n🏕  camper init\n');

  let workspace: string;
  let session: string;
  let workspaceGithub: string | undefined;
  let repos: Record<string, Repo>;
  let bossName: string;
  let agents: Agent[];
  let services: Array<{ name: string; cwd: string; command: string }>;

  try {
    workspace = (await ask('Workspace name (e.g. my-project): ')).trim();
    session =
      (await ask(`tmux session name [${workspace.toLowerCase().replace(/\s+/g, '-')}]: `)).trim() ||
      workspace.toLowerCase().replace(/\s+/g, '-');

    const githubRaw = (await ask('Workspace github remote (optional): ')).trim();
    workspaceGithub = githubRaw ? normalizeGithub(githubRaw) : undefined;

    repos = await editRepos(ask, {});

    bossName = (await ask('\nCoordinator agent name [boss]: ')).trim() || 'boss';

    agents = await editAgents(ask, [
      {
        name: bossName,
        role: 'coordinator',
        repo: null,
        description:
          'Project coordinator. Directs the agent team, breaks down work, owns merges to master in each repo. Never implements features directly — delegates to developers.',
      },
    ], repos);

    services = await editServices(ask, []);
  } finally {
    rl.close();
  }

  // Create (or clone) the workspace directory
  const cwd = resolve(parentCwd, session);
  if (!existsSync(cwd)) {
    if (workspaceGithub) {
      console.log(`\nCloning workspace ${workspaceGithub} → ${session}/`);
      execFileSync('git', ['clone', cloneUrl(workspaceGithub), cwd]);
    } else {
      console.log(`\nCreating workspace directory ${session}/`);
      mkdirSync(cwd, { recursive: true });
      execFileSync('git', ['init'], { cwd });
    }
  } else {
    console.log(`\n✓ Workspace directory ${session}/ already exists`);
    // Wire up remote if not already set and github was provided
    if (workspaceGithub) {
      try {
        execFileSync('git', ['remote', 'add', 'origin', cloneUrl(workspaceGithub)], { cwd, stdio: 'ignore' });
      } catch {
        // remote already exists
      }
    }
  }

  // Write camper.json
  const config: CamperConfig = {
    workspace,
    session,
    coordinator: bossName,
    repos,
    agents,
    ...(services.length > 0 ? { services } : {}),
    watcher: { interval: 5, issuesFile: '.beads/issues.jsonl' },
    claude: { command: 'claude --model sonnet --permission-mode auto' },
  };

  const configPath = join(cwd, 'camper.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ Wrote ${session}/camper.json`);

  // Clone repos and set up worktrees
  for (const [repoName, repo] of Object.entries(repos)) {
    const repoPath = resolve(cwd, repo.path);

    if (!existsSync(repoPath)) {
      if (repo.github) {
        console.log(`\nCloning ${repo.github} → ${repo.path}`);
        execFileSync('git', ['clone', cloneUrl(repo.github), repoPath]);
      } else {
        console.log(`\nCreating empty repo at ${repo.path}`);
        mkdirSync(repoPath, { recursive: true });
        execFileSync('git', ['init'], { cwd: repoPath });
      }
    } else {
      console.log(`\n✓ ${repoName} already exists at ${repo.path}`);
    }

    const repoAgents = agents.filter((a) => a.repo === repoName);
    for (const agent of repoAgents) {
      const worktreePath = resolve(cwd, `${session}-${agent.name}`);
      const branch = `agent/${agent.name}`;

      if (existsSync(worktreePath)) {
        console.log(`  ✓ worktree ${session}-${agent.name} already exists`);
        continue;
      }

      try {
        execFileSync('git', ['checkout', '-b', branch], { cwd: repoPath, stdio: 'ignore' });
        execFileSync('git', ['checkout', '-'], { cwd: repoPath, stdio: 'ignore' });
      } catch {
        // branch already exists
      }

      try {
        execFileSync('git', ['worktree', 'add', worktreePath, branch], { cwd: repoPath });
        console.log(`  ✓ created worktree ${session}-${agent.name} (${branch})`);
      } catch (err) {
        console.warn(`  ⚠ could not create worktree for ${agent.name}:`, err);
      }

      seedClaudeSettings(worktreePath);
    }
  }

  // Seed coordinator settings in first repo's main worktree
  const firstRepoPath = resolve(cwd, Object.values(repos)[0].path);
  seedClaudeSettings(firstRepoPath);

  // Initialize beads at workspace root
  if (!existsSync(join(cwd, '.beads'))) {
    try {
      execFileSync('bd', ['init', '--role=maintainer'], { cwd, stdio: 'inherit' });
      console.log('\n✓ beads initialized');
    } catch {
      console.warn('\n⚠ bd not found — install beads and run bd init manually');
    }
  } else {
    console.log('\n✓ beads already initialized');
  }

  writeGitignore(cwd, repos, agents, session);

  console.log('\n✅ camper workspace ready. Run: camper start\n');
}

function seedClaudeSettings(dir: string): void {
  const claudeDir = join(dir, '.claude');
  const settingsPath = join(claudeDir, 'settings.local.json');
  if (!existsSync(settingsPath)) {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(CLAUDE_SETTINGS, null, 2) + '\n');
    console.log(`  ✓ seeded .claude/settings.local.json in ${dir}`);
  }
}

function writeGitignore(
  cwd: string,
  repos: Record<string, Repo>,
  agents: Agent[],
  session: string,
): void {
  const lines = [
    '# camper — sub-repos and worktrees',
    ...Object.values(repos).map((r) => r.path.replace(/^\.\//, '')),
    ...agents.filter((a) => a.repo).map((a) => `${session}-${a.name}`),
    '',
    '# beads state (committed intentionally — remove this line to track)',
    '# .beads/',
    '',
    'node_modules/',
  ];

  const gitignorePath = join(cwd, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  if (!existing.includes('# camper')) {
    writeFileSync(
      gitignorePath,
      existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n',
    );
    console.log('\n✓ updated .gitignore');
  }
}
