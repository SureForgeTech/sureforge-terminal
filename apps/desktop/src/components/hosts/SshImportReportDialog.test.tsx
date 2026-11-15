// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SshConfigImportReport } from "../../lib/ssh-config-import";
import { SshImportReportDialog } from "./SshImportReportDialog";

const report: SshConfigImportReport = {
  importedCount: 2,
  defaultsAppliedCount: 1,
  unresolvedProxyJumpAliases: ["bastion"],
  missingUsernameAliases: ["db"],
  skipped: [{ reason: "Match block", detail: "Match host *.example.com" }],
};

describe("SshImportReportDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing without a report", () => {
    render(<SshImportReportDialog report={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled dialog that shows the report", () => {
    render(<SshImportReportDialog report={report} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      screen.getByText("SSH config import summary").id
    );
    expect(dialog.textContent).toContain("Imported 2 hosts.");
    expect(dialog.textContent).toContain("bastion");
    expect(dialog.textContent).toContain("db");
    expect(dialog.textContent).toContain("Skipped (1)");
  });

  it("moves focus into the dialog when it opens", () => {
    render(<SshImportReportDialog report={report} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape and on the Close button", () => {
    const onClose = vi.fn();
    render(<SshImportReportDialog report={report} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
