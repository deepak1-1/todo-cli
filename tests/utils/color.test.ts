import chalk from 'chalk';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import '../../src/utils/initThemes.js';
import { loadTheme, theme } from '../../src/utils/theme.js';
import { configureColor } from '../../src/utils/color.js';

describe('configureColor', () => {
    const originalLevel = chalk.level;

    beforeEach(() => {
        chalk.level = 3;
        delete process.env['NO_COLOR'];
        loadTheme('default');
    });

    afterEach(() => {
        chalk.level = originalLevel;
        delete process.env['NO_COLOR'];
        loadTheme('default');
    });

    it('sets chalk.level to 0 when color is false', () => {
        configureColor({ color: false });
        expect(chalk.level).toBe(0);
    });

    it('does not decrease chalk.level when color is true', () => {
        chalk.level = 3;
        configureColor({ color: true });
        expect(chalk.level).toBe(3);
    });

    it('sets chalk.level to 0 when NO_COLOR env var is set', () => {
        process.env['NO_COLOR'] = '1';
        configureColor({ color: true });
        expect(chalk.level).toBe(0);
    });

    it('sets chalk.level to 0 when NO_COLOR is any non-empty value', () => {
        process.env['NO_COLOR'] = 'true';
        configureColor({ color: true });
        expect(chalk.level).toBe(0);
    });

    it('loads the theme when color is enabled', () => {
        // After configureColor with color:true, palette must be non-identity.
        configureColor({ color: true });
        const palette = theme();
        // Identity palette has ink === '' on all entries; default palette does not.
        expect(palette.success.ink).not.toBe('');
    });
});
