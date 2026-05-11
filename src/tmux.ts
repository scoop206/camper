import { execSync, execFileSync } from 'child_process';

export function sessionExists(session: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', session], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function newSession(session: string, windowName: string, cwd: string): void {
  execFileSync('tmux', ['new-session', '-d', '-s', session, '-n', windowName, '-c', cwd]);
}

export function newWindow(session: string, name: string, cwd: string): void {
  execFileSync('tmux', ['new-window', '-t', session, '-n', name, '-c', cwd]);
}

export function selectWindow(session: string, name: string): void {
  execFileSync('tmux', ['select-window', '-t', `${session}:${name}`]);
}

// Safe send-keys: paste text then submit with Enter — avoids the two-step footgun
export function send(session: string, window: string, text: string): void {
  const target = `${session}:${window}`;
  execFileSync('tmux', ['send-keys', '-t', target, text, '']);
  execFileSync('tmux', ['send-keys', '-t', target, '', 'Enter']);
}

export function attach(session: string): never {
  execFileSync('tmux', ['attach-session', '-t', session], { stdio: 'inherit' });
  process.exit(0);
}

export function killSession(session: string): void {
  execFileSync('tmux', ['kill-session', '-t', session]);
}

export function listWindows(session: string): string[] {
  try {
    const out = execFileSync('tmux', ['list-windows', '-t', session, '-F', '#{window_name}'], {
      encoding: 'utf-8',
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function windowExists(session: string, name: string): boolean {
  return listWindows(session).includes(name);
}
