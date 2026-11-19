// Send what you type to more than one terminal.
//
// The competitor's daily-use list has "broadcast input across multiple
// terminals", and this app could only broadcast a SNIPPET across hosts —
// there was no way to type into several live sessions at once, which is what
// you want when the same command has to run on four machines.
//
// The broadcast is off by default and says so on screen while it is on: input
// that goes to four terminals instead of one is exactly the kind of thing
// that should never happen by accident.
//
// The senders are functions, so they cannot be persisted — they are kept in a
// registry beside the store rather than in it.

import { create } from "zustand";

/** Sends input to one pane. */
export type PaneInputSender = (data: string) => void;

interface BroadcastState {
  /** Whether input is broadcast at all. */
  enabled: boolean;
  /** The panes that receive the broadcast. */
  paneIds: string[];
  setEnabled: (enabled: boolean) => void;
  /** Add or remove a pane from the broadcast. */
  togglePane: (paneId: string) => void;
  /** Every pane that has a live session, for a broadcast to all of them. */
  setAllPanes: (paneIds: string[]) => void;
}

export const useBroadcastStore = create<BroadcastState>()((set) => ({
  enabled: false,
  paneIds: [],
  setEnabled: (enabled) =>
    set((state) => ({
      enabled,
      // Turning the broadcast off empties it: leaving stale panes in the set
      // would mean the next broadcast went to a session the user had closed.
      paneIds: enabled ? state.paneIds : [],
    })),
  togglePane: (paneId) =>
    set((state) => ({
      paneIds: state.paneIds.includes(paneId)
        ? state.paneIds.filter((id) => id !== paneId)
        : [...state.paneIds, paneId],
    })),
  setAllPanes: (paneIds) => set({ paneIds: [...new Set(paneIds)] }),
}));

// The senders, beside the store rather than in it: they are functions, and
// the persisted half of the state must stay serialisable.
const senders = new Map<string, PaneInputSender>();

/**
 * Register a pane's input sender, and get a function that removes it.
 *
 * A pane registers when its terminal exists and unregisters when it goes,
 * so a closed pane never receives a broadcast.
 */
export function registerBroadcastSender(paneId: string, send: PaneInputSender): () => void {
  senders.set(paneId, send);
  return () => {
    senders.delete(paneId);
  };
}

/**
 * Send input to the given panes.
 *
 * A pane whose session is not open is skipped: the sender checks, so a
 * broadcast never queues input for a session that is not there.
 */
export function broadcastInput(paneIds: string[], data: string): number {
  let delivered = 0;
  for (const paneId of paneIds) {
    const send = senders.get(paneId);
    if (!send) {
      continue;
    }
    send(data);
    delivered += 1;
  }
  return delivered;
}
