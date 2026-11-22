// The Tauri event names, in one list.
//
// The native shell emits these and the renderer listens for them. Both sides
// are checked against src-tauri/tauri-events.txt, so a name that changes on
// one side only fails that side's test — and for the updater progress there is
// no live release to notice it until the updater feed is alive (#224).

export const MENU_EVENT_NAME = "terminal_workspace://menu-event";
export const SESSION_STREAM_EVENT_NAME = "terminal_workspace://session-stream";
export const UPDATE_INSTALL_PROGRESS_EVENT_NAME = "terminal_workspace://update-install-progress";
export const WINDOW_CLOSE_REQUESTED_EVENT = "terminal_workspace://window-close-requested";
