// ============================================================
// Project entity operations — pure logic, zero I/O
// ============================================================

import type { CreateProjectInput, UpdateProjectInput } from './types.js';

export class ProjectValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProjectValidationError';
    }
}

// Accept 7-char hex strings or 'white' (legacy sentinel); palette name validation happens at CLI layer.
function isValidColor(color: string): boolean {
    return color === 'white' || /^#[0-9a-fA-F]{6}$/.test(color);
}

export function validateCreateProjectInput(input: CreateProjectInput): CreateProjectInput {
    if (!input.name || input.name.trim().length === 0) {
        throw new ProjectValidationError('Project name cannot be empty');
    }

    const normalized: CreateProjectInput = {
        ...input,
        name: input.name.trim(),
        description: input.description?.trim() || '',
    };

    if (normalized.color && !isValidColor(normalized.color)) {
        throw new ProjectValidationError(
            `Invalid color "${normalized.color}". Provide a hex color like #8b5cf6.`,
        );
    }

    return normalized;
}

export function validateUpdateProjectInput(input: UpdateProjectInput): UpdateProjectInput {
    if (input.name !== undefined && input.name.trim().length === 0) {
        throw new ProjectValidationError('Project name cannot be empty');
    }

    const normalized: UpdateProjectInput = { ...input };
    if (normalized.name) normalized.name = normalized.name.trim();
    if (normalized.description !== undefined) normalized.description = normalized.description.trim();

    if (normalized.color && !isValidColor(normalized.color)) {
        throw new ProjectValidationError(
            `Invalid color "${normalized.color}". Provide a hex color like #8b5cf6.`,
        );
    }

    return normalized;
}