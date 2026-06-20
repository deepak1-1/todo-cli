// Factory that disables cli-table3 ANSI border/head colors when colors are off.
import Table from 'cli-table3';
import type { TableConstructorOptions } from 'cli-table3';
import chalk from 'chalk';

export function makeTable(opts: TableConstructorOptions = {}): InstanceType<typeof Table> {
    const colorOff = chalk.level === 0;
    const style = { ...(opts.style ?? {}) };
    if (colorOff) {
        // Only set empty arrays when caller didn't provide explicit values.
        if (!style.head) style.head = [];
        if (!style.border) style.border = [];
    }
    return new Table({ ...opts, style });
}
