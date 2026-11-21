// @vitest-environment happy-dom
//
// Connect-failure surfacing.
//
// Every connect entry point — the hosts page, quick-connect, the sidebar's
// local/pinned/recent lists, the command palette, and the first-run welcome
// panel — funnels through launchHostSession. Those failures used to be
// computed correctly and then dropped into a console.warn at each call site,
// so a host that was down, firewalled, or mis-typed produced no on-screen
// output at all: the user clicked "Open", no tab appeared, and the app looked
// broken.
//
// This pins the banner contract: the message reaches the screen, it is
// announced to assistive tech, and the user can dismiss it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectErrorBanner } from "./ConnectErrorBanner";
import { useConnectErrorStore } from "../../store/connect-error-store";

/**
 * Where the router is.
 *
 * The action has to take the user to the host that has to change, so the
 * route it navigates to is part of the contract: a banner that only
 * cleared itself would pass a test that only checked the banner went away.
 */
function CurrentRoute() {
  const location = useLocation();
  return <span data-testid="current-route">{`${location.pathname}${location.search}`}</span>;
}

// The banner's action navigates, so it lives inside the router the app has.
function renderBanner() {
  return render(
    <MemoryRouter initialEntries={["/sessions"]}>
      <ConnectErrorBanner />
      <CurrentRoute />
    </MemoryRouter>
  );
}

describe("ConnectErrorBanner", () => {
  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
  });

  afterEach(() => {
    cleanup();
    useConnectErrorStore.getState().clearConnectError();
  });

  it("renders nothing when there is no failure to report", () => {
    renderBanner();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the reported message", () => {
    useConnectErrorStore
      .getState()
      .setConnectError("Could not scan example.internal:22. Check that the host is reachable and try again.");

    renderBanner();

    const banner = screen.getByRole("alert");
    expect(banner.textContent).toContain("Could not scan example.internal:22.");
  });

  it("announces the failure to assistive tech", () => {
    useConnectErrorStore.getState().setConnectError("Something failed.");

    renderBanner();

    expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection failed");
  });

  it("reports a user-initiated cancellation as a warning rather than an error", () => {
    useConnectErrorStore.getState().setConnectError("Connection cancelled.", "warning");

    renderBanner();

    expect(screen.getByRole("alert").getAttribute("aria-label")).toBe("Connection cancelled");
  });

  it("dismisses the message", () => {
    useConnectErrorStore.getState().setConnectError("Something failed.");

    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(useConnectErrorStore.getState().message).toBeNull();
  });
});

describe("ConnectErrorBanner with an action", () => {
  beforeEach(() => {
    useConnectErrorStore.getState().clearConnectError();
  });

  afterEach(() => {
    cleanup();
    useConnectErrorStore.getState().clearConnectError();
  });

  it("offers the action that fixes the failure", () => {
    useConnectErrorStore.getState().setConnectError("The host key could not be approved.", "error", {
      label: "Open host",
      href: "/hosts?edit=host-1",
    });

    renderBanner();

    const action = screen.getByRole("button", { name: "Open host" });
    expect(action).toBeTruthy();
    // The banner still offers Dismiss: the action is an addition, not a
    // replacement.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("does not offer an action when there is nothing to go to", () => {
    useConnectErrorStore.getState().setConnectError("Could not reach the host.");

    renderBanner();

    expect(screen.queryByRole("button", { name: "Open host" })).toBeNull();
  });

  it("takes the user to the host when the action is taken", () => {
    useConnectErrorStore.getState().setConnectError("The host key could not be approved.", "error", {
      label: "Open host",
      href: "/hosts?edit=host-1",
    });

    renderBanner();
    expect(screen.getByTestId("current-route").textContent).toBe("/sessions");

    fireEvent.click(screen.getByRole("button", { name: "Open host" }));

    // The banner goes, and the user lands on the host's editor.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("current-route").textContent).toBe("/hosts?edit=host-1");
  });
});
