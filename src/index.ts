// Todo CLI — Entry point.

// Load all built-in themes so they are registered before any loadTheme() call.
import './utils/initThemes.js';

import { Command, CommanderError } from 'commander';
import { closeDb } from './storage/database.js';
import { error } from './utils/format.js';
import { configureColor } from './utils/color.js';
import { theme, loadTheme, disableColors } from './utils/theme.js';
import { getConfig } from './config/manager.js';
import { CredentialFileCorruptError } from './plugins/credential-store.js';
import { EXIT } from './utils/exit.js';

// Commands
import { addCommand } from './commands/add.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { editCommand } from './commands/edit.js';
import { deleteCommand } from './commands/delete.js';
import { bulkCommand } from './commands/bulk.js';
import { startCommand, doneCommand, archiveCommand, qaCommand, reopenCommand } from './commands/status.js';
import { projectCommand } from './commands/project.js';
import { tagCommand } from './commands/tag.js';
import { statsCommand } from './commands/stats.js';
import { undoCommand, historyCommand } from './commands/undo.js';
import { configCommand } from './commands/config.js';
import { contextCommand } from './commands/context-cmd.js';
import { timerCommand } from './commands/timer.js';

// Plugin & Integration commands
import { integrateCommand } from './commands/integrate.js';
import { pluginCommand } from './commands/plugin.js';
import { jiraCommand } from './commands/jira.js';
import { githubCommand } from './commands/github.js';

// Load theme early so --help is colored even before preAction fires.
if (process.argv.includes('--no-color') || process.env['NO_COLOR']) {
    disableColors();
} else {
    loadTheme(getConfig('theme') as string);
}

const program = new Command();

program
    .name('todo')
    .description('AI-powered task management for your terminal')
    .version('1.0.0', '-V, --version')
    .option('--no-color', 'Disable colored output')
    .option('-q, --quiet', 'Minimal output')
    .option('-v, --verbose', 'Verbose output');

// Color Commander help output using the active theme.
program.configureHelp({
    subcommandTerm: (cmd) => theme().accent.chalk(cmd.name()) + (cmd.usage() ? ' ' + cmd.usage() : ''),
    optionTerm: (opt) => theme().info.chalk(opt.flags),
    commandDescription: (cmd) => theme().muted.chalk(cmd.description()),
});

// Apply color setting before every action, including the default action.
program.hook('preAction', (thisCommand) => {
    configureColor({ color: thisCommand.opts()['color'] !== false });
});

// Core commands
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(editCommand);
program.addCommand(deleteCommand);
program.addCommand(bulkCommand);

// Status transitions
program.addCommand(startCommand);
program.addCommand(doneCommand);
program.addCommand(archiveCommand);
program.addCommand(qaCommand);
program.addCommand(reopenCommand);

// Organizational
program.addCommand(projectCommand);
program.addCommand(tagCommand);

// Developer tools
program.addCommand(contextCommand);

// Data management
program.addCommand(statsCommand);
program.addCommand(undoCommand);
program.addCommand(historyCommand);
program.addCommand(configCommand);
program.addCommand(timerCommand);

// Plugin system
program.addCommand(integrateCommand);
program.addCommand(pluginCommand);

// Integrations
program.addCommand(jiraCommand);
program.addCommand(githubCommand);

// Chat command (explicit)
program
    .command('chat')
    .description('Open interactive AI chat mode')
    .action(async () => {
        const { startChat } = await import('./chat/index.js');
        await startChat();
    });

// Default action (no subcommand) — Launch AI chat mode.
program.action(async () => {
    const { startChat } = await import('./chat/index.js');
    await startChat();
});

// Cleanup on exit.
process.on('exit', () => closeDb());
process.on('SIGINT', () => { closeDb(); process.exit(0); });

function reportCliError(err: unknown): void {
    if (err instanceof CommanderError) return;
    if (err instanceof CredentialFileCorruptError) {
        console.error(error(`${err.message}\nDelete the file and re-run the auth command to reset your credentials.`));
        process.exit(EXIT.CONFIG_ERROR);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(error(message));
    process.exit(EXIT.GENERIC);
}

process.on('unhandledRejection', reportCliError);

try {
    program.parse();
} catch (err: unknown) {
    reportCliError(err);
}
