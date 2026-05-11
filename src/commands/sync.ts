import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import type { CamperConfig, Agent } from '../config.js';
import { getReviewer } from '../config.js';

export function sync(config: CamperConfig, root: string): void {
  const content = generateSupersetClaudeMd(config);

  // Write to workspace root
  const rootPath = join(root, 'CLAUDE.md');
  writeFileSync(rootPath, content);
  console.log('✓ Generated CLAUDE.md');

  // Push to every agent branch in every repo
  for (const [repoName, repo] of Object.entries(config.repos)) {
    const repoPath = resolve(root, repo.path);
    if (!existsSync(repoPath)) {
      console.warn(`  ⚠ repo '${repoName}' not found at ${repo.path} — skipping`);
      continue;
    }

    const repoAgents = config.agents.filter((a) => a.repo === repoName);

    // Also push to main branch of repo (coordinator works here)
    pushToRef(repoPath, content, 'HEAD', `${repoName}/main`);

    for (const agent of repoAgents) {
      const branch = agent.branch ?? `agent/${agent.name}`;
      pushToRef(repoPath, content, branch, `${repoName}/${agent.name}`);
    }
  }

  console.log('\n✅ CLAUDE.md synced to all branches.');

  // Write agent identities and roster into beads so bd prime surfaces them
  syncBeadsIdentities(config, root);
}

function syncBeadsIdentities(config: CamperConfig, root: string): void {
  try {
    execFileSync('bd', ['--version'], { cwd: root, stdio: 'ignore' });
  } catch {
    console.warn('  ⚠ bd not found — skipping beads identity sync');
    return;
  }

  // Team roster memory — one shared fact all agents see
  const rosterLines = config.agents.map((a) => {
    const reviewer = getReviewer(config, a.name);
    const pair = reviewer ? ` [reviewed by ${reviewer.name}]` : a.reviews ? ` [reviews ${a.reviews}]` : '';
    return `  ${titleCase(a.name)} — ${a.role}${pair} — ${a.description}`;
  });

  const rosterMemory = `CAMPER TEAM ROSTER (${config.workspace})\n${rosterLines.join('\n')}`;

  rememberTagged(root, 'camper:roster', rosterMemory);
  console.log('  ✓ beads: team roster');

  // Per-agent identity memory
  for (const agent of config.agents) {
    const reviewer = getReviewer(config, agent.name);
    const worktreeHint = agent.worktree ?? `${agent.repo ? `${agent.repo}-${agent.name}` : config.session}`;
    const branch = agent.branch ?? (agent.role === 'coordinator' ? 'master' : `agent/${agent.name}`);

    const pairLine = reviewer
      ? `Your output is reviewed by ${titleCase(reviewer.name)} before it ships to master.`
      : agent.reviews
        ? `You review ${titleCase(agent.reviews)}'s output before it ships to master.`
        : '';

    const identityMemory = [
      `CAMPER AGENT IDENTITY: ${titleCase(agent.name)}`,
      `Role: ${agent.role}`,
      `Workspace: ${config.workspace}`,
      `Worktree: ${worktreeHint}`,
      `Branch: ${branch}`,
      `Description: ${agent.description}`,
      pairLine,
      `Coordinator: ${config.coordinator}`,
    ]
      .filter(Boolean)
      .join('\n');

    rememberTagged(root, `camper:identity:${agent.name.toLowerCase()}`, identityMemory);
    console.log(`  ✓ beads: identity for ${agent.name}`);
  }

  console.log('  ✓ beads identities written — agents will see them via bd prime');
}

function rememberTagged(root: string, key: string, body: string): void {
  execFileSync('bd', ['remember', body, '--key', key], { cwd: root, stdio: 'ignore' });
}

function pushToRef(repoPath: string, content: string, branch: string, label: string): void {
  try {
    // Check if branch exists
    execFileSync('git', ['rev-parse', '--verify', branch], { cwd: repoPath, stdio: 'ignore' });
  } catch {
    console.log(`  — skipping ${label} (branch not found)`);
    return;
  }

  // Write content to a temp file, then commit it to the branch via git hash-object + update-ref
  // Safer: use a worktree path if it exists, otherwise write directly via git
  const worktreePath = getWorktreePath(repoPath, branch);
  if (worktreePath && existsSync(worktreePath)) {
    const claudePath = join(worktreePath, 'CLAUDE.md');
    const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf-8') : null;
    if (existing === content) {
      console.log(`  ✓ ${label} — already up to date`);
      return;
    }
    writeFileSync(claudePath, content);
    execFileSync('git', ['add', 'CLAUDE.md'], { cwd: worktreePath });
    execFileSync('git', ['commit', '-m', 'chore: sync CLAUDE.md from camper'], {
      cwd: worktreePath,
    });
    execFileSync('git', ['push', '--set-upstream', 'origin', branch], { cwd: worktreePath });
    console.log(`  ✓ ${label} — synced and pushed`);
  } else {
    console.log(`  — ${label} worktree not found, skipping push (run camper init first)`);
  }
}

function getWorktreePath(repoPath: string, branch: string): string | null {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    const entries = out.trim().split('\n\n');
    for (const entry of entries) {
      const lines = Object.fromEntries(
        entry.split('\n').map((l) => {
          const idx = l.indexOf(' ');
          if (idx === -1) return [l, ''];
          return [l.slice(0, idx), l.slice(idx + 1)];
        }),
      );
      if (lines['branch'] === `refs/heads/${branch}`) {
        return lines['worktree'] ?? null;
      }
    }
  } catch {}
  return null;
}

function generateSupersetClaudeMd(config: CamperConfig): string {
  const sections = config.agents.map((agent) => agentSection(agent, config));

  return `# ${config.workspace} — Agent Instructions

This file is **identical on every branch and worktree**. Git checkouts never
clobber agent identities. Read only the section that matches your working
directory — ignore all other sections.

---

${sections.join('\n---\n\n')}

---

${sharedRules()}

${beadsSection()}
`;
}

function agentSection(agent: Agent, config: CamperConfig): string {
  const worktreeHint =
    agent.role === 'coordinator'
      ? Object.values(config.repos)
          .map((r) => r.path)
          .join(', ')
      : (agent.worktree ?? `../${config.session}-${agent.name}`);

  const reviewer = getReviewer(config, agent.name);
  const reviewInfo = reviewer
    ? `**${reviewer.name}** reviews your output before it ships to master.`
    : agent.reviews
      ? `You review **${agent.reviews}**'s output.`
      : '';

  const reviewedAgent = agent.reviews ? config.agents.find((a) => a.name === agent.reviews) : null;
  const reviewedBranch = reviewedAgent?.branch ?? (agent.reviews ? `agent/${agent.reviews}` : '<developer-branch>');

  const branchSection =
    agent.role === 'coordinator'
      ? `### Branch\n\nWork directly on \`master\` in each repo.`
      : agent.role === 'qa'
        ? `### Branch

\`${agent.branch ?? `agent/${agent.name}`}\` — QA staging area. Check out the developer's branch in detached HEAD mode before testing:

\`\`\`bash
git fetch origin
git checkout --detach origin/${reviewedBranch}
\`\`\``
        : `### Branch

\`${agent.branch ?? `agent/${agent.name}`}\` — all your work stays here until ${config.coordinator} merges it to \`master\`.

\`\`\`bash
git fetch origin
git rebase origin/master
\`\`\``;

  const signalingSection =
    agent.role === 'coordinator'
      ? ''
      : `
### Signalling Completion

1. Close your beads issue: \`bd close <issue-id>${agent.role === 'qa' ? ' --reason="PASS"' : ''}\`
2. Run \`/compact\` to compress your context before the next task.

The watcher daemon notifies ${config.coordinator} automatically when the issue closes.`;

  return `## ${titleCase(agent.name)} — \`${worktreeHint}\`

${agent.description}
${reviewInfo ? `\n${reviewInfo}\n` : ''}
${branchSection}
${signalingSection}
### Team

${config.agents
  .filter((a) => a.name !== agent.name)
  .map((a) => `- **${titleCase(a.name)}** — ${a.description.split('.')[0]}`)
  .join('\n')}
`;
}

function sharedRules(): string {
  return `# Shared Rules

- **Tests are not optional.** Any new code must ship with tests in the same change.
- A bug fix must include a regression test that fails before the fix and passes after.`;
}

function beadsSection(): string {
  return `# Shared: Beads Issue Tracker

<!-- BEGIN BEADS INTEGRATION -->
This project uses **bd (beads)** for issue tracking. Run \`bd prime\` for full context.

\`\`\`bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
\`\`\`

- Use \`bd\` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run \`bd prime\` for detailed command reference
- Use \`bd remember\` for persistent knowledge
<!-- END BEADS INTEGRATION -->`;
}

function titleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
