// ============================================================
// Default configuration values
// ============================================================

export interface AppConfig {
    theme: string;
    defaultPriority: string;
    defaultView: string;
    branchPrefix: string;
    branchBase: string;
    dateFormat: string;
    editor: string;
}

export const DEFAULT_CONFIG: AppConfig = {
    theme: 'default',
    defaultPriority: 'medium',
    defaultView: 'dashboard',
    branchPrefix: 'feat',
    branchBase: 'main',
    dateFormat: 'MMM d, yyyy',
    editor: process.env.EDITOR || 'vim',
};

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[];
