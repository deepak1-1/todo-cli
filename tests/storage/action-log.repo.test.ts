import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { up as migration001 } from '../../src/storage/migrations/001-initial.js';
import { up as migration002 } from '../../src/storage/migrations/002-time-tracking.js';
import { ActionLogRepository } from '../../src/storage/repositories/action-log.repo.js';

let db: Database.Database;
let actionLogRepo: ActionLogRepository;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migration001(db);
    migration002(db);
    actionLogRepo = new ActionLogRepository(db);
});

describe('ActionLogRepository', () => {
    describe('log()', () => {
        it('should store an action and return the created entry', () => {
            const entry = actionLogRepo.log({
                taskId: 1,
                action: 'update',
                entityType: 'task',
                prevState: JSON.stringify({ status: 'pending' }),
                newState: JSON.stringify({ status: 'done' }),
            });

            expect(entry.id).toBe(1);
            expect(entry.taskId).toBe(1);
            expect(entry.action).toBe('update');
            expect(entry.entityType).toBe('task');
            expect(entry.prevState).toBe(JSON.stringify({ status: 'pending' }));
            expect(entry.newState).toBe(JSON.stringify({ status: 'done' }));
            expect(entry.timestamp).toBeTruthy();
        });

        it('should handle null prevState', () => {
            const entry = actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: JSON.stringify({ title: 'New task' }),
            });

            expect(entry.prevState).toBeNull();
            expect(entry.newState).toBe(JSON.stringify({ title: 'New task' }));
        });

        it('should handle null newState', () => {
            const entry = actionLogRepo.log({
                taskId: 1,
                action: 'delete',
                entityType: 'task',
                prevState: JSON.stringify({ title: 'Deleted task' }),
                newState: null,
            });

            expect(entry.prevState).toBe(JSON.stringify({ title: 'Deleted task' }));
            expect(entry.newState).toBeNull();
        });

        it('should handle both states being null', () => {
            const entry = actionLogRepo.log({
                taskId: null,
                action: 'purge',
                entityType: 'task',
                prevState: null,
                newState: null,
            });

            expect(entry.prevState).toBeNull();
            expect(entry.newState).toBeNull();
            expect(entry.taskId).toBeNull();
        });

        it('should auto-increment ids', () => {
            const e1 = actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });
            const e2 = actionLogRepo.log({
                taskId: 2,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });

            expect(e2.id).toBe(e1.id + 1);
        });
    });

    describe('getLast()', () => {
        it('should return the most recent action', () => {
            actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{"title":"first"}',
            });
            actionLogRepo.log({
                taskId: 2,
                action: 'update',
                entityType: 'task',
                prevState: '{"status":"pending"}',
                newState: '{"status":"done"}',
            });

            const last = actionLogRepo.getLast();
            expect(last).not.toBeNull();
            expect(last!.taskId).toBe(2);
            expect(last!.action).toBe('update');
        });

        it('should return null when no actions exist', () => {
            const last = actionLogRepo.getLast();
            expect(last).toBeNull();
        });
    });

    describe('getByTaskId()', () => {
        it('should return actions for a specific task in descending order', () => {
            actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{"title":"task1"}',
            });
            actionLogRepo.log({
                taskId: 2,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{"title":"task2"}',
            });
            actionLogRepo.log({
                taskId: 1,
                action: 'update',
                entityType: 'task',
                prevState: '{"status":"pending"}',
                newState: '{"status":"done"}',
            });

            const history = actionLogRepo.getByTaskId(1);
            expect(history).toHaveLength(2);
            // Most recent first (DESC order)
            expect(history[0].action).toBe('update');
            expect(history[1].action).toBe('create');
        });

        it('should return empty array when task has no actions', () => {
            const history = actionLogRepo.getByTaskId(999);
            expect(history).toHaveLength(0);
        });
    });

    describe('getRecent()', () => {
        it('should return all actions in descending order', () => {
            actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });
            actionLogRepo.log({
                taskId: 2,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });
            actionLogRepo.log({
                taskId: 3,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });

            const all = actionLogRepo.getRecent();
            expect(all).toHaveLength(3);
            // Most recent first
            expect(all[0].taskId).toBe(3);
            expect(all[1].taskId).toBe(2);
            expect(all[2].taskId).toBe(1);
        });

        it('should respect limit parameter', () => {
            for (let i = 0; i < 5; i++) {
                actionLogRepo.log({
                    taskId: i + 1,
                    action: 'create',
                    entityType: 'task',
                    prevState: null,
                    newState: '{}',
                });
            }

            const limited = actionLogRepo.getRecent(2);
            expect(limited).toHaveLength(2);
            expect(limited[0].taskId).toBe(5);
            expect(limited[1].taskId).toBe(4);
        });

        it('should default to 20 items', () => {
            for (let i = 0; i < 25; i++) {
                actionLogRepo.log({
                    taskId: i + 1,
                    action: 'create',
                    entityType: 'task',
                    prevState: null,
                    newState: '{}',
                });
            }

            const recent = actionLogRepo.getRecent();
            expect(recent).toHaveLength(20);
        });
    });

    describe('deleteLast()', () => {
        it('should delete the most recent action', () => {
            actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });
            actionLogRepo.log({
                taskId: 2,
                action: 'update',
                entityType: 'task',
                prevState: '{}',
                newState: '{}',
            });

            const deleted = actionLogRepo.deleteLast();
            expect(deleted).toBe(true);

            const last = actionLogRepo.getLast();
            expect(last!.taskId).toBe(1);
        });

        it('should return false when no actions exist', () => {
            const deleted = actionLogRepo.deleteLast();
            expect(deleted).toBe(false);
        });
    });

    describe('prevState string retrieval and undo flow', () => {
        it('should store prevState as string and retrieve it correctly', () => {
            const prevStateObj = {
                id: 1,
                title: 'My task',
                status: 'pending',
                priority: 'medium',
            };
            const prevStateStr = JSON.stringify(prevStateObj);

            actionLogRepo.log({
                taskId: 1,
                action: 'update',
                entityType: 'task',
                prevState: prevStateStr,
                newState: JSON.stringify({ ...prevStateObj, status: 'done' }),
            });

            const entry = actionLogRepo.getLast();
            expect(entry).not.toBeNull();
            expect(entry!.prevState).toBe(prevStateStr);

            // Verify parsing back works correctly
            const parsed = JSON.parse(entry!.prevState!);
            expect(parsed.title).toBe('My task');
            expect(parsed.status).toBe('pending');
            expect(parsed.priority).toBe('medium');
        });

        it('should support full undo flow: log, retrieve, parse prevState', () => {
            // Simulate: task was "pending", user marks it "done"
            const originalTask = {
                id: 5,
                title: 'Finish report',
                status: 'pending',
                priority: 'high',
            };

            actionLogRepo.log({
                taskId: 5,
                action: 'status_change',
                entityType: 'task',
                prevState: JSON.stringify(originalTask),
                newState: JSON.stringify({ ...originalTask, status: 'done' }),
            });

            // Retrieve the last action for undo
            const lastAction = actionLogRepo.getLast();
            expect(lastAction).not.toBeNull();
            expect(lastAction!.action).toBe('status_change');

            // Parse the previous state to restore
            const restoredState = JSON.parse(lastAction!.prevState!);
            expect(restoredState.id).toBe(5);
            expect(restoredState.status).toBe('pending');
            expect(restoredState.title).toBe('Finish report');

            // Clean up after undo
            const deleted = actionLogRepo.deleteLast();
            expect(deleted).toBe(true);
            expect(actionLogRepo.getLast()).toBeNull();
        });
    });

    describe('getById()', () => {
        it('should retrieve a specific action by id', () => {
            const entry = actionLogRepo.log({
                taskId: 1,
                action: 'create',
                entityType: 'task',
                prevState: null,
                newState: '{}',
            });

            const retrieved = actionLogRepo.getById(entry.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(entry.id);
            expect(retrieved!.action).toBe('create');
        });

        it('should return null for non-existent id', () => {
            const retrieved = actionLogRepo.getById(999);
            expect(retrieved).toBeNull();
        });
    });
});
