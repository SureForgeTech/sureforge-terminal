import type { SshConfigImportReport } from "../../lib/ssh-config-import";
import { Modal } from "../common/Modal";

interface SshImportReportDialogProps {
  report: SshConfigImportReport | null;
  onClose: () => void;
}

/**
 * UX-12 (2026-10-29 review): this summary used to be a hand-built overlay
 * with no focus handling and no Escape. It now uses the shared Modal, which
 * moves focus in, traps Tab, closes on Escape and restores focus on close.
 */
export function SshImportReportDialog({ report, onClose }: SshImportReportDialogProps) {
  return (
    <Modal
      open={report !== null}
      title="SSH config import summary"
      onClose={onClose}
      className="max-w-lg"
      footer={
        <div className="flex justify-end">
          {/* #111: dismiss is a neutral action — accent is reserved for
              the single primary action per view. */}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
      }
    >
      {report ? (
        <div className="text-sm text-slate-200">
          <ul className="space-y-1 text-slate-300">
            <li>
              Imported <strong className="text-white">{report.importedCount}</strong> host
              {report.importedCount === 1 ? "" : "s"}.
            </li>
            {report.defaultsAppliedCount > 0 ? (
              <li>
                Inherited defaults from <code>Host *</code> on{" "}
                <strong className="text-white">{report.defaultsAppliedCount}</strong> host
                {report.defaultsAppliedCount === 1 ? "" : "s"}.
              </li>
            ) : null}
            {report.missingUsernameAliases.length > 0 ? (
              <li>
                No username, so these cannot connect until you add one:{" "}
                <span className="text-amber-300">
                  {report.missingUsernameAliases.join(", ")}
                </span>
              </li>
            ) : null}
            {report.unresolvedProxyJumpAliases.length > 0 ? (
              <li>
                ProxyJump targets not present in the file (assign manually):{" "}
                <span className="text-amber-300">
                  {report.unresolvedProxyJumpAliases.join(", ")}
                </span>
              </li>
            ) : null}
          </ul>
          {report.skipped.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-700/40 bg-amber-950/30 p-3">
              <p className="text-xs uppercase tracking-wider text-amber-300">
                Skipped ({report.skipped.length})
              </p>
              <ul className="mt-2 max-h-40 overflow-y-auto space-y-1 text-xs text-amber-100/90">
                {report.skipped.slice(0, 25).map((entry, index) => (
                  <li key={`${entry.reason}-${index}`}>
                    <span className="text-amber-300">{entry.reason}:</span> {entry.detail}
                  </li>
                ))}
                {report.skipped.length > 25 ? (
                  <li className="text-amber-300/80">
                    …and {report.skipped.length - 25} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
