// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PortForwardPanel } from "./PortForwardPanel";
import { deleteLocalForward, listLocalForwards } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  createLocalForward: vi.fn(), deleteLocalForward: vi.fn(), listLocalForwards: vi.fn(),
}));
afterEach(cleanup);

it("shows a stop error and refreshes the removed forward", async () => {
  vi.mocked(listLocalForwards).mockResolvedValueOnce({ forwards: [{
    id: "forward", direction: "local", sessionId: "session", localHost: "localhost",
    localPort: 42000, remoteHost: "localhost", remotePort: 443, createdAt: "",
  }] }).mockResolvedValue({ forwards: [] });
  vi.mocked(deleteLocalForward).mockRejectedValue(new Error("close failed"));
  render(<PortForwardPanel sessionId="session" />);
  expect(await screen.findByText("localhost:42000")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  expect(await screen.findByText("close failed")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});
