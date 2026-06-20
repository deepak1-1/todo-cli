import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { up } from '../../src/storage/migrations/001-initial.js';
import { up as migration002 } from '../../src/storage/migrations/002-time-tracking.js';
import { backfillProjectColors } from '../../src/storage/backfill.js';
import { PROJECT_PALETTE } from '../../src/utils/project-color.js';

let db: Database.Database;

beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    up(db);
    migration002(db);
});

function insertLegacyProject(name: string, color: string | null = 'white'): void {
    db.prepare(
        "INSERT INTO projects (name, description, color) VALUES (?, '', ?)",
    ).run(name, color);
}

describe('backfillProjectColors', () => {
    it('assigns distinct palette hexes to projects with white color', () => {
        insertLegacyProject('Alpha', 'white');
        insertLegacyProject('Beta', 'white');
        insertLegacyProject('Gamma', 'white');

        backfillProjectColors(db);

        const rows = db.prepare('SELECT name, color FROM projects ORDER BY id').all() as { name: string; color: string }[];
        expect(rows).toHaveLength(3);

        const paletteHexes = PROJECT_PALETTE.map(p => p.hex);
        for (const row of rows) {
            expect(paletteHexes).toContain(row.color);
        }
        // All distinct
        const colors = rows.map(r => r.color);
        expect(new Set(colors).size).toBe(3);
    });

    it('assigns palette hexes to projects with NULL color', () => {
        insertLegacyProject('NullColor', null);
        backfillProjectColors(db);

        const row = db.prepare("SELECT color FROM projects WHERE name = 'NullColor'").get() as { color: string };
        expect(row.color).toBe('#0ea5e9');
    });

    it('does not change already-colored projects', () => {
        db.prepare("INSERT INTO projects (name, description, color) VALUES (?, '', ?)").run('Colored', '#fabd2f');
        insertLegacyProject('Stale', 'white');

        backfillProjectColors(db);

        const colored = db.prepare("SELECT color FROM projects WHERE name = 'Colored'").get() as { color: string };
        expect(colored.color).toBe('#fabd2f'); // unchanged
    });

    it('skips already-used palette hexes when assigning', () => {
        db.prepare("INSERT INTO projects (name, description, color) VALUES (?, '', ?)").run('Existing', '#0ea5e9');
        insertLegacyProject('Stale', 'white');

        backfillProjectColors(db);

        const stale = db.prepare("SELECT color FROM projects WHERE name = 'Stale'").get() as { color: string };
        // sky (#0ea5e9) is already used — so next should be violet
        expect(stale.color).toBe('#8b5cf6');
    });

    it('is idempotent — second run makes no changes', () => {
        insertLegacyProject('Alpha', 'white');
        backfillProjectColors(db);

        const afterFirst = db.prepare('SELECT color FROM projects').all() as { color: string }[];
        backfillProjectColors(db);
        const afterSecond = db.prepare('SELECT color FROM projects').all() as { color: string }[];

        expect(afterFirst).toEqual(afterSecond);
    });

    it('returns early when no stale projects exist', () => {
        db.prepare("INSERT INTO projects (name, description, color) VALUES (?, '', '#0ea5e9')").run('HasColor');
        // Should not throw
        expect(() => backfillProjectColors(db)).not.toThrow();
    });
});
