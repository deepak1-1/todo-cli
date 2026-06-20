// ============================================================
// AI Backend — Claude CLI primary, local model fallback
// ============================================================

import * as path from 'node:path';
import * as os from 'node:os';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIntentSchema, validateIntent, type Intent } from './intent.js';
import { buildSystemPrompt, type TaskSummary } from './prompt.js';
import { getDb } from '../storage/database.js';
import { debug } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

const HOME = os.homedir();
const MODELS_DIR = path.join(HOME, '.todo-cli', 'models');
const MODEL_URI = 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M';
const MAX_TOKENS = 2048;
const INFERENCE_TIMEOUT_MS = 30_000;

const DB_SCHEMA = `
CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',   -- key from statuses table (builtin: todo, in_progress, in_review, blocked, done, archived; user-defined keys also valid)
  priority TEXT NOT NULL DEFAULT 'medium',  -- urgent, high, medium, low
  project_id INTEGER REFERENCES projects(id),
  due_date TEXT,              -- ISO date e.g. '2025-03-15'
  time_spent INTEGER DEFAULT 0,  -- total tracked time in SECONDS
  created_at TEXT NOT NULL, completed_at TEXT, archived_at TEXT
);

CREATE TABLE time_tracking (
  id INTEGER PRIMARY KEY, task_id INTEGER REFERENCES tasks(id),
  started_at TEXT NOT NULL, ended_at TEXT,
  duration INTEGER DEFAULT 0,  -- session duration in SECONDS
  note TEXT
);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE task_tags (task_id INTEGER, tag_id INTEGER, PRIMARY KEY(task_id, tag_id));
CREATE TABLE action_log (id INTEGER PRIMARY KEY, task_id INTEGER, action TEXT, entity_type TEXT, timestamp TEXT);
CREATE TABLE pomodoro_sessions (id INTEGER PRIMARY KEY, task_id INTEGER, started_at TEXT, duration INTEGER, completed INTEGER, notes TEXT);
CREATE TABLE dependencies (task_id INTEGER, depends_on_id INTEGER, PRIMARY KEY(task_id, depends_on_id));
`.trim();

const SQL_FEW_SHOTS = `
Q: What did I work on today?
SQL: SELECT t.title, ROUND(SUM(tt.duration)/3600.0, 1) AS hours FROM time_tracking tt JOIN tasks t ON tt.task_id = t.id WHERE date(tt.started_at) = date('now') GROUP BY t.id ORDER BY hours DESC

Q: How many tasks did I complete this week?
SQL: SELECT COUNT(*) AS completed FROM tasks WHERE status = 'done' AND completed_at >= date('now', '-7 days')

Q: Show time spent per project in hours
SQL: SELECT p.name AS project, ROUND(SUM(t.time_spent)/3600.0, 1) AS hours FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.time_spent > 0 GROUP BY p.id ORDER BY hours DESC

Q: Which tasks are overdue?
SQL: SELECT t.id, t.title, t.due_date, t.priority, p.name AS project FROM tasks t LEFT JOIN projects p ON t.project_id = p.id WHERE t.due_date < date('now') AND t.status NOT IN (SELECT key FROM statuses WHERE archives = 1 OR completes = 1) ORDER BY t.due_date

Q: How many days did I work more than 8 hours?
SQL: SELECT date(started_at) AS day, ROUND(SUM(duration)/3600.0, 1) AS hours FROM time_tracking GROUP BY day HAVING SUM(duration) > 28800 ORDER BY day
`.trim();

const BLOCKED_SQL = /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REPLACE|GRANT|REVOKE|TRUNCATE)\b/i;

function validateSql(sql: string): { valid: boolean; error?: string } {
    const trimmed = sql.trim().replace(/;+$/, '');
    if (!/^SELECT\b/i.test(trimmed)) return { valid: false, error: 'Only SELECT queries allowed.' };
    if (BLOCKED_SQL.test(trimmed)) return { valid: false, error: 'Query contains disallowed keywords.' };
    return { valid: true };
}

type Backend = 'claude' | 'local' | 'none';

export class ModelManager {
    private backend: Backend = 'none';
    private model: unknown = null;
    private context: unknown = null;
    private session: unknown = null;
    private grammar: unknown = null;
    private systemPrompt = '';
    modelSource = '';

    /** Check if claude CLI is available */
    private isClaudeAvailable(): boolean {
        try {
            execFileSync('claude', ['--version'], { stdio: 'ignore', timeout: 5000 });
            return true;
        } catch (err: unknown) {
            debug('chat.model.claude_cli_probe', err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async ensureAndLoad(taskSummary?: TaskSummary, statusKeys?: string[]): Promise<void> {
        this.systemPrompt = buildSystemPrompt(taskSummary);

        // Try Claude CLI first
        if (this.isClaudeAvailable()) {
            this.backend = 'claude';
            this.modelSource = 'claude';
            return;
        }

        // Fall back to local model
        await this.loadLocalModel(taskSummary, statusKeys);
    }

    private async loadLocalModel(_taskSummary?: TaskSummary, statusKeys?: string[]): Promise<void> {
        const nlc = await import('node-llama-cpp');

        // Try to find existing model on system
        const { findExistingModel } = await import('./model-finder.js');
        const existingPath = await findExistingModel();
        let modelPath: string;

        if (existingPath) {
            try {
                await nlc.readGgufFileInfo(existingPath);
                modelPath = existingPath;
                this.modelSource = existingPath;
            } catch (err: unknown) {
                debug('chat.model.local_model_probe', err instanceof Error ? err.message : String(err));
                modelPath = await nlc.resolveModelFile(MODEL_URI, MODELS_DIR);
                this.modelSource = 'downloaded';
            }
        } else {
            modelPath = await nlc.resolveModelFile(MODEL_URI, MODELS_DIR);
            this.modelSource = 'downloaded';
        }

        const llama = await nlc.getLlama({ logLevel: nlc.LlamaLogLevel.error });
        const model = await llama.loadModel({ modelPath });
        const context = await model.createContext();

        const session = new nlc.LlamaChatSession({
            contextSequence: context.getSequence(),
            systemPrompt: this.systemPrompt,
        });

        // Build schema from live status keys so custom statuses are reachable by the grammar
        const liveSchema = buildIntentSchema(statusKeys ?? []);
        const grammar = await llama.createGrammarForJsonSchema(liveSchema);

        this.model = model;
        this.context = context;
        this.session = session;
        this.grammar = grammar;
        this.backend = 'local';
    }

    get isLoaded(): boolean {
        return this.backend !== 'none';
    }

    get backendName(): string {
        if (this.backend === 'claude') return 'claude';
        if (this.backend === 'local') return 'llama-3.2-3b';
        return 'none';
    }

    /** Two-call pipeline: Claude generates SQL → we execute → Claude formats answer */
    async answerQuestion(userMessage: string, abortSignal?: AbortSignal): Promise<string> {
        if (this.backend !== 'claude') {
            throw new Error('Direct questions require Claude CLI.');
        }

        // --- Call 1: Generate SQL ---
        let sql = '';
        let queryResults: Record<string, unknown>[] = [];
        let lastError = '';

        for (let attempt = 0; attempt < 3; attempt++) {
            const sqlPrompt = attempt === 0
                ? `You are a SQLite expert. Given this schema:\n\n${DB_SCHEMA}\n\nExamples:\n${SQL_FEW_SHOTS}\n\nRules:\n- Output ONLY the SQL query, no explanation, no markdown fences\n- Use only SELECT statements\n- duration and time_spent are in SECONDS — use ROUND(value/3600.0,1) for hours\n- Use date('now') for today, date('now','-1 day') for yesterday\n- Always alias computed columns\n- LIMIT 50 max unless user asks for all\n\nQuestion: ${userMessage}\n\nSQL:`
                : `Your previous SQL:\n${sql}\n\nFailed with error: ${lastError}\n\nGenerate a corrected SQL query. Output ONLY the SQL.\n\nSQL:`;

            try {
                const { stdout } = await execFileAsync('claude', [
                    '-p', sqlPrompt,
                    '--output-format', 'json',
                    '--model', 'haiku',
                ], { timeout: INFERENCE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, signal: abortSignal });

                const response = JSON.parse(stdout);
                sql = (response.result || '').trim();

                // Strip markdown code fences
                sql = sql.replace(/^```sql?\n?/i, '').replace(/\n?```$/i, '').trim();
                sql = sql.replace(/;+$/, '').trim();

                const validation = validateSql(sql);
                if (!validation.valid) return `Can't run that query: ${validation.error}`;

                // Execute SQL
                const db = getDb();
                queryResults = db.prepare(sql).all() as Record<string, unknown>[];
                break; // success
            } catch (err: unknown) {
                lastError = err instanceof Error ? err.message : String(err);
                if (attempt === 2) {
                    return `Sorry, couldn't generate a working query after 3 attempts. Last error: ${lastError}`;
                }
            }
        }

        // --- Call 2: Format answer naturally ---
        const resultData = queryResults.length === 0
            ? 'The query returned no results.'
            : JSON.stringify(queryResults.slice(0, 50), null, 2);

        const answerPrompt = `User asked: "${userMessage}"\n\nQuery results:\n${resultData}${queryResults.length > 50 ? `\n(Showing 50 of ${queryResults.length})` : ''}\n\nAnswer naturally with good formatting. Use bullet points, bold, and clear structure. Convert seconds to hours (÷3600) where appropriate, round to 1 decimal. Be concise — don't explain the SQL.`;

        try {
            const { stdout } = await execFileAsync('claude', [
                '-p', answerPrompt,
                '--output-format', 'json',
                '--model', 'haiku',
            ], { timeout: INFERENCE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, signal: abortSignal });

            const response = JSON.parse(stdout);
            return response.result || 'No response generated.';
        } catch (err: unknown) {
            debug('chat.model.claude_answer_format', err instanceof Error ? err.message : String(err));
            return `Query results:\n${resultData}`;
        }
    }

    async infer(userMessage: string, abortSignal?: AbortSignal): Promise<Intent> {
        if (this.backend === 'claude') {
            return this.inferClaude(userMessage, abortSignal);
        }
        if (this.backend === 'local') {
            return this.inferLocal(userMessage, abortSignal);
        }
        throw new Error('No AI backend available.');
    }

    private async inferClaude(userMessage: string, _abortSignal?: AbortSignal): Promise<Intent> {
        const prompt = `${this.systemPrompt}\n\nUser message: "${userMessage}"\n\nRespond with ONLY the JSON intent object, no other text.`;

        try {
            const { stdout } = await execFileAsync('claude', [
                '-p', prompt,
                '--output-format', 'json',
                '--model', 'haiku',
            ], {
                timeout: INFERENCE_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
            });

            const response = JSON.parse(stdout);
            const resultText = response.result || '';

            // Extract JSON from the result (Claude may wrap it in markdown)
            const jsonMatch = resultText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = validateIntent(JSON.parse(jsonMatch[0]));
                if (!parsed) return { action: 'clarify', message: 'I did not understand. Could you rephrase that?' };
                return parsed;
            }

            const parsed = validateIntent(JSON.parse(resultText));
            if (!parsed) return { action: 'clarify', message: 'I did not understand. Could you rephrase that?' };
            return parsed;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            debug('chat.model.claude_cli_inference', msg);

            // If Claude CLI fails, try local model as fallback
            if (this.backend === 'claude' && !this.session) {
                // Local model not loaded yet — can't fallback
                return { action: 'clarify', message: `Claude CLI error: ${msg}. Try a simpler query.` };
            }

            return { action: 'clarify', message: `AI error: ${msg}` };
        }
    }

    private async inferLocal(userMessage: string, abortSignal?: AbortSignal): Promise<Intent> {
        if (!this.session || !this.grammar) {
            throw new Error('Local model not loaded.');
        }

        const session = this.session as { prompt: (msg: string, opts: Record<string, unknown>) => Promise<string> };
        const grammar = this.grammar as { parse: (text: string) => Intent };

        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), INFERENCE_TIMEOUT_MS);

        const combinedSignal = abortSignal
            ? AbortSignal.any([abortSignal, timeoutController.signal])
            : timeoutController.signal;

        try {
            const response = await session.prompt(userMessage, {
                grammar: this.grammar,
                maxTokens: MAX_TOKENS,
                temperature: 0.3,
                trimWhitespaceSuffix: true,
                signal: combinedSignal,
            });

            clearTimeout(timeout);

            try {
                const parsed = validateIntent(grammar.parse(response));
                if (!parsed) return { action: 'clarify', message: 'I did not understand. Could you rephrase that?' };
                return parsed;
            } catch (err: unknown) {
                debug('chat.model.local_grammar_parse', err instanceof Error ? err.message : String(err));
                try {
                    const parsed = validateIntent(JSON.parse(response.trim()));
                    if (!parsed) return { action: 'clarify', message: 'I did not understand. Could you rephrase that?' };
                    return parsed;
                } catch (err2: unknown) {
                    debug('chat.model.local_json_parse', err2 instanceof Error ? err2.message : String(err2));
                    return { action: 'clarify', message: 'I had trouble understanding that. Could you rephrase?' };
                }
            }
        } catch (err: unknown) {
            clearTimeout(timeout);
            if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
                throw err;
            }
            return { action: 'clarify', message: 'Something went wrong. Try again or rephrase.' };
        }
    }

    dispose(): void {
        try {
            if (this.context && typeof (this.context as { dispose: () => void }).dispose === 'function') {
                (this.context as { dispose: () => void }).dispose();
            }
            if (this.model && typeof (this.model as { dispose: () => void }).dispose === 'function') {
                (this.model as { dispose: () => void }).dispose();
            }
        } catch (err: unknown) {
            debug('chat.model.dispose', err instanceof Error ? err.message : String(err));
        }
    }
}
