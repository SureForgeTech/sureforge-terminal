// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileBrowser } from "./FileBrowser";
import * as api from "../../lib/api";
import { useTransfersStore } from "../../store/transfers-store";
import type { HostRecord } from "../../types/host";

vi.mock("../../lib/api", () => ({
  listRemoteDirectory: vi.fn(), createRemoteDirectory: vi.fn(), renameRemoteEntry: vi.fn(),
  deleteRemoteEntry: vi.fn(), uploadRemoteFile: vi.fn(), downloadRemoteFile: vi.fn(),
}));
vi.mock("../../lib/runtime-secrets", () => ({ ensureRuntimeSecrets: vi.fn(async () => true) }));
vi.mock("../../lib/connections", () => ({ buildBackendConnection: vi.fn(() => ({})) }));

const host: HostRecord = {
  id: "test-host", label: "Test", hostname: "example.invalid", username: "test", port: 22,
  protocol: "ssh", authMethod: "none", privateKeyPath: "", group: "", tags: [], note: "",
  favorite: false, keyLabel: "", hostKeyPolicy: "requireTrusted", agentForwarding: false,
  environment: {}, sftpRoot: "/a", snippetCount: 0, forwardingCount: 0, createdAt: "", updatedAt: "",
};
const initial = useTransfersStore.getState();
beforeEach(() => {
  useTransfersStore.setState({ remotePathByHost: { [host.id]: "/a" }, queue: [] });
  vi.mocked(api.listRemoteDirectory).mockImplementation(async (_host, path) => ({
    path, entries: [{ name: "file.txt", path: `${path}/file.txt`, kind: "file", size: 1 }],
  }));
});
afterEach(() => { cleanup(); useTransfersStore.setState(initial); vi.resetAllMocks(); });

it.each(["upload", "mkdir", "rename", "delete"])("%s reloads only the folder where it started", async (action) => {
  for (const navigate of [true, false]) {
    let finish!: () => void;
    const pending = new Promise<{ ok: boolean; path: string }>((resolve) => {
      finish = () => resolve({ ok: true, path: "/a" });
    });
    const operation = action === "upload" ? api.uploadRemoteFile : action === "mkdir" ? api.createRemoteDirectory
      : action === "rename" ? api.renameRemoteEntry : api.deleteRemoteEntry;
    vi.mocked(operation).mockReturnValue(pending);
    const view = render(<FileBrowser host={host} />);
    await screen.findByText("/a/file.txt");
    if (action === "upload") {
      fireEvent.change(view.container.querySelector('input[type="file"]')!, {
        target: { files: [new File(["test"], "upload.txt")] },
      });
    } else if (action === "mkdir") {
      fireEvent.click(screen.getByRole("button", { name: "New folder" }));
      fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "new" } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create folder" }));
    } else {
      fireEvent.click(screen.getByText("/a/file.txt"));
      fireEvent.click(screen.getByRole("button", { name: action === "rename" ? "Rename" : "Delete" }));
      if (action === "rename") {
        fireEvent.change(screen.getByPlaceholderText("New name"), { target: { value: "renamed.txt" } });
      }
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: action === "rename" ? "Rename" : "Delete" }));
    }
    await vi.waitFor(() => expect(operation).toHaveBeenCalled());
    if (navigate) {
      act(() => useTransfersStore.getState().rememberRemotePath(host.id, "/b"));
      await screen.findByText("/b/file.txt");
    }
    vi.mocked(api.listRemoteDirectory).mockClear();
    await act(async () => { finish(); await pending; });
    expect(useTransfersStore.getState().remotePathByHost[host.id]).toBe(navigate ? "/b" : "/a");
    expect(api.listRemoteDirectory).toHaveBeenCalledTimes(navigate ? 0 : 1);
    cleanup();
    useTransfersStore.setState({ remotePathByHost: { [host.id]: "/a" }, queue: [] });
    vi.mocked(operation).mockClear();
  }
});
