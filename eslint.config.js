// ESLint 9 flat config — typescript-eslint recommended + prettier-compat tuning
import tseslint from 'typescript-eslint';

export default tseslint.config(
    // Global ignores — never lint generated or dependency artifacts
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
    // Apply typescript-eslint recommended rules to TS/TSX source and tests
    ...tseslint.configs.recommended.map((cfg) => ({
        ...cfg,
        files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
    })),
    {
        files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts'],
        rules: {
            // Downgrade to warn — pre-existing code has explicit-any in many places
            '@typescript-eslint/no-explicit-any': 'warn',
            // Downgrade to warn — pre-existing require() calls in dynamic contexts
            '@typescript-eslint/no-require-imports': 'warn',
            // Downgrade to warn — pre-existing empty interface declarations
            '@typescript-eslint/no-empty-object-type': 'warn',
            // Downgrade to warn — pre-existing unused variables (tsc already covers this)
            '@typescript-eslint/no-unused-vars': 'warn',
            // Downgrade to warn — pre-existing non-null assertions
            '@typescript-eslint/no-non-null-assertion': 'warn',
            // Off — @ts-ignore and @ts-expect-error suppressions exist in test helpers
            '@typescript-eslint/ban-ts-comment': 'off',
            // Off — namespace/module usage in pre-existing type declarations
            '@typescript-eslint/no-namespace': 'off',
        },
    },
);
