import type { Response } from 'express';

// Real-time push, keyed by group code so a broadcast can only ever reach devices inside the
// same partnership. Same shape as the Trackmarg transport app's channel.
const clientsByGroup = new Map<string, Set<Response>>();

export function subscribe(groupCode: string, res: Response): void {
  if (!clientsByGroup.has(groupCode)) clientsByGroup.set(groupCode, new Set());
  clientsByGroup.get(groupCode)!.add(res);
}

export function unsubscribe(groupCode: string, res: Response): void {
  const clients = clientsByGroup.get(groupCode);
  if (!clients) return;
  clients.delete(res);
  // Drop the empty set rather than leaving it behind - otherwise the map grows by one entry
  // per group that has ever connected and never shrinks.
  if (clients.size === 0) clientsByGroup.delete(groupCode);
}

export type LedgerEvent =
  | 'ledger-changed'
  | 'session-changed'
  | 'partner-joined'
  // Pushed by the support console. The frozen one locks every open device immediately; the
  // unfrozen one is why /events stays reachable while frozen at all.
  | 'account-frozen'
  | 'account-unfrozen';

export function broadcast(
  groupCode: string,
  event: LedgerEvent,
  payload: Record<string, unknown> = {},
): void {
  const clients = clientsByGroup.get(groupCode);
  if (!clients) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

/// Identifies the browser tab that caused a change, so it can ignore the echo of its own
/// event. Without this the device that saved a transaction refreshed twice: once because it
/// knew it had saved, and again when its own broadcast came back to it.
export function actorOf(req: { headers: Record<string, unknown> }): string {
  const header = req.headers['x-ledger-client'];
  return typeof header === 'string' ? header : '';
}
