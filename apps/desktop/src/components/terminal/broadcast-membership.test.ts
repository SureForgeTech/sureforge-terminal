// @vitest-environment happy-dom
//
// The broadcast's membership and the button that turns it on and off.
//
// The membership has to follow the live panes: a session that opens joins
// the broadcast, a session that closes leaves it, and the banner counts the
// sessions the broadcast really reaches. The two-session rule applies to
// turning the broadcast ON — while it is on, the button stays usable, so a
// pane that closed can never leave the user unable to turn it off.
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBroadcastStore } from "../../store/broadcast-store";
import { isBroadcastButtonDisabled, useBroadcastMembership } from "./broadcast-membership";

describe("the broadcast membership", () => {
  beforeEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  afterEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  it("does not take part while the broadcast is off", () => {
    const { rerender } = renderHook(() => useBroadcastMembership(["pane-1", "pane-2"]));

    rerender();

    expect(useBroadcastStore.getState().paneIds).toEqual([]);
  });

  it("follows the live panes while the broadcast is on", () => {
    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-1"] });

    let livePaneIds = ["pane-1", "pane-2"];
    const { rerender } = renderHook(() => useBroadcastMembership(livePaneIds));

    // A session opened: it joins the broadcast.
    rerender();
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);

    // A session closed: it leaves the broadcast.
    livePaneIds = ["pane-1"];
    rerender();
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1"]);
  });

  it("empties the membership when the broadcast is turned off", () => {
    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-1", "pane-2"] });

    renderHook(() => useBroadcastMembership(["pane-1", "pane-2"]));

    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);

    useBroadcastStore.getState().setEnabled(false);

    expect(useBroadcastStore.getState().paneIds).toEqual([]);
  });

  it("keeps the button usable while the broadcast is on", () => {
    // A pane closed and only one is left: the button must still be usable,
    // or the user cannot turn the broadcast off.
    expect(isBroadcastButtonDisabled(true, 1)).toBe(false);
    expect(isBroadcastButtonDisabled(true, 0)).toBe(false);
  });

  it("needs two live sessions to turn the broadcast on", () => {
    expect(isBroadcastButtonDisabled(false, 0)).toBe(true);
    expect(isBroadcastButtonDisabled(false, 1)).toBe(true);
    expect(isBroadcastButtonDisabled(false, 2)).toBe(false);
    expect(isBroadcastButtonDisabled(false, 5)).toBe(false);
  });
});
