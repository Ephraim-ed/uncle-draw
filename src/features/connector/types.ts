/**
 * What Claude sends the connector (AI-2). Specs carry no coordinates: the
 * connector lays charts out itself.
 */

export type ChartKind = "flowchart" | "swimlanes" | "mindmap" | "orgchart" | "timeline" | "kanban";
export type NodeRole = "step" | "decision" | "terminal" | "note";

export interface ChartSpec {
  kind: ChartKind;
  /** Flowcharts only; down by default. */
  direction?: "down" | "right";
  title?: string;
  /** Swimlane rows or kanban columns, in order. */
  lanes?: string[];
  nodes: { id: string; label: string; role?: NodeRole; lane?: string }[];
  links: { from: string; to: string; label?: string; arrow?: boolean }[];
}

/** A problem with what Claude asked for; the message goes back to Claude as is. */
export class ConnectorError extends Error {
  override name = "ConnectorError";
}

export const LIMITS = {
  nodes: 200,
  links: 400,
  label: 200,
  lanes: 20,
  rows: 100,
  cols: 26,
  items: 100,
  /** A note item or a table cell. */
  text: 1000,
} as const;
