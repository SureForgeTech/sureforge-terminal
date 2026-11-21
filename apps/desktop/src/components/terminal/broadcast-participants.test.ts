import { describe, expect, it } from "vitest";

import { selectLiveBroadcastPanes } from "./broadcast-participants";
import { type SessionPane } from "../../types/session";

// Which panes can take part in a broadcast.
//
// The broadcast reaches the panes that are actually live. A restored tab
// that is not open, a pane still waiting for a secret, a mock session and a
// pane whose session has dropped are not taking part — counting them as if
// they were would put the wrong number on the banner and offer the
// broadcast when it cannot deliver.

function pane(overrides: Partial<SessionPane>): SessionPane {
  return {
    id: "pane-1",
    hostId: "host-1",
    title: "host-1",
    connectionState: "connected",
    transport: "ssh",
    queuedCommands: [],
    reconnectOnRestore: false,
    persistOutputPreview: true,
    createdAt: "2026-11-18T00:00:00.000Z",
    updatedAt: "2026-11-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("the panes that can take part in a broadcast", () => {
  it("takes the connected panes that have a terminal", () => {
    const panes = {
      "pane-1": pane({ id: "pane-1" }),
      "pane-2": pane({ id: "pane-2" }),
    };

    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-1", "pane-2"]);
  });

  it("leaves out a pane that is not connected", () => {
    const panes = {
      "pane-1": pane({ id: "pane-1" }),
      "pane-2": pane({ id: "pane-2", connectionState: "disconnected" }),
      "pane-3": pane({ id: "pane-3", connectionState: "connecting" }),
      "pane-4": pane({ id: "pane-4", connectionState: "pendingSecrets" }),
      "pane-5": pane({ id: "pane-5", connectionState: "error" }),
    };

    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-1"]);
  });

  it("leaves out a pane with no terminal", () => {
    // A pane whose terminal is not on screen cannot receive anything.
    const panes = {
      "pane-1": pane({ id: "pane-1" }),
      "pane-2": pane({ id: "pane-2" }),
    };

    expect(selectLiveBroadcastPanes(panes, (paneId) => paneId === "pane-1")).toEqual([
      "pane-1",
    ]);
  });

  it("leaves out a mock session", () => {
    const panes = {
      "pane-1": pane({ id: "pane-1", transport: "mock" }),
      "pane-2": pane({ id: "pane-2" }),
    };

    expect(selectLiveBroadcastPanes(panes, () => true)).toEqual(["pane-2"]);
  });

  it("returns nothing when there is no pane at all", () => {
    expect(selectLiveBroadcastPanes({}, () => true)).toEqual([]);
  });
});
