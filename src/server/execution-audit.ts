export type AgentAuditEngine = 'pi' | 'dsh';
export type AgentToolAuditOutcome = 'succeeded' | 'failed' | 'unconfirmed';

export interface AgentToolAuditCall {
  tool: string;
  action: string | null;
  outcome: AgentToolAuditOutcome;
}

export interface AgentExecutionAudit {
  engine: AgentAuditEngine;
  model: string;
  modelCompleted: boolean;
  calls: AgentToolAuditCall[];
  truncated: boolean;
}

const toolNames = new Set([
  'computer_browser', 'computer_desktop', 'computer_files', 'computer_terminal',
  'open_public_page', 'bot_memory', 'bot_handoff', 'bot_routines',
]);
const computerBrowserActions = new Set(['inspect', 'navigate', 'click', 'fill', 'select', 'check', 'uncheck', 'press', 'open_artifact']);
const computerDesktopActions = new Set(['screenshot', 'click', 'type', 'press']);
const computerFilesActions = new Set(['list', 'read']);
const computerTerminalActions = new Set(['run']);

export function validateAgentExecutionAudit(value: unknown): AgentExecutionAudit | null {
  let input = value;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return null; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const engine = row.engine;
  const model = row.model;
  const calls = row.calls;
  if ((engine !== 'pi' && engine !== 'dsh') || typeof model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(model)
      || typeof row.modelCompleted !== 'boolean' || !Array.isArray(calls) || calls.length > 64 || typeof row.truncated !== 'boolean') return null;
  const safeCalls: AgentToolAuditCall[] = [];
  for (const call of calls) {
    if (!call || typeof call !== 'object' || Array.isArray(call)) return null;
    const candidate = call as Record<string, unknown>;
    if (typeof candidate.tool !== 'string' || !toolNames.has(candidate.tool)
        || (candidate.outcome !== 'succeeded' && candidate.outcome !== 'failed' && candidate.outcome !== 'unconfirmed')) return null;
    let action: string | null = null;
    if (candidate.action !== null) {
      if (typeof candidate.action !== 'string') return null;
      const allowed = candidate.tool === 'computer_browser' ? computerBrowserActions
        : candidate.tool === 'computer_desktop' ? computerDesktopActions
        : candidate.tool === 'computer_files' ? computerFilesActions
        : candidate.tool === 'computer_terminal' ? computerTerminalActions
        : null;
      if (!allowed || !allowed.has(candidate.action)) return null;
      action = candidate.action;
    }
    safeCalls.push({ tool: candidate.tool, action, outcome: candidate.outcome });
  }
  return { engine, model, modelCompleted: row.modelCompleted, calls: safeCalls, truncated: row.truncated };
}
