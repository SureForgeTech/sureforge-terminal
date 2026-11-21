import { type SessionPane } from "../../types/session";

/**
 * The panes that can take part in a broadcast right now.
 *
 * A pane takes part when its session is CONNECTED and its terminal is on
 * screen. A restored tab that is not open, a pane still waiting for a
 * secret, a mock session and a pane whose session has dropped are not
 * taking part — and counting them as if they were would put the wrong
 * number on the banner and offer the broadcast when it cannot deliver.
 *
 * The pane ids are sorted so the list is stable between renders.
 */
export function selectLiveBroadcastPanes(
  panes: Record<string, SessionPane>,
  hasSender: (paneId: string) => boolean
): string[] {
  return Object.values(panes)
    .filter(
      (pane) =>
        pane.transport !== "mock" &&
        pane.connectionState === "connected" &&
        hasSender(pane.id)
    )
    .map((pane) => pane.id)
    .sort();
}
