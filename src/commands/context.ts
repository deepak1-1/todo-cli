// ============================================================
// Shared CLI context — initializes DB and repos for commands
// ============================================================

import { getDb } from '../storage/database.js';
import { runMigrations } from '../storage/migrations/runner.js';
import { backfillProjectColors } from '../storage/backfill.js';
import { TaskRepository } from '../storage/repositories/task.repo.js';
import { ProjectRepository } from '../storage/repositories/project.repo.js';
import { TagRepository } from '../storage/repositories/tag.repo.js';
import { TimerRepository } from '../storage/repositories/timer.repo.js';
import { ActionLogRepository } from '../storage/repositories/action-log.repo.js';
import { DependencyRepository } from '../storage/repositories/dependency.repo.js';
import { TrackingRepository } from '../storage/repositories/tracking.repo.js';
import { StatusRepository } from '../storage/repositories/status.repo.js';

export interface AppContext {
    taskRepo: TaskRepository;
    projectRepo: ProjectRepository;
    tagRepo: TagRepository;
    timerRepo: TimerRepository;
    actionLog: ActionLogRepository;
    depRepo: DependencyRepository;
    trackingRepo: TrackingRepository;
    statusRepo: StatusRepository;
}

let ctx: AppContext | null = null;

/** Initialize the app context (DB + repos), runs migrations */
export function getContext(): AppContext {
    if (ctx) return ctx;

    const db = getDb();
    runMigrations(db);
    backfillProjectColors(db);

    ctx = {
        taskRepo: new TaskRepository(db),
        projectRepo: new ProjectRepository(db),
        tagRepo: new TagRepository(db),
        timerRepo: new TimerRepository(db),
        actionLog: new ActionLogRepository(db),
        depRepo: new DependencyRepository(db),
        trackingRepo: new TrackingRepository(db),
        statusRepo: new StatusRepository(db),
    };

    return ctx;
}
