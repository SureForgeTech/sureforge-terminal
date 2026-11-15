import { describe, expect, it } from "vitest";
import type { SessionPane, SessionTab } from "../types/session";
import { collectForwardSessions } from "./forward-sessions";

const pane = (id: string, hostId: string, backendSessionId?: string) =>
  ({ id, hostId, backendSessionId }) as SessionPane;
const tab = (id: string, hostId: string, paneIds: string[], activePaneId: string) =>
  ({ id, hostId, paneIds, activePaneId }) as SessionTab;

describe("collectForwardSessions", () => {
  it("includes every pane of a split tab, not just the focused one", () => {
    const panes = {
      a: pane("a", "host-1", "session-a"),
      b: pane("b", "host-2", "session-b"),
    };
    expect(collectForwardSessions([tab("t", "host-1", ["a", "b"], "a")], panes)).toEqual([
      { sessionId: "session-a", hostId: "host-1" },
      { sessionId: "session-b", hostId: "host-2" },
    ]);
  });

  it("skips panes without a live session and lists a shared session once", () => {
    const panes = {
      a: pane("a", "host-1", "shared"),
      b: pane("b", "host-1"),
      c: pane("c", "host-1", "shared"),
    };
    expect(
      collectForwardSessions(
        [tab("t1", "host-1", ["a", "b"], "b"), tab("t2", "host-1", ["c"], "c")],
        panes
      )
    ).toEqual([{ sessionId: "shared", hostId: "host-1" }]);
  });
});
