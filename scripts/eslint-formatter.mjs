import path from "node:path";

export default function format(results, context) {
  const lines = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const result of results) {
    if (result.messages.length === 0) {
      continue;
    }

    lines.push(path.relative(context.cwd, result.filePath));
    for (const message of result.messages) {
      const severity = message.severity === 2 ? "error" : "warning";
      const rule = message.ruleId ? `  ${message.ruleId}` : "";
      lines.push(`  ${message.line}:${message.column}  ${severity}  ${message.message}${rule}`);
      errorCount += message.severity === 2 ? 1 : 0;
      warningCount += message.severity === 1 ? 1 : 0;
    }
    lines.push("");
  }

  if (errorCount > 0 || warningCount > 0) {
    lines.push(`${errorCount} error(s), ${warningCount} warning(s)`);
  }
  lines.push(`Checked ${results.length} file(s).`);

  return lines.join("\n");
}