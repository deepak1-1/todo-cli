// Message — single conversation message.

import { Box, Text } from 'ink';
import { useTheme } from '../theme-context.js';

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    taskOutput?: string;
    timing?: number;
}

interface MessageProps {
    message: ChatMessage;
}

export function Message({ message }: MessageProps) {
    const t = useTheme();

    if (message.role === 'user') {
        return (
            <Box>
                <Text bold color={t.prompt.ink}> {'›'} </Text>
                <Text>{message.content}</Text>
            </Box>
        );
    }

    if (message.role === 'system') {
        return (
            <Box paddingX={1}>
                <Text color={t.muted.ink} dimColor>{message.content}</Text>
            </Box>
        );
    }

    // Assistant message — always show full output.
    return (
        <Box flexDirection="column" paddingX={1}>
            {message.content && (
                <Box>
                    <Text color={t.accent.ink}>{'● '}</Text>
                    <Text color={t.accent.ink}>{message.content}</Text>
                </Box>
            )}
            {message.taskOutput && (
                <Box paddingLeft={2} flexDirection="column">
                    <Text>{message.taskOutput}</Text>
                </Box>
            )}
            {message.timing !== undefined && (
                <Box paddingLeft={2}>
                    <Text color={t.muted.ink} dimColor>[{message.timing}ms]</Text>
                </Box>
            )}
        </Box>
    );
}
