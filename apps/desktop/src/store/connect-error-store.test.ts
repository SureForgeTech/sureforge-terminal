import { beforeEach, describe, expect, it } from "vitest";

import {
  reportConnectError,
  useConnectErrorStore,
} from "./connect-error-store";

// A connect failure the user has to act on should say what to do about it,
// not only what went wrong. The action is declarative — a route to go to — so
// the store holds no callbacks and the banner owns the navigation.

describe("the connect error banner", () => {
  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
  });

  it("carries a message and no action by default", () => {
    reportConnectError("Could not reach the host.");

    const state = useConnectErrorStore.getState();
    expect(state.message).toBe("Could not reach the host.");
    expect(state.tone).toBe("error");
    expect(state.action).toBeNull();
  });

  it("carries the action that fixes the failure", () => {
    reportConnectError("The host key could not be approved.", "error", {
      label: "Open host",
      href: "/hosts?edit=host-1",
    });

    const state = useConnectErrorStore.getState();
    expect(state.action?.label).toBe("Open host");
    expect(state.action?.href).toBe("/hosts?edit=host-1");
  });

  it("reports a failure the user chose as a warning", () => {
    reportConnectError("Connection cancelled.", "warning");

    expect(useConnectErrorStore.getState().tone).toBe("warning");
  });

  it("ignores an empty message", () => {
    reportConnectError("");
    reportConnectError(null);
    reportConnectError(undefined);

    expect(useConnectErrorStore.getState().message).toBeNull();
  });

  it("drops the action when the banner is cleared", () => {
    reportConnectError("The host key could not be approved.", "error", {
      label: "Open host",
      href: "/hosts?edit=host-1",
    });
    useConnectErrorStore.getState().clearConnectError();

    const state = useConnectErrorStore.getState();
    expect(state.message).toBeNull();
    expect(state.action).toBeNull();
  });

  it("replaces a stale action when a new failure is reported", () => {
    reportConnectError("First failure.", "error", { label: "Open host", href: "/hosts?edit=1" });
    reportConnectError("Second failure.");

    expect(useConnectErrorStore.getState().action).toBeNull();
  });
});
