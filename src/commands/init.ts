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

export async function init(cwd: string = process.cwd()): Promise<void> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n🏕  camper init\n');

  let workspace: string;
  let session: string;
  let repos: Record<string, Repo>;
  let bossName: string;
  let agents: Agent[];
  let services: Array<{ name: string; cwd: string; command: string }>;

  try {
    // Workspace name
    workspace = (await ask('Workspace name (e.g. my-project): ')).trim();
    session =
      (await ask(`tmux session name [${workspace.toLowerCase().replace(/\s+/g, '-')}]: `)).trim() ||
      workspace.toLowerCase().replace(/\s+/g, '-');

    // Repos
    console.log('\nDefine your sub-repositories (empty name to finish):');
    repos = {};
    while (true) {
      const name = (await ask('  repo name (e.g. server, web): ')).trim();
      if (!name) break;
      const path = (await ask(`  path for '${name}' [./${name}]: `)).trim() || `./${name}`;
      const github = (await ask(`  github remote for '${name}' (optional): `)).trim();
      repos[name] = { path, ...(github ? { github } : {}) };
    }

    if (Object.keys(repos).length === 0) {
      console.error('At least one repo is required.');
      return;
    }

    // Coordinator (boss)
    bossName = (await ask('\nCoordinator agent name [boss]: ')).trim() || 'boss';

    // Agents
    console.log(
      '\nDefine your agents (empty name to finish). Add coordinator first if you want custom description:',
    );
    agents = [
      {
        name: bossName,
        role: 'coordinator',
        repo: null,
        description: `Project coordinator. Directs the agent team, breaks down work, owns merges to master in each repo. Never implements features directly — delegates to authors.`,
      },
    ];

    while (true) {
      const name = (await ask('  agent name (e.g. mason, sally): ')).trim();
      if (!name) break;

      const repoNames = Object.keys(repos);
      const repoInput = (await ask(`  repo [${repoNames.join('/')}]: `)).trim();
      const repo = repos[repoInput] ? repoInput : repoNames[0];

      const roleInput = (await ask(`  role for '${name}' [author/qa]: `)).trim();
      const role = roleInput === 'qa' ? 'qa' : 'author';

      const reviewedBy =
        role === 'author'
          ? (await ask(`  who QAs '${name}'? (agent name, optional): `)).trim() || undefined
          : undefined;
      const reviews =
        role === 'qa'
          ? (await ask(`  who does '${name}' review? (agent name, optional): `)).trim() || undefined
          : undefined;

      const description = (await ask(`  one-line description for '${name}': `)).trim();

      agents.push({ name, role, repo, description, reviewedBy, reviews });
    }

    // Services
    console.log('\nDefine service windows (empty name to finish):');
    services = [];
    while (true) {
      const name = (await ask('  service name (e.g. backend, vite): ')).trim();
      if (!name) break;
      const serviceCwd = (await ask(`  cwd for '${name}' [./${name}]: `)).trim() || `./${name}`;
      const command = (await ask(`  start command for '${name}': `)).trim();
      services.push({ name, cwd: serviceCwd, command });
    }
  } finally {
    rl.close();
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
  console.log(`\n✓ Wrote camper.json`);

  // Clone repos and set up worktrees
  for (const [repoName, repo] of Object.entries(repos)) {
    const repoPath = resolve(cwd, repo.path);

    if (!existsSync(repoPath)) {
      if (repo.github) {
        console.log(`\nCloning ${repo.github} → ${repo.path}`);
        execFileSync('git', ['clone', `git@github.com:${repo.github}.git`, repoPath]);
      } else {
        console.log(`\nCreating empty repo at ${repo.path}`);
        mkdirSync(repoPath, { recursive: true });
        execFileSync('git', ['init'], { cwd: repoPath });
      }
    } else {
      console.log(`\n✓ ${repoName} already exists at ${repo.path}`);
    }

    // Set up worktrees for agents assigned to this repo
    const repoAgents = agents.filter((a) => a.repo === repoName);
    for (const agent of repoAgents) {
      const worktreePath = resolve(cwd, `${session}-${agent.name}`);
      const branch = `agent/${agent.name}`;

      if (existsSync(worktreePath)) {
        console.log(`  ✓ worktree ${session}-${agent.name} already exists`);
        continue;
      }

      try {
        // Create branch if it doesn't exist
        execFileSync('git', ['checkout', '-b', branch], { cwd: repoPath, stdio: 'ignore' });
        execFileSync('git', ['checkout', '-'], { cwd: repoPath, stdio: 'ignore' });
      } catch {
        // branch already exists, that's fine
      }

      try {
        execFileSync('git', ['worktree', 'add', worktreePath, branch], { cwd: repoPath });
        console.log(`  ✓ created worktree ${session}-${agent.name} (${branch})`);
      } catch (err) {
        console.warn(`  ⚠ could not create worktree for ${agent.name}:`, err);
      }

      // Seed .claude/settings.local.json
      seedClaudeSettings(worktreePath);
    }
  }

  // Seed .claude/settings.local.json for coordinator (in first repo's main worktree)
  const firstRepoPath = resolve(cwd, Object.values(repos)[0].path);
  seedClaudeSettings(firstRepoPath);

  // Initialize beads at workspace root
  if (!existsSync(join(cwd, '.beads'))) {
    try {
      execFileSync('bd', ['init'], { cwd, stdio: 'inherit' });
      console.log('\n✓ beads initialized');
    } catch {
      console.warn('\n⚠ bd not found — install beads and run bd init manually');
    }
  } else {
    console.log('\n✓ beads already initialized');
  }

  // Write .gitignore
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
