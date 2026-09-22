/**
 * Thin wrapper around the webview's `acquireVsCodeApi()` — typed dispatch of
 * `PanelAction` messages plus persisted UI state (collapse/scroll).
 */

import type { FromWebviewMessage, PanelAction } from "../panelProtocol";

export interface PersistedUiState {
    collapsed?: { apps?: boolean; plugins?: boolean; scripts?: boolean };
}

interface VsCodeWebviewApi {
    postMessage(message: FromWebviewMessage): void;
    getState(): PersistedUiState | undefined;
    setState(state: PersistedUiState): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;

const api = acquireVsCodeApi();

export function dispatch(action: PanelAction): void {
    api.postMessage({ type: "panelAction", action });
}

export function getUiState(): PersistedUiState {
    return api.getState() ?? {};
}

export function saveUiState(patch: Partial<PersistedUiState>): void {
    api.setState({ ...getUiState(), ...patch });
}
