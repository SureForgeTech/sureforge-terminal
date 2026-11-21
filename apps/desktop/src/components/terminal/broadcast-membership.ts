import { useEffect } from "react";

import { useBroadcastStore } from "../../store/broadcast-store";

/**
 * Keeps the broadcast's membership on the live panes.
 *
 * A session that opens joins the broadcast and a session that closes leaves
 * it. Without this the membership is what it was when the broadcast was
 * turned on, so the banner counts sessions the broadcast does not reach and
 * a closed session keeps receiving input.
 */
export function useBroadcastMembership(livePaneIds: string[]) {
  const broadcastEnabled = useBroadcastStore((state) => state.enabled);
  const broadcastPaneIds = useBroadcastStore((state) => state.paneIds);
  const setBroadcastPanes = useBroadcastStore((state) => state.setAllPanes);

  // The key is the stable value of the list: the list itself is a new array
  // on every render, and an effect that depends on it would run forever.
  const livePaneKey = livePaneIds.join(",");
  useEffect(() => {
    if (!broadcastEnabled) {
      return;
    }
    if (livePaneKey !== broadcastPaneIds.join(",")) {
      setBroadcastPanes(livePaneIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the stable value of the list
  }, [broadcastEnabled, livePaneKey]);

  return { broadcastEnabled, broadcastPaneIds };
}

/**
 * Whether the broadcast button is disabled.
 *
 * The two-session rule applies to turning the broadcast ON. While it is on,
 * the button stays usable: a pane that closed must not leave the user
 * unable to turn the broadcast off.
 */
export function isBroadcastButtonDisabled(
  broadcastEnabled: boolean,
  livePaneCount: number
): boolean {
  return !broadcastEnabled && livePaneCount < 2;
}
