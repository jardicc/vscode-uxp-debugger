import type { DebugProtocol } from "@vscode/debugprotocol";

declare module "vscode" {
    interface DebugSession {
        customRequest(command: "threads"): Thenable<{ threads?: Partial<DebugProtocol.Thread>[] }>;
        customRequest(
            command: "stackTrace",
            args: DebugProtocol.StackTraceArguments,
        ): Thenable<DebugProtocol.StackTraceResponse["body"]>;
        customRequest(
            command: "scopes",
            args: DebugProtocol.ScopesArguments,
        ): Thenable<DebugProtocol.ScopesResponse["body"]>;
        customRequest(
            command: "variables",
            args: DebugProtocol.VariablesArguments,
        ): Thenable<DebugProtocol.VariablesResponse["body"]>;
        customRequest(
            command: "evaluate",
            args: DebugProtocol.EvaluateArguments,
        ): Thenable<DebugProtocol.EvaluateResponse["body"]>;
        customRequest(
            command: "continue",
            args: DebugProtocol.ContinueArguments,
        ): Thenable<DebugProtocol.ContinueResponse["body"]>;
    }
}
