import chalk from 'chalk';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTable } from '../../src/utils/table.js';

describe('makeTable', () => {
    const originalLevel = chalk.level;

    beforeEach(() => {
        chalk.level = 3;
    });

    afterEach(() => {
        chalk.level = originalLevel;
    });

    it('sets empty head and border arrays when chalk.level is 0', () => {
        chalk.level = 0;
        const table = makeTable({ head: ['A', 'B'] });
        // cli-table3 stores style on the options object used to construct it
        expect((table as unknown as { options: { style: { head: string[]; border: string[] } } }).options.style.head).toEqual([]);
        expect((table as unknown as { options: { style: { head: string[]; border: string[] } } }).options.style.border).toEqual([]);
    });

    it('does not force-override caller style.head when chalk.level is 0', () => {
        chalk.level = 0;
        const table = makeTable({ head: ['A'], style: { head: ['yellow'] } });
        // Caller explicitly set head — preserve it.
        expect((table as unknown as { options: { style: { head: string[] } } }).options.style.head).toEqual(['yellow']);
    });

    it('does not force-override caller style.border when chalk.level is 0', () => {
        chalk.level = 0;
        const table = makeTable({ head: ['A'], style: { border: ['cyan'] } });
        expect((table as unknown as { options: { style: { border: string[] } } }).options.style.border).toEqual(['cyan']);
    });

    it('preserves caller style.head as-is when chalk.level is non-zero', () => {
        chalk.level = 3;
        const table = makeTable({ head: ['A', 'B'], style: { head: ['magenta'] } });
        const style = (table as unknown as { options: { style: { head: string[] } } }).options.style;
        // With color on, caller's style.head is passed through unchanged.
        expect(style.head).toEqual(['magenta']);
    });

    it('passes colWidths and other options through unchanged', () => {
        chalk.level = 3;
        const table = makeTable({ head: ['X'], colWidths: [20], wordWrap: true });
        const opts = (table as unknown as { options: { colWidths: number[]; wordWrap: boolean } }).options;
        expect(opts.colWidths).toEqual([20]);
        expect(opts.wordWrap).toBe(true);
    });
});
