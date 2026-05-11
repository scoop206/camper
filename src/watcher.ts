import chokidar from 'chokidar';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import type { CamperConfig } from './config.js';
import { send } from './tmux.js';

interface Issue {
  id: string;
  status: string;
  closed_at?: string;
  close_reason?: string;
  title?: string;
}

export function startWatcher(config: CamperConfig, root: string): void {
  const issuesFile = resolve(root, config.watcher!.issuesFile!);
  const coordinatorAgent = config.agents.find((a) => a.name === config.coordinator);
  const coordinatorWindow = coordinatorAgent?.tmuxWindow ?? config.coordinator;
  const session = config.session;

  // Seed last-check to now so old closures don't fire on startup
  let lastCheck = Math.floor(Date.now() / 1000);

  console.log(`[camper-watch] started — watching ${issuesFile}`);
  console.log(`[camper-watch] notifying ${session}:${coordinatorWindow} on new closures`);

  const watcher = chokidar.watch(issuesFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }, // wait for write to complete
  });

  watcher.on('change', () => {
    const now = Math.floor(Date.now() / 1000);
    try {
      const newlyClosedIssues = getNewlyClosedIssues(root, lastCheck);
      for (const issue of newlyClosedIssues) {
        const reason = issue.close_reason ? ` [${issue.close_reason}]` : '';
        const label = (issue.title ?? issue.id) + reason;
        const msg = `Watcher: ${issue.id} closed — ${label}. Run: bd show ${issue.id}`;
        console.log(`[${timestamp()}] ${msg}`);
        send(session, coordinatorWindow, msg);
      }
    } catch (err) {
      console.error('[camper-watch] error reading issues:', err);
    }
    lastCheck = now;
  });

  watcher.on('error', (err) => console.error('[camper-watch] watcher error:', err));
}

function getNewlyClosedIssues(root: string, since: number): Issue[] {
  try {
    const out = execFileSync('bd', ['list', '--status=closed', '--json'], {
      cwd: root,
      encoding: 'utf-8',
    });
    const issues = JSON.parse(out) as Issue[];
    return issues.filter((issue) => {
      if (!issue.closed_at) return false;
      const ts = Math.floor(new Date(issue.closed_at).getTime() / 1000);
      return ts >= since;
    });
  } catch (err) {
    console.error('[camper-watch] bd list failed:', err);
    return [];
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}
