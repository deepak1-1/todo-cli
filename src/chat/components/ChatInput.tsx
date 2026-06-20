// ChatInput — custom text input with natural line wrapping.
// Replaces ink-text-input which is single-line only.

import { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useTheme } from '../theme-context.js';

interface ChatInputProps {
    onSubmit: (value: string) => void;
    disabled: boolean;
}

export function ChatInput({ onSubmit, disabled }: ChatInputProps) {
    const t = useTheme();
    const [value, setValue] = useState('');
    useStdout();

    useInput((input, key) => {
        if (disabled) return;

        if (key.return) {
            const trimmed = value.trim();
            if (trimmed) {
                onSubmit(trimmed);
                setValue('');
            }
            return;
        }

        if (key.backspace || key.delete) {
            setValue(prev => prev.slice(0, -1));
            return;
        }

        // Ctrl+U — clear line.
        if (key.ctrl && input === 'u') {
            setValue('');
            return;
        }

        // Ctrl+W — delete last word.
        if (key.ctrl && input === 'w') {
            setValue(prev => prev.replace(/\s*\S+\s*$/, ''));
            return;
        }

        if (input && !key.ctrl && !key.meta) {
            setValue(prev => prev + input);
        }
    }, { isActive: !disabled });

    const prompt = ' › ';
    const displayText = disabled ? 'waiting...' : (value || '');
    const cursorChar = disabled ? '' : '█';

    return (
        <Box flexDirection="column" flexShrink={0}>
            <Text>
                <Text bold color={disabled ? t.muted.ink : t.prompt.ink}>{prompt}</Text>
                <Text color={disabled ? t.muted.ink : 'white'}>{displayText}</Text>
                {!disabled && <Text color={t.cursor.ink}>{cursorChar}</Text>}
            </Text>
        </Box>
    );
}
