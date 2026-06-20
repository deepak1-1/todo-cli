// ChatApp — root Ink component for the chat interface.

import { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';

import { Message, type ChatMessage } from './Message.js';
import { ChatInput } from './ChatInput.js';

import { ModelManager } from '../model.js';
import { IntentExecutor } from '../executor.js';
import { preparse, isQueryLike } from '../preparse.js';
import { getContext, type AppContext } from '../../commands/context.js';
import { ThemeProvider, useTheme } from '../theme-context.js';
import { theme, loadTheme } from '../../utils/theme.js';
import { getConfig } from '../../config/manager.js';

const EXIT_COMMANDS = new Set(['.exit', 'quit', 'bye', 'exit']);

function ChatAppInner() {
    const t = useTheme();
    const { exit } = useApp();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [lastTiming, setLastTiming] = useState<number | undefined>(undefined);
    const [modelReady, setModelReady] = useState(false);
    const [modelStatus, setModelStatus] = useState('Initializing...');
    const [backendName, setBackendName] = useState('');
    const [taskCount, setTaskCount] = useState(0);

    const modelRef = useRef<ModelManager | null>(null);
    const executorRef = useRef<IntentExecutor | null>(null);
    const ctxRef = useRef<AppContext | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const { stdout } = useStdout();
    const cols = stdout?.columns || 80;

    useInput((_input, key) => {
        if (key.escape && isLoading && abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
            setIsLoading(false);
            setMessages(prev => [...prev, { role: 'system', content: 'Cancelled.' }]);
        }
    });

    useEffect(() => {
        const init = async () => {
            try {
                const ctx = getContext();
                ctxRef.current = ctx;
                const counts = ctx.taskRepo.countByStatus();
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                setTaskCount(total);

                const overdue = ctx.taskRepo.list({ dueDate: 'overdue' }).length;

                const model = new ModelManager();
                const executor = new IntentExecutor(ctx);
                modelRef.current = model;
                executorRef.current = executor;

                const statusKeys = ctx.statusRepo.list().map(d => d.key);
                await model.ensureAndLoad({
                    total,
                    pending: counts.todo || 0,
                    inProgress: counts.in_progress || 0,
                    overdue,
                }, statusKeys);

                setModelReady(true);
                setModelStatus('');
                setBackendName(model.backendName);
                const sourceMsg = model.backendName === 'claude'
                    ? 'Using Claude CLI (your existing auth).'
                    : model.modelSource === 'downloaded'
                        ? 'Local model downloaded and ready.'
                        : `Using local model from ${model.modelSource}`;
                setMessages([{
                    role: 'system',
                    content: `${sourceMsg}\nType naturally — "add task", "show today", "summarize work today"`,
                }]);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                setModelStatus(`Failed to load model: ${msg}`);
                setMessages([{
                    role: 'system',
                    content: `Model failed to load. Use CLI commands: todo add, todo ls, todo done <id>`,
                }]);
            }
        };
        init();

        return () => {
            modelRef.current?.dispose();
        };
    }, []);

    const handleSubmit = useCallback(async (input: string) => {

        if (EXIT_COMMANDS.has(input.toLowerCase())) {
            setMessages(prev => [...prev, { role: 'system', content: 'Goodbye!' }]);
            setTimeout(() => exit(), 200);
            return;
        }

        if (!modelRef.current || !executorRef.current) return;
        const model = modelRef.current;
        const executor = executorRef.current;

        setMessages(prev => [...prev, { role: 'user', content: input }]);

        if (executor.pendingDelete) {
            const result = executor.handleDeleteConfirmation({
                action: 'clarify',
                message: input.toLowerCase(),
            });
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.message,
                taskOutput: result.taskOutput,
            }]);
            refreshTaskCount();
            return;
        }

        const startTime = performance.now();

        const localIntent = preparse(input);
        if (localIntent) {
            try {
                const result = await executor.execute(localIntent);
                const elapsed = Math.round(performance.now() - startTime);
                setLastTiming(elapsed);
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: result.message,
                    taskOutput: result.taskOutput,
                    timing: elapsed,
                }]);
                refreshTaskCount();
            } catch (err: unknown) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                }]);
            }
            return;
        }

        setIsLoading(true);
        abortRef.current = new AbortController();

        try {
            if (model.backendName === 'claude' && isQueryLike(input)) {
                const answer = await model.answerQuestion(input, abortRef.current?.signal);
                const elapsed = Math.round(performance.now() - startTime);
                setLastTiming(elapsed);
                setIsLoading(false);

                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: answer,
                    timing: elapsed,
                }]);
                return;
            }

            const intent = await model.infer(input, abortRef.current.signal);
            abortRef.current = null;

            const result = await executor.execute(intent);
            const elapsed = Math.round(performance.now() - startTime);
            setLastTiming(elapsed);
            setIsLoading(false);

            setMessages(prev => [...prev, {
                role: 'assistant',
                content: result.message,
                taskOutput: result.taskOutput,
                timing: elapsed,
            }]);
            refreshTaskCount();
        } catch (err: unknown) {
            abortRef.current = null;
            setIsLoading(false);

            const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
            if (!isAbort) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
                }]);
            }
        }
    }, [modelReady]);

    const refreshTaskCount = () => {
        if (ctxRef.current) {
            const counts = ctxRef.current.taskRepo.countByStatus();
            setTaskCount(Object.values(counts).reduce((a, b) => a + b, 0));
        }
    };

    const disabled = isLoading || !modelReady;

    return (
        <Box flexDirection="column">
            <Static items={messages}>
                {(msg, i) => (
                    <Box key={i} flexDirection="column">
                        <Message message={msg} />
                    </Box>
                )}
            </Static>

            {!modelReady && modelStatus && (
                <Box paddingX={1}>
                    <Text color={t.warning.ink}><Spinner type="dots" /></Text>
                    <Text color={t.muted.ink}> {modelStatus}</Text>
                </Box>
            )}

            {isLoading && (
                <Box paddingX={1}>
                    <Text color={t.accent.ink}><Spinner type="dots" /></Text>
                    <Text color={t.muted.ink}> Thinking... (Esc to cancel)</Text>
                </Box>
            )}

            <Box flexDirection="column" flexShrink={0}>
                <Text color={t.muted.ink}>{'─'.repeat(cols)}</Text>

                <Box paddingX={1} justifyContent="space-between">
                    <Text color={t.muted.ink}>todo-cli · {backendName || 'loading'} · {taskCount} tasks</Text>
                    {lastTiming !== undefined && <Text color={t.muted.ink}>{lastTiming}ms</Text>}
                </Box>

                <ChatInput onSubmit={handleSubmit} disabled={disabled} />

                <Text color={t.muted.ink}>{'─'.repeat(cols)}</Text>
            </Box>
        </Box>
    );
}

export function ChatApp() {
    // Ensure theme is loaded when the TUI mounts — guards against cases where
    // preAction didn't run (e.g. direct import in tests).
    loadTheme(getConfig('theme') as string);

    return (
        <ThemeProvider value={theme()}>
            <ChatAppInner />
        </ThemeProvider>
    );
}
