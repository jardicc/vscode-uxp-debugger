export type CdpPayload<T> = Partial<T> & Record<string, unknown>;

/** Tolerant CDP envelope for parsed, runtime-untrusted UXP protocol messages. */
export interface CdpMessage {
    [key: string]: unknown;
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: {
        code?: number;
        message?: string;
        data?: unknown;
    };
}
