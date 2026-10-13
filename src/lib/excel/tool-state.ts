// ── Tool toggle state machine (pure, isomorphic, unit-testable) ──────────────
import type { ToolDef } from "./types";
import { TOOLS, AUTOFIX_TOOLS } from "./transform";

export interface ToolState {
  id: string;
  /** currently selected by the user */
  enabled: boolean;
  /** true when the analysis produced findings this tool addresses */
  available: boolean;
  /** the tool's factory default */
  defaultOn: boolean;
  /** findings count driving `available` */
  findings: number;
  def: ToolDef;
}

/**
 * Compute toggle states from tool definitions + per-tool finding counts.
 * Rules:
 *  - available  = findings > 0
 *  - defaultOn  = tool.safeDefault
 *  - enabled    = previous user choice if present, else (autoFix && available)
 */
export function computeToolStates(
  findingsByTool: Map<string, number>,
  previous?: Map<string, boolean>
): ToolState[] {
  return TOOLS.map((def) => {
    const findings = findingsByTool.get(def.id) ?? 0;
    const available = findings > 0;
    const prev = previous?.get(def.id);
    const enabled = prev !== undefined ? prev : AUTOFIX_TOOLS.includes(def.id) && available;
    return { id: def.id, enabled, available, defaultOn: def.safeDefault, findings, def };
  });
}

/** Toggle one tool. Unavailable tools cannot be enabled (no-op). */
export function toggleTool(states: ToolState[], id: string): ToolState[] {
  return states.map((s) => {
    if (s.id !== id) return s;
    if (!s.available) return s; // disabled toggle — ignore clicks
    return { ...s, enabled: !s.enabled };
  });
}

/** Enable exactly the Auto-Fix set, restricted to available tools. */
export function autoFixSelection(states: ToolState[]): ToolState[] {
  return states.map((s) => ({
    ...s,
    enabled: AUTOFIX_TOOLS.includes(s.id) && s.available,
  }));
}

/** The exact payload the preview endpoint receives — enabled tools only. */
export function enabledToolIds(states: ToolState[]): string[] {
  return states.filter((s) => s.enabled && s.available).map((s) => s.id);
}

/** Reconcile after new findings arrive: keep user choices where still valid. */
export function reconcile(states: ToolState[], findingsByTool: Map<string, number>): ToolState[] {
  const prev = new Map(states.map((s) => [s.id, s.enabled] as const));
  return computeToolStates(findingsByTool, prev).map((s) => ({
    ...s,
    enabled: s.available ? s.enabled : false,
  }));
}
