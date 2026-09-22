export interface DapVariable {
    name?: unknown;
    value?: unknown;
    type?: unknown;
    evaluateName?: unknown;
    variablesReference?: unknown;
    namedVariables?: unknown;
    indexedVariables?: unknown;
}

export interface DapScope {
    name?: unknown;
    presentationHint?: unknown;
    variablesReference?: unknown;
    namedVariables?: unknown;
    indexedVariables?: unknown;
    expensive?: unknown;
}

export interface VariableSummary {
    name: string;
    value: string;
    type?: string;
    evaluateName?: string;
    variablesReference: number;
    namedVariables?: number;
    indexedVariables?: number;
}

function displayString(value: unknown): string {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";
}

export function toVariableSummary(variable: DapVariable): VariableSummary {
    return {
        name: displayString(variable.name),
        value: displayString(variable.value),
        ...(typeof variable.type === "string" ? { type: variable.type } : {}),
        ...(typeof variable.evaluateName === "string" ? { evaluateName: variable.evaluateName } : {}),
        variablesReference: typeof variable.variablesReference === "number" ? variable.variablesReference : 0,
        ...(typeof variable.namedVariables === "number" ? { namedVariables: variable.namedVariables } : {}),
        ...(typeof variable.indexedVariables === "number" ? { indexedVariables: variable.indexedVariables } : {}),
    };
}

export function scopeSortRank(scope: DapScope): number {
    switch (scope.presentationHint) {
        case "locals": return 0;
        case "arguments": return 1;
        case "registers": return 3;
        default: return 2;
    }
}

export function positiveInteger(value: number | undefined, fallback: number): number | undefined {
    const resolved = value ?? fallback;
    return Number.isInteger(resolved) && resolved > 0 ? resolved : undefined;
}
