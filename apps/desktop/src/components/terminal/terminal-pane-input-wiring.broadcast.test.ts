import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBroadcastSender, useBroadcastStore } from "../../store/broadcast-store";
import { attachTerminalPaneInputWiring } from "./terminal-pane-input-wiring";

// Broadcast input across several live sessions.
//
// The competitor's daily-use list has it and this app could only broadcast a
// SNIPPET across hosts: there was no way to type into several live sessions
// at once. These tests pin the behaviour that matters: what is typed goes to
// every pane taking part, the pane being typed in is always part of it, and
// with the broadcast off nothing changes.

function ref<T>(current: T) {
  return { current };
}

function createTerminal() {
  const listeners: Array<(data: string) => void> = [];
  const terminal = {
    onData: (listener: (data: string) => void) => {
      listeners.push(listener);
      return { dispose: vi.fn() };
    },
    onSelectionChange: () => ({ dispose: vi.fn() }),
    attachCustomKeyEventHandler: () => true,
    paste: vi.fn(),
    getSelection: () => "",
  };
  return {
    terminal,
    emitData: (data: string) => listeners.forEach((listener) => listener(data)),
  };
}

describe("broadcasting input to several sessions", () => {
  const container = { addEventListener: vi.fn() } as unknown as HTMLDivElement;

  beforeEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  afterEach(() => {
    useBroadcastStore.setState({ enabled: false, paneIds: [] });
  });

  function wire(paneId: string, socketSend: (payload: string) => void) {
    const { terminal, emitData } = createTerminal();
    const socketRef = ref({
      addEventListener: vi.fn(),
      close: vi.fn(),
      readyState: 1,
      send: socketSend,
    });
    const transportRef = ref<"ssh" | "mock">("ssh");

    attachTerminalPaneInputWiring({
      paneId,
      commandBufferRef: ref(""),
      connectionStateRef: ref<"connected" | "disconnected">("connected"),
      container,
      notifyClipboard: vi.fn(),
      requestContextMenu: vi.fn(),
      runMockCommand: vi.fn(),
      setSearchOpen: vi.fn(),
      socketRef,
      terminal: terminal as never,
      transportRef,
    });

    return { emitData };
  }

  it("sends what is typed to every pane taking part", () => {
    const otherPane = vi.fn();
    const unregister = registerBroadcastSender("pane-2", otherPane);
    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-2"] });

    const ownSocket = vi.fn();
    const { emitData } = wire("pane-1", ownSocket);
    emitData("uptime\r");

    // The other pane gets it...
    expect(otherPane).toHaveBeenCalledWith("uptime\r");
    // ...and so does the pane it was typed in, even though that pane was not
    // in the set: a broadcast that left out the pane under the cursor would
    // swallow what was typed.
    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "uptime\r" }));

    unregister();
  });

  it("does not send to a pane that is not taking part", () => {
    const otherPane = vi.fn();
    const unregister = registerBroadcastSender("pane-2", otherPane);
    useBroadcastStore.setState({ enabled: true, paneIds: ["pane-3"] });

    const ownSocket = vi.fn();
    const { emitData } = wire("pane-1", ownSocket);
    emitData("ls\r");

    expect(otherPane).not.toHaveBeenCalled();
    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "ls\r" }));

    unregister();
  });

  it("changes nothing while the broadcast is off", () => {
    const otherPane = vi.fn();
    const unregister = registerBroadcastSender("pane-2", otherPane);
    useBroadcastStore.setState({ enabled: false, paneIds: ["pane-2"] });

    const ownSocket = vi.fn();
    const { emitData } = wire("pane-1", ownSocket);
    emitData("ls\r");

    expect(otherPane).not.toHaveBeenCalled();
    expect(ownSocket).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: "ls\r" }));

    unregister();
  });
});
