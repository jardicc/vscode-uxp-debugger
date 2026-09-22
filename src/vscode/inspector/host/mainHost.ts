// Ported from microsoft/vscode-edge-devtools (src/host/mainHost.ts).
// Copyright (c) Microsoft Corporation. Licensed under the MIT License.
//
// Entry point of the webview host bundle (dist/inspectorHost.js).

import { MessageRouter } from "./messageRouter";

export const messageRouter = new MessageRouter(window);
