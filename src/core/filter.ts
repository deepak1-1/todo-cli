// ============================================================
// Filter engine — case-insensitive search across task fields
// ============================================================

import type { TaskWithRelations, SearchResult } from './types.js';

/** Search tasks by case-insensitive substring match across title, description, tags, and project */
export function fuzzySearch(tasks: TaskWithRelations[], query: string): SearchResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;

    return tasks.reduce<SearchResult[]>((matched, t) => {
        const fields: string[] = [];
        if (t.title.toLowerCase().includes(q)) fields.push('title');
        if (t.description && t.description.toLowerCase().includes(q)) fields.push('desc');
        if (t.tagNames && t.tagNames.some(tag => tag.toLowerCase().includes(q))) fields.push('tags');
        if (t.projectName && t.projectName.toLowerCase().includes(q)) fields.push('project');

        if (fields.length > 0) {
            matched.push({ ...t, _matchedIn: fields });
        }
        return matched;
    }, []);
}
