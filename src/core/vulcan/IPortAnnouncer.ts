/**
 * Port announcement seam. The broker depends on this interface only, so the
 * whole broker test suite runs with a no-op fake — the real Vulcan native
 * addon is touched exclusively by {@link VulcanAnnouncer}.
 */
export interface IPortAnnouncer {
    /** Broadcast "UDT service is running at <port>" over Vulcan IPC. */
    announce(port: number): void;
    /** Broadcast that the service stopped. */
    withdraw(port: number): void;
    /** Release native resources. Safe to call multiple times. */
    dispose(): void;
}

/** No-op announcer for tests. Records calls for assertions. */
export class NullAnnouncer implements IPortAnnouncer {
    readonly announced: number[] = [];
    readonly withdrawn: number[] = [];
    disposed = false;

    announce(port: number): void {
        this.announced.push(port);
    }

    withdraw(port: number): void {
        this.withdrawn.push(port);
    }

    dispose(): void {
        this.disposed = true;
    }
}
