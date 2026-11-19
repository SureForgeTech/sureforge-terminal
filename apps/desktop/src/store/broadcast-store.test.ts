import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  broadcastInput,
  registerBroadcastSender,
  useBroadcastStore,
} from "./broadcast-store";

// Broadcast input across several live sessions: the competitor's daily-use
// list has it, and this app could only broadcast a SNIPPET across hosts.
// What you type goes to every pane taking part — so it is off by default, and
// it must never reach a pane whose session is not open.

describe("broadcast input", () => {
  beforeEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  afterEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  it("is off by default", () => {
    expect(useBroadcastStore.getState().enabled).toBe(false);
    expect(useBroadcastStore.getState().paneIds).toEqual([]);
  });

  it("sends the input to every pane taking part", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerBroadcastSender("pane-1", first);
    const unregisterSecond = registerBroadcastSender("pane-2", second);

    expect(broadcastInput(["pane-1", "pane-2"], "uptime\r")).toBe(2);
    expect(first).toHaveBeenCalledWith("uptime\r");
    expect(second).toHaveBeenCalledWith("uptime\r");

    unregisterFirst();
    unregisterSecond();
  });

  it("skips a pane that is not there", () => {
    const present = vi.fn();
    const unregister = registerBroadcastSender("pane-1", present);

    expect(broadcastInput(["pane-1", "pane-gone"], "ls\r")).toBe(1);
    expect(present).toHaveBeenCalledWith("ls\r");

    unregister();
    expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
  });

  it("stops sending to a pane that unregistered", () => {
    const send = vi.fn();
    const unregister = registerBroadcastSender("pane-1", send);

    unregister();
    expect(broadcastInput(["pane-1"], "ls\r")).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("empties the set when the broadcast is turned off", () => {
    // A pane that was closed must not keep receiving a later broadcast.
    useBroadcastStore.getState().setAllPanes(["pane-1", "pane-2"]);
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);

    useBroadcastStore.getState().setEnabled(false);

    expect(useBroadcastStore.getState().enabled).toBe(false);
    expect(useBroadcastStore.getState().paneIds).toEqual([]);
  });

  it("adds and removes a single pane", () => {
    useBroadcastStore.getState().togglePane("pane-1");
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1"]);

    useBroadcastStore.getState().togglePane("pane-2");
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);

    useBroadcastStore.getState().togglePane("pane-1");
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-2"]);
  });

  it("does not list the same pane twice", () => {
    useBroadcastStore.getState().setAllPanes(["pane-1", "pane-1", "pane-2"]);
    expect(useBroadcastStore.getState().paneIds).toEqual(["pane-1", "pane-2"]);
  });
});
