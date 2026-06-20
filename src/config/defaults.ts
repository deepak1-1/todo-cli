// ============================================================
// Default configuration values
// ============================================================

export interface AppConfig {
    theme: string;
    defaultPriority: string;
    defaultView: string;
    pomodoroMinutes: number;
    shortBreakMinutes: number;
    longBreakMinutes: number;
    sessionsBeforeLongBreak: number;
    branchPrefix: string;
    branchBase: string;
    dateFormat: string;
    editor: string;
}

export const DEFAULT_CONFIG: AppConfig = {
    theme: 'default',
    defaultPriority: 'medium',
    defaultView: 'dashboard',
    pomodoroMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    sessionsBeforeLongBreak: 4,
    branchPrefix: 'feat',
    branchBase: 'main',
    dateFormat: 'MMM d, yyyy',
    editor: process.env.EDITOR || 'vim',
};

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as (keyof AppConfig)[];
