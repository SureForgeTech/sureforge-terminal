import type { SessionPane, SessionTab } from "../types/session";

/**
 * The live backend sessions whose port forwards the Tunnels page lists, one
 * entry per session, labelled with the host of the pane that owns it.
 *
 * Every pane of every tab counts, not just the focused one: a split tab holds
 * several panes, and a forward opened from a pane that is not focused used to
 * be missing from Tunnels, so it could not be seen or stopped there.
 */
export function collectForwardSessions(
  tabs: readonly SessionTab[],
  panes: Readonly<Record<string, SessionPane | undefined>>
): { sessionId: string; hostId: string }[] {
  const seen = new Set<string>();
  const out: { sessionId: string; hostId: string }[] = [];
  for (const tab of tabs) {
    for (const paneId of tab.paneIds) {
      const pane = panes[paneId];
      if (!pane?.backendSessionId || seen.has(pane.backendSessionId)) {
        continue;
      }
      seen.add(pane.backendSessionId);
      out.push({ sessionId: pane.backendSessionId, hostId: pane.hostId || tab.hostId });
    }
  }
  return out;
}
