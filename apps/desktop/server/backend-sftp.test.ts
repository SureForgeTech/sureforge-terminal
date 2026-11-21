import { describe, expect, it, vi } from "vitest";
import { createWithSftp } from "./backend-sftp.mjs";
import {
  isSftpSubsystemUnavailable,
  sftpSubsystemUnavailableFailure,
} from "./backend-sftp-failure.mjs";

// A server that does not offer the SFTP subsystem fails the request with
// its own wording, and that wording is text from the far end — which #230
// does not let reach a client. The refusal is recognised and turned into
// fixed text that names the cause, the way every other SFTP failure is.

describe("the SFTP subsystem", () => {
  function setup(sftpError: Error) {
    const client = {
      end: vi.fn(),
      sftp: vi.fn((callback: (error: Error, handle?: unknown) => void) => {
        callback(sftpError);
      }),
    };
    const connectClient = vi.fn(async () => client);
    const withSftp = createWithSftp({
      connectClient,
      withDeadline: vi.fn(async (_timeoutMs: number, operation: (context: unknown) => unknown) =>
        operation({ onTimeout: vi.fn(), resetDeadline: vi.fn() }),
      ),
    });
    return { connectClient, withSftp };
  }

  it("names a server that does not offer the subsystem", async () => {
    const { withSftp } = setup(new Error("Unable to start subsystem: sftp"));

    const failure = await withSftp(
      { hostname: "example.test" },
      { timeoutMs: 1_000 },
      async () => "never reached"
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "That server does not offer the SFTP subsystem, so its files cannot be browsed."
    );
    expect((failure as { statusCode?: number }).statusCode).toBe(501);
  });

  it("leaves a failure that is not the subsystem alone", async () => {
    const { withSftp } = setup(new Error("All configured authentication methods failed"));

    const failure = await withSftp(
      { hostname: "example.test" },
      { timeoutMs: 1_000 },
      async () => "never reached"
    ).catch((error: unknown) => error);

    expect((failure as Error).message).toBe("All configured authentication methods failed");
  });

  it("leaves a transport failure that mentions a subsystem alone", async () => {
    const { withSftp } = setup(new Error("Connection reset while negotiating subsystem"));

    const failure = await withSftp(
      { hostname: "example.test" },
      { timeoutMs: 1_000 },
      async () => "never reached"
    ).catch((error: unknown) => error);

    expect((failure as Error).message).toBe("Connection reset while negotiating subsystem");
  });

  it("recognises the refusal and not another failure", () => {
    expect(isSftpSubsystemUnavailable(new Error("Unable to start subsystem: sftp"))).toBe(true);
    expect(isSftpSubsystemUnavailable(new Error("Connection timed out"))).toBe(false);
    expect(isSftpSubsystemUnavailable(undefined)).toBe(false);
  });

  it("does not call a transport failure a refused subsystem", () => {
    // A temporary failure whose text mentions a subsystem is not proof that
    // the server has no SFTP, and the channel-open description comes from
    // the far end — so neither is matched.
    for (const message of [
      "Connection reset while negotiating subsystem",
      "(SSH) Channel open failure: subsystem temporarily unavailable",
    ]) {
      expect(isSftpSubsystemUnavailable(new Error(message))).toBe(false);
    }
  });

  it("keeps the server's own wording as the cause", () => {
    const cause = new Error("Unable to start subsystem: sftp");
    const failure = sftpSubsystemUnavailableFailure(cause);

    expect(failure.cause).toBe(cause);
    expect(failure.message).not.toContain("subsystem: sftp");
  });
});
