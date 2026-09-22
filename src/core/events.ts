/**
 * Minimal typed event emitter — dependency-free and `vscode`-free so the core
 * layer can be unit-tested in plain Node. The VS Code layer adapts these to
 * `vscode.EventEmitter` in exactly one place (`UxpService`).
 */

export type Listener<T> = (event: T) => void;

export class TypedEvent<T> {
    private listeners = new Set<Listener<T>>();

    /** Subscribe. Returns an unsubscribe function. */
    on(listener: Listener<T>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(event: T): void {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch {
                // Listeners must not break the emitter or each other.
            }
        }
    }

    removeAll(): void {
        this.listeners.clear();
    }
}
