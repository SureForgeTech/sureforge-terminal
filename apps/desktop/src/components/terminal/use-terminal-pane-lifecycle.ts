import { FitAddon } from "@xterm/addon-fit";
import { useEffectEvent, useLayoutEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Terminal } from "xterm";
import { resizeBackendSession, type SessionSocketLike } from "../../lib/api";
import { buildTerminalIntro } from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";

import { cleanupTerminalPaneLifecycle } from "./terminal-pane-cleanup";
import { guardViewportRefresh } from "./terminal-pane-viewport";
import {
  attachTerminalPaneConnectionControls,
  initializeTerminalPaneTransport,
} from "./terminal-pane-connection-controls";
import { registerBroadcastSender } from "../../store/broadcast-store";
import {
  attachTerminalPaneInputWiring,
  type TerminalContextMenuPosition,
} from "./terminal-pane-input-wiring";
import { createTerminalPaneMockSession } from "./terminal-pane-mock-session";
import { createTerminalPaneNativeSessionController } from "./terminal-pane-native-session";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";

interface TrustedKnownHost {
  algorithm: string;
  publicKey: string;
}

interface TerminalPaneLifecycleOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  agentForwarding: HostRecord["agentForwarding"];
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  authMethod: HostRecord["authMethod"];
  backendSessionIdRef: MutableRefObject<string | undefined>;
  commandBufferRef: MutableRefObject<string>;
  /** #507: set by the pane; the lifecycle calls through it. */
  clipboardNoticeRef: MutableRefObject<(message: string) => void>;
  /** #510: whether a terminal created now should start in screen reader mode. */
  screenReaderModeRef: MutableRefObject<boolean>;
  /** #507: set by the pane; the lifecycle calls through it. */
  contextMenuRequestRef: MutableRefObject<(position: TerminalContextMenuPosition) => void>;
  connectedOnceRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  consumePaneCommand: (paneId: string, commandId: string) => void;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  demoModeEnabled: boolean;
  dispatchCommandRef: MutableRefObject<(command: string) => void>;
  ensureConnectedRef: MutableRefObject<() => void>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  group: HostRecord["group"];
  host: HostRecord;
  hostKeyPolicy: HostRecord["hostKeyPolicy"];
  hostname: HostRecord["hostname"];
  id: HostRecord["id"];
  /**
   * The pane's own id.
   *
   * A pane is not a host: a host can be open in two panes at once, and the
   * broadcast works on PANES. The host id is kept for the session itself.
   */
  paneId: string;
  initialPaletteRef: MutableRefObject<TerminalAnsiPalette>;
  /** The terminal's font family and size, from the font picker. */
  terminalFontStack: string;
  terminalFontSize: number;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  label: HostRecord["label"];
  nativeBridgeEnabled: boolean;
  pane: SessionPane;
  pendingSecretsNoticeShownRef: MutableRefObject<boolean>;
  port: HostRecord["port"];
  privateKeyPath: HostRecord["privateKeyPath"];
  protocol: HostRecord["protocol"];
  protocolLabel: string;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  reconnectTimeoutRef: MutableRefObject<number | null>;
  recordPaneCommand: (paneId: string, command: string, source: "queued") => string | undefined;
  runtimeStatusRef: MutableRefObject<RuntimeStatusMessage | null>;
  setPaneBackendSession: (paneId: string, backendSessionId: string | undefined) => void;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState, connectionError?: string) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setRuntimeStatusMessage: Dispatch<SetStateAction<RuntimeStatusMessage | null>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  sftpRoot: HostRecord["sftpRoot"];
  socketRef: MutableRefObject<SessionSocketLike | null>;
  stableEnvironment: HostRecord["environment"];
  stableTags: HostRecord["tags"];
  terminalRef: MutableRefObject<Terminal | null>;
  toggleConnectionRef: MutableRefObject<() => void>;
  transportRef: MutableRefObject<SessionTransport>;
  trustedKnownHost?: TrustedKnownHost;
  unsupportedTransport: boolean;
  useMockTransport: boolean;
  username: HostRecord["username"];
}

export { resolveNativeSessionTransport } from "./terminal-pane-native-session";

export function useTerminalPaneLifecycle({
  activeHistoryEntryIdRef,
  agentForwarding,
  appendCommandOutput,
  authMethod,
  backendSessionIdRef,
  clipboardNoticeRef,
  screenReaderModeRef,
  commandBufferRef,
  contextMenuRequestRef,
  connectedOnceRef,
  connectingRef,
  connectionStateRef,
  consumePaneCommand,
  containerRef,
  demoModeEnabled,
  dispatchCommandRef,
  ensureConnectedRef,
  fitAddonRef,
  group,
  host,
  hostKeyPolicy,
  hostname,
  id,
  paneId,
  initialPaletteRef,
  terminalFontStack,
  terminalFontSize,
  intentionalDisconnectRef,
  label,
  nativeBridgeEnabled,
  pane,
  pendingSecretsNoticeShownRef,
  port,
  privateKeyPath,
  protocol,
  protocolLabel,
  reconnectAttemptRef,
  reconnectOnRestoreRef,
  reconnectTimeoutRef,
  recordPaneCommand,
  runtimeStatusRef,
  setPaneBackendSession,
  setPaneReconnectOnRestore,
  setPaneState,
  setPaneTransport,
  setRuntimeStatusMessage,
  setSearchOpen,
  sftpRoot,
  socketRef,
  stableEnvironment,
  stableTags,
  terminalRef,
  toggleConnectionRef,
  transportRef,
  trustedKnownHost,
  unsupportedTransport,
  useMockTransport,
  username,
}: TerminalPaneLifecycleOptions) {
  /*
   * #175: the whole `host` object is passed to two async secret helpers inside
   * the effect. It cannot be a dependency — `markConnected` changes
   * `lastConnectedAt`, so the object differs on every connect even when nothing
   * the terminal cares about did. Reading it through an Effect Event gets the
   * LATEST host at call time without making the effect re-run, which is exactly
   * the semantics those checks want: they run seconds after setup, and should
   * see current state rather than a snapshot.
   */
  const readLatestHost = useEffectEvent(() => host);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: terminalFontStack,
      fontSize: terminalFontSize,
      scrollback: 10000,
      theme: initialPaletteRef.current,
      // #510: a terminal recreated after a host change starts in the right
      // mode; useTerminalScreenReaderMode keeps it right afterwards.
      screenReaderMode: screenReaderModeRef.current,
    });
    const fitAddon = new FitAddon();
    let fitFrameId: number | null = null;
    let disposed = false;

    const { runMockCommand, writePrompt } = createTerminalPaneMockSession({
      activeHistoryEntryIdRef,
      appendCommandOutput,
      commandBufferRef,
      group,
      hostname,
      label,
      port,
      protocol,
      sftpRoot,
      stableTags,
      terminal,
      username,
    });

    const setPendingSecretsState = (announce = false) => {
      connectionStateRef.current = "pendingSecrets";
      setPaneState(pane.id, "pendingSecrets");

      if (!announce || pendingSecretsNoticeShownRef.current) {
        return;
      }

      terminal.writeln(
        "\r\nSession restore is waiting for runtime credentials. Click Resume when you are ready to continue."
      );
      pendingSecretsNoticeShownRef.current = true;
    };

    const scheduleFit = () => {
      if (disposed) {
        return;
      }

      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId);
      }

      fitFrameId = window.requestAnimationFrame(() => {
        if (disposed) {
          return;
        }

        try {
          fitAddon.fit();

          if (
            transportRef.current !== "mock" &&
            transportRef.current !== "unsupported" &&
            backendSessionIdRef.current
          ) {
            void resizeBackendSession(backendSessionIdRef.current, {
              cols: terminal.cols,
              rows: terminal.rows,
            }).catch(() => {
              clearBackendSession();
            });
          }
        } catch {
          // xterm can transiently report missing dimensions during initial layout.
        }
      });
    };

    const nativeSessionController = createTerminalPaneNativeSessionController({
      activeHistoryEntryIdRef,
      agentForwarding,
      appendCommandOutput,
      authMethod,
      backendSessionIdRef,
      connectedOnceRef,
      connectingRef,
      connectionStateRef,
      hostname,
      hostKeyPolicy,
      id,
      intentionalDisconnectRef,
      isDisposed: () => disposed,
      label,
      pane,
      pendingSecretsNoticeShownRef,
      port,
      privateKeyPath,
      protocol,
      protocolLabel,
      readLatestHost,
      reconnectAttemptRef,
      reconnectOnRestoreRef,
      reconnectTimeoutRef,
      runtimeStatusRef,
      setPaneBackendSession,
      setPaneReconnectOnRestore,
      setPaneState,
      setPaneTransport,
      setPendingSecretsState,
      setRuntimeStatusMessage,
      sftpRoot,
      socketRef,
      stableEnvironment,
      terminal,
      transportRef,
      unsupportedTransport,
      useMockTransport,
      username,
    });
    const {
      clearBackendSession,
      clearReconnectTimer,
      connectNativeSession,
      disconnectNativeSession,
    } = nativeSessionController;

    const connectionControlsOptions = {
      activeHistoryEntryIdRef,
      authMethod,
      backendSessionIdRef,
      commandBufferRef,
      connectNativeSession,
      connectionStateRef,
      dispatchCommandRef,
      ensureConnectedRef,
      intentionalDisconnectRef,
      isDisposed: () => disposed,
      pane,
      pendingSecretsNoticeShownRef,
      protocol,
      readLatestHost,
      reconnectOnRestoreRef,
      recordPaneCommand,
      runMockCommand,
      clearReconnectTimer,
      disconnectNativeSession,
      setPaneReconnectOnRestore,
      setPaneState,
      setPaneTransport,
      setPendingSecretsState,
      socketRef,
      terminal,
      toggleConnectionRef,
      transportRef,
      unsupportedTransport,
      useMockTransport,
      writePrompt,
    };
    attachTerminalPaneConnectionControls(connectionControlsOptions);

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    guardViewportRefresh(terminal);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    buildTerminalIntro(
      { hostname, label, port, protocol, username },
      connectionStateRef.current === "connected",
      {
        demoModeEnabled,
        nativeBridgeEnabled,
        unsupportedTransport,
      }
    ).forEach((line) => {
      terminal.writeln(line);
    });

    // A pane joins the broadcast by registering a sender for its own input.
    // The sender reads the socket when it is called, so it always sends to the
    // session the pane has NOW, not the one it had when it registered — and
    // it reports whether it sent, so a pane whose session has dropped is
    // skipped rather than counted.
    const unregisterBroadcastSender = registerBroadcastSender(paneId, (data) => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify({ type: "input", data }));
      return true;
    });

    const { contextMenuHandler, dataDisposable, selectionDisposable } = attachTerminalPaneInputWiring({
      paneId,
      commandBufferRef,
      connectionStateRef,
      container,
      notifyClipboard: (message) => clipboardNoticeRef.current(message),
      requestContextMenu: (position) => contextMenuRequestRef.current(position),
      runMockCommand,
      setSearchOpen,
      socketRef,
      terminal,
      transportRef,
    });

    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(container);
    scheduleFit();

    void initializeTerminalPaneTransport(connectionControlsOptions);

    return () => {
      unregisterBroadcastSender();
      cleanupTerminalPaneLifecycle({
        clearReconnectTimer,
        container,
        contextMenuHandler,
        dataDisposable,
        fitAddon,
        fitAddonRef,
        fitFrameId,
        markDisposed: () => {
          disposed = true;
        },
        observer,
        selectionDisposable,
        socketRef,
        terminal,
        terminalRef,
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [
    agentForwarding,
    authMethod,
    consumePaneCommand,
    stableEnvironment,
    group,
    hostname,
    hostKeyPolicy,
    id,
    paneId,
    label,
    demoModeEnabled,
    protocol,
    // The controller reads saved keys when it connects; a change to this
    // host's approved key still rebuilds the session with the new key.
    trustedKnownHost,
    port,
    pane.id,
    privateKeyPath,
    nativeBridgeEnabled,
    appendCommandOutput,
    recordPaneCommand,
    protocolLabel,
    setPaneBackendSession,
    setPaneReconnectOnRestore,
    setPaneState,
    setPaneTransport,
    sftpRoot,
    stableTags,
    unsupportedTransport,
    useMockTransport,
    username,
  ]);
}
