import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { up } from '../../src/storage/migrations/001-initial.js';
import { up as migration002 } from '../../src/storage/migrations/002-time-tracking.js';
import { ProjectRepository } from '../../src/storage/repositories/project.repo.js';
import { PROJECT_PALETTE } from '../../src/utils/project-color.js';

let db: Database.Database;
let projectRepo: ProjectRepository;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    migration002(db);
    projectRepo = new ProjectRepository(db);
});

describe('ProjectRepository.create — auto color assignment', () => {
    it('assigns sky (#0ea5e9) as first auto-color when no color given', () => {
        const project = projectRepo.create({ name: 'Alpha' });
        expect(project.color).toBe('#0ea5e9');
    });

    it('assigns next unused palette color on second project', () => {
        const p1 = projectRepo.create({ name: 'Alpha' });
        const p2 = projectRepo.create({ name: 'Beta' });
        expect(p1.color).toBe('#0ea5e9'); // sky
        expect(p2.color).toBe('#8b5cf6'); // violet
    });

    it('respects an explicitly provided hex color', () => {
        const project = projectRepo.create({ name: 'Explicit', color: '#fabd2f' });
        expect(project.color).toBe('#fabd2f');
    });

    it('creates 17 projects and 17th gets a hash-derived palette hex', () => {
        const created = [];
        for (let i = 0; i < 17; i++) {
            created.push(projectRepo.create({ name: `Project-${i}` }));
        }
        // First 16 should each be a distinct palette entry
        const first16 = created.slice(0, 16).map(p => p.color);
        const paletteHexes = PROJECT_PALETTE.map(p => p.hex);
        for (const hex of first16) {
            expect(paletteHexes).toContain(hex);
        }
        // 17th should also be a palette hex (hash fallback)
        expect(paletteHexes).toContain(created[16].color);
        // First 16 are all distinct
        expect(new Set(first16).size).toBe(16);
    });
});
