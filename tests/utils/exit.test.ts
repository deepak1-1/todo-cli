import { describe, it, expect, vi, afterEach } from 'vitest';
import { fail, EXIT, requireEntity } from '../../src/utils/exit.js';

afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
});

describe('EXIT constants', () => {
    it('has the expected numeric values', () => {
        expect(EXIT.OK).toBe(0);
        expect(EXIT.GENERIC).toBe(1);
        expect(EXIT.USAGE).toBe(2);
        expect(EXIT.NOT_FOUND).toBe(3);
        expect(EXIT.INVALID_TRANSITION).toBe(4);
        expect(EXIT.CONFIG_ERROR).toBe(5);
    });
});

describe('fail()', () => {
    it('sets process.exitCode and writes to stderr', () => {
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.NOT_FOUND, 'task not found');

        expect(process.exitCode).toBe(3);
        // console.error is called (by the error() formatter)
        expect(consoleSpy).toHaveBeenCalledOnce();
        const callArg = consoleSpy.mock.calls[0][0] as string;
        expect(callArg).toContain('task not found');
        spy.mockRestore();
    });

    it('sets process.exitCode = 3 for NOT_FOUND', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.NOT_FOUND, 'x');

        expect(process.exitCode).toBe(3);
    });

    it('with json:true writes JSON to stdout and sets exitCode', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.NOT_FOUND, 'x', { json: true });

        expect(process.exitCode).toBe(3);
        expect(stdoutSpy).toHaveBeenCalledOnce();
        const written = stdoutSpy.mock.calls[0][0] as string;
        const parsed = JSON.parse(written.trim());
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toEqual({ code: 3, message: 'x' });
        // stderr must NOT have been called
        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('with json:true does not write to stderr', () => {
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.GENERIC, 'something went wrong', { json: true });

        expect(stderrSpy).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
    });

    it('without json option writes error to stderr not stdout', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.USAGE, 'bad input');

        expect(process.exitCode).toBe(2);
        expect(stderrSpy).toHaveBeenCalledOnce();
        expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('sets process.exitCode correctly for each EXIT code', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        fail(EXIT.OK, 'ok'); expect(process.exitCode).toBe(0); process.exitCode = 0;
        fail(EXIT.GENERIC, 'err'); expect(process.exitCode).toBe(1); process.exitCode = 0;
        fail(EXIT.USAGE, 'usage'); expect(process.exitCode).toBe(2); process.exitCode = 0;
        fail(EXIT.NOT_FOUND, 'nf'); expect(process.exitCode).toBe(3); process.exitCode = 0;
        fail(EXIT.INVALID_TRANSITION, 'it'); expect(process.exitCode).toBe(4); process.exitCode = 0;
        fail(EXIT.CONFIG_ERROR, 'cfg'); expect(process.exitCode).toBe(5); process.exitCode = 0;
    });
});

describe('requireEntity()', () => {
    it('returns true when entity is truthy', () => {
        const obj = { id: 1 };
        const result = requireEntity(obj, 'Task', '#1');
        expect(result).toBe(true);
        expect(process.exitCode).toBe(0);
    });

    it('returns false and sets exitCode = 3 when entity is null', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const result = requireEntity(null, 'Task', '#5');
        expect(result).toBe(false);
        expect(process.exitCode).toBe(3);
    });

    it('returns false and sets exitCode = 3 when entity is undefined', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const result = requireEntity(undefined, 'Project', '"foo"');
        expect(result).toBe(false);
        expect(process.exitCode).toBe(3);
    });

    it('prints "Task #5 not found" to stderr when task is null', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        requireEntity(null, 'Task', '#5');
        expect(consoleSpy).toHaveBeenCalledOnce();
        expect(consoleSpy.mock.calls[0][0]).toContain('Task #5 not found');
    });

    it('prints "Project \\"foo\\" not found" to stderr when project is null', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        requireEntity(null, 'Project', '"foo"');
        expect(consoleSpy).toHaveBeenCalledOnce();
        expect(consoleSpy.mock.calls[0][0]).toContain('Project "foo" not found');
    });

    it('with json:true writes JSON to stdout instead of stderr', () => {
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const result = requireEntity(null, 'Session', '#10', { json: true });

        expect(result).toBe(false);
        expect(process.exitCode).toBe(3);
        expect(stdoutSpy).toHaveBeenCalledOnce();
        const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toEqual({ code: 3, message: 'Session #10 not found' });
        expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('narrows type to non-null when returning true', () => {
        // Compile-time check: result is narrowed to { id: number } (not null)
        const entity: { id: number } | null = { id: 42 };
        if (requireEntity(entity, 'Task', '#42')) {
            // entity.id is accessible without null check here
            expect(entity.id).toBe(42);
        }
    });
});
