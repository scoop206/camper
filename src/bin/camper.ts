#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { start } from '../commands/start.js';
import { sendMessage } from '../commands/send.js';
import { compact } from '../commands/compact.js';
import { clear } from '../commands/clear.js';
import { status } from '../commands/status.js';
import { startWatcher } from '../watcher.js';
import { killSession } from '../tmux.js';
import { init } from '../commands/init.js';
import { sync } from '../commands/sync.js';

const program = new Command();

program.name('camper').description('Multi-agent Claude Code team manager').version('0.1.0');

program
  .command('init')
  .description('Scaffold a new camper workspace interactively')
  .action(async () => {
    await init(process.cwd());
  });

program
  .command('sync')
  .description('Regenerate CLAUDE.md from camper.json and push to all agent branches')
  .action(() => {
    const { config, root } = loadConfig();
    sync(config, root);
  });

program
  .command('start')
  .description('Boot the tmux session with all agent, service, and utility windows')
  .action(() => {
    const { config, root } = loadConfig();
    start(config, root);
  });

program
  .command('stop')
  .description('Kill the tmux session')
  .action(() => {
    const { config } = loadConfig();
    killSession(config.session);
    console.log(`Session '${config.session}' stopped.`);
  });

program
  .command('watch')
  .description('Run the watcher daemon (notifies coordinator when issues close)')
  .action(() => {
    const { config, root } = loadConfig();
    startWatcher(config, root);
  });

program
  .command('send <agent> <message>')
  .description('Send a message to an agent window (safe tmux wrapper)')
  .action((agent: string, message: string) => {
    const { config } = loadConfig();
    sendMessage(config, agent, message);
  });

program
  .command('compact [agent]')
  .description('Send /compact to one agent or all agents (omit name for all)')
  .action((agent?: string) => {
    const { config } = loadConfig();
    compact(config, agent);
  });

program
  .command('clear [agent]')
  .description('Send /clear to one agent or all agents (omit name for all)')
  .action((agent?: string) => {
    const { config } = loadConfig();
    clear(config, agent);
  });

program
  .command('status')
  .description('Show tmux session and window health')
  .action(() => {
    const { config } = loadConfig();
    status(config);
  });

program.parse();
