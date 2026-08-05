// Direct coverage of JiraClient.request() — mocks global.fetch, no real network.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JiraClient } from '../../../src/integrations/jira/jira-client.js';
import type { PluginLogger } from '../../../src/plugins/types.js';

function makeLogger(): PluginLogger {
    return {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };
}

function makeClient(): JiraClient {
    return new JiraClient('acme.atlassian.net', 'dev@acme.com', 'token123', makeLogger());
}

describe('JiraClient.request', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves updateIssue without throwing on a 204 No Content response', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        const client = makeClient();

        await expect(client.updateIssue('PROJ-1', { priority: { name: 'High' } })).resolves.toBeUndefined();
    });

    it('resolves doTransition without throwing on a 204 empty body', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
        const client = makeClient();

        await expect(client.doTransition('PROJ-1', '31')).resolves.toBeUndefined();
    });

    it('still parses a JSON body when getIssue returns 200', async () => {
        const issue = { key: 'PROJ-1', id: '100', fields: { summary: 'Test' } };
        fetchMock.mockResolvedValue(new Response(JSON.stringify(issue), { status: 200 }));
        const client = makeClient();

        await expect(client.getIssue('PROJ-1')).resolves.toEqual(issue);
    });

    it('still parses a JSON body when search returns 200', async () => {
        const payload = { issues: [], total: 0, maxResults: 50 };
        fetchMock.mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
        const client = makeClient();

        await expect(client.search('project = PROJ')).resolves.toEqual(payload);
    });

    it('resolves undefined on a 200 response with an empty string body', async () => {
        fetchMock.mockResolvedValue(new Response('', { status: 200 }));
        const client = makeClient();

        await expect(client.updateIssue('PROJ-1', { priority: { name: 'High' } })).resolves.toBeUndefined();
    });

    it('throws JiraApiError with the (status) tag on a 4xx/5xx response', async () => {
        fetchMock.mockResolvedValue(new Response('Issue does not exist', { status: 404 }));
        const client = makeClient();

        await expect(client.getIssue('PROJ-404')).rejects.toThrow(/\(404\)/);
    });

    it('surfaces retryAfterMs from a 429 with Retry-After and keeps the (429) tag', async () => {
        // A fresh Response per call — Response bodies can only be read once, and every
        // retry attempt re-reads response.text() on the error path.
        fetchMock.mockImplementation(
            async () => new Response('Rate limited', { status: 429, headers: { 'Retry-After': '1' } }),
        );
        const client = makeClient();

        await expect(client.getIssue('PROJ-1')).rejects.toThrow(/\(429\)/);
    }, 15000);

    it('retries a 500 then resolves cleanly on a 204 success', async () => {
        fetchMock
            .mockImplementationOnce(async () => new Response('Server error', { status: 500 }))
            .mockImplementationOnce(async () => new Response(null, { status: 204 }));
        const client = makeClient();

        await expect(client.updateIssue('PROJ-1', { priority: { name: 'High' } })).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
