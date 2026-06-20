// Generic row-to-domain mapper factory — eliminates per-repo mapRow duplication.

// One entry in the spec: source column name, optional transform, optional default.
export interface FieldSpec<TRow, TValue> {
    // Column key on the raw DB row.
    col: keyof TRow & string;
    // Transform applied to the raw column value before assignment.
    transform?: (v: TRow[keyof TRow & string]) => TValue;
    // Fallback when the raw value is null or undefined.
    defaultValue?: TValue;
}

// Full mapper spec: maps each domain key to a FieldSpec.
export type MapperSpec<TRow, T> = {
    [K in keyof T]: FieldSpec<TRow, T[K]>;
};

// Returns a function that maps a typed DB row to the domain object T.
export function makeMapper<TRow extends object, T>(spec: MapperSpec<TRow, T>): (row: TRow) => T {
    return (row: TRow): T => {
        const result = {} as T;
        for (const key in spec) {
            const field = spec[key];
            const raw = row[field.col as keyof TRow];
            if (field.transform !== undefined) {
                (result as Record<string, unknown>)[key] = field.transform(raw as TRow[keyof TRow & string]);
            } else if (raw === null || raw === undefined) {
                (result as Record<string, unknown>)[key] = field.defaultValue ?? null;
            } else {
                (result as Record<string, unknown>)[key] = raw;
            }
        }
        return result;
    };
}

// Common transforms for reuse across repos.

// Converts SQLite integer 0/1 to boolean.
export function boolFromInt(n: unknown): boolean {
    return n === 1;
}

// Returns the string value or empty string when falsy.
export function stringOrEmpty(v: unknown): string {
    return (v as string) || '';
}

// Splits a comma-separated string into an array, filtering empty strings.
export function csvToArray(s: unknown): string[] {
    return s ? (s as string).split(',').filter(Boolean) : [];
}

// Passes the value through, preserving null (identity for nullable fields).
export function nullable<T>(v: unknown): T | null {
    return (v as T | null) ?? null;
}
