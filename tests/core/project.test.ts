import { describe, it, expect } from 'vitest';
import {
    validateCreateProjectInput,
    validateUpdateProjectInput,
    ProjectValidationError,
} from '../../src/core/project.js';

describe('validateCreateProjectInput', () => {
    it('should accept valid input with name only', () => {
        const result = validateCreateProjectInput({ name: 'My Project' });
        expect(result.name).toBe('My Project');
        expect(result.description).toBe('');
        expect(result.color).toBeUndefined(); // auto-assigned by repo
    });

    it('should accept valid input with all fields', () => {
        const result = validateCreateProjectInput({
            name: 'My Project',
            description: 'A description',
            color: '#3b82f6',
        });
        expect(result.name).toBe('My Project');
        expect(result.description).toBe('A description');
        expect(result.color).toBe('#3b82f6');
    });

    it('should trim name and description', () => {
        const result = validateCreateProjectInput({
            name: '  Trimmed  ',
            description: '  Some desc  ',
        });
        expect(result.name).toBe('Trimmed');
        expect(result.description).toBe('Some desc');
    });

    it('should throw on empty name', () => {
        expect(() => validateCreateProjectInput({ name: '' })).toThrow(ProjectValidationError);
        expect(() => validateCreateProjectInput({ name: '' })).toThrow('Project name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
        expect(() => validateCreateProjectInput({ name: '   ' })).toThrow(ProjectValidationError);
        expect(() => validateCreateProjectInput({ name: '   ' })).toThrow('Project name cannot be empty');
    });

    it('should throw on invalid color', () => {
        expect(() => validateCreateProjectInput({ name: 'Test', color: 'rainbow' })).toThrow(
            ProjectValidationError,
        );
        expect(() => validateCreateProjectInput({ name: 'Test', color: 'rainbow' })).toThrow(
            'Invalid color',
        );
    });

    it('should accept valid hex colors', () => {
        const validColors = ['#0ea5e9', '#14b8a6', '#ffffff', '#000000'];
        for (const color of validColors) {
            const result = validateCreateProjectInput({ name: 'Test', color });
            expect(result.color).toBe(color);
        }
    });

    it('should accept white as legacy sentinel', () => {
        const result = validateCreateProjectInput({ name: 'Test', color: 'white' });
        expect(result.color).toBe('white');
    });

    it('should leave color undefined when not provided (repo assigns auto-color)', () => {
        const result = validateCreateProjectInput({ name: 'Test' });
        expect(result.color).toBeUndefined();
    });
});

describe('validateUpdateProjectInput', () => {
    it('should accept valid partial update with name', () => {
        const result = validateUpdateProjectInput({ name: 'Updated Name' });
        expect(result.name).toBe('Updated Name');
    });

    it('should accept valid partial update with description only', () => {
        const result = validateUpdateProjectInput({ description: 'New description' });
        expect(result.description).toBe('New description');
    });

    it('should accept valid partial update with color only', () => {
        const result = validateUpdateProjectInput({ color: '#fb4934' });
        expect(result.color).toBe('#fb4934');
    });

    it('should trim name and description', () => {
        const result = validateUpdateProjectInput({
            name: '  Trimmed  ',
            description: '  Trimmed desc  ',
        });
        expect(result.name).toBe('Trimmed');
        expect(result.description).toBe('Trimmed desc');
    });

    it('should throw on empty name (explicit empty string)', () => {
        expect(() => validateUpdateProjectInput({ name: '' })).toThrow(ProjectValidationError);
        expect(() => validateUpdateProjectInput({ name: '' })).toThrow('Project name cannot be empty');
    });

    it('should throw on whitespace-only name', () => {
        expect(() => validateUpdateProjectInput({ name: '   ' })).toThrow(ProjectValidationError);
    });

    it('should allow undefined name (no update to name)', () => {
        const result = validateUpdateProjectInput({ description: 'Only desc' });
        expect(result.name).toBeUndefined();
    });

    it('should throw on invalid color', () => {
        expect(() => validateUpdateProjectInput({ color: 'neon' })).toThrow(ProjectValidationError);
        expect(() => validateUpdateProjectInput({ color: 'neon' })).toThrow('Invalid color');
    });

    it('should accept empty object (no-op update)', () => {
        const result = validateUpdateProjectInput({});
        expect(result).toEqual({});
    });
});
