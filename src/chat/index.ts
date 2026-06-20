// ============================================================
// Chat mode entry point — launches Ink-based chat UI
// ============================================================

export async function startChat(): Promise<void> {
    const React = await import('react');
    const { render } = await import('ink');
    const { ChatApp } = await import('./components/ChatApp.js');

    const instance = render(React.createElement(ChatApp));
    await instance.waitUntilExit();
}
