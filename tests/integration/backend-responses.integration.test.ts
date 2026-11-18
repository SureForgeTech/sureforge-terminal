import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { PayloadTooLargeError } from "../../apps/desktop/server/backend-buffers.mjs";
import { HostKeyRejectedError } from "../../apps/desktop/server/backend-host-keys.mjs";
import {
  HTTP_ERROR_DIAGNOSTIC_CHANNEL,
  respondError,
} from "../../apps/desktop/server/backend-responses.mjs";

// #230 / CodeQL alert 18 (js/stack-trace-exposure). `respondError` used to
// serialize `Error.message` straight into the HTTP body, so raw ssh2 and fs
// text — which routinely carries absolute filesystem paths — reached the
// client. These tests pin the replacement contract: the STATUS still comes from
// the error where it carries one, the MESSAGE never does.
//
// They import from backend-responses.mjs rather than backend.mjs because
// importing backend.mjs binds a port.

/** Minimal ServerResponse stand-in — records what actually went on the wire. */
function recordingResponse() {
  const recorded: { status?: number; headers?: unknown; body?: string } = {};
  return {
    recorded,
    writeHead(status: number, headers: unknown) {
      recorded.status = status;
      recorded.headers = headers;
    },
    end(body: string) {
      recorded.body = body;
    },
  };
}

describe("#230: respondError does not relay internal error text", () => {
  it("keeps a sentinel from an internal Error.message out of the response body", () => {
    // If this string ever appears in a body again, the leak is back.
    const sentinel = "TS_RESPOND_ERROR_PROBE_4f81ac0e935d";
    const response = recordingResponse();

    respondError(response, new Error(`connect ECONNREFUSED ${sentinel}`));

    expect(response.recorded.body).toBeDefined();
    expect(response.recorded.body).not.toContain(sentinel);
  });

  it("returns a non-revealing 500 for a generic internal error", () => {
    const response = recordingResponse();

    respondError(response, new Error("EACCES: permission denied, open '/Users/someone/.ssh/id_ed25519'"));

    expect(response.recorded.status).toBe(500);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Internal server error." });
  });

  it("relays a refused host key's reason, and only that reason", () => {
    // A refused host key is the one failure whose reason the user has to act
    // on: the difference between "the host is unreachable" and "the key
    // changed". Its message is built by the error itself from the host label
    // and a fixed explanation, so relaying it does not reopen the leak the
    // tests above pin shut.
    const response = recordingResponse();

    respondError(
      response,
      new HostKeyRejectedError("Host key verification failed for gateway.internal:22."),
    );

    expect(response.recorded.status).toBe(403);
    expect(JSON.parse(response.recorded.body!)).toEqual({
      error: "Host key verification failed for gateway.internal:22.",
    });
  });

  it("still refuses to relay a look-alike error that is not a host-key rejection", () => {
    // The exception is by TYPE, not by message: anything that merely looks
    // like one is still sanitised.
    const sentinel = "TS_HOST_KEY_LOOKALIKE_PROBE_7c1e4b";
    const impostor = new Error(`Host key verification failed for ${sentinel}`);
    Object.assign(impostor, { statusCode: 403 });
    const response = recordingResponse();

    respondError(response, impostor);

    expect(response.recorded.body).not.toContain(sentinel);
  });

  it("keeps the glob endpoint's refusal a 400, without the paths it names", () => {
    // The literal shape globSshConfigFiles throws. It is application-authored
    // and still leaks two absolute paths, which is why provenance is not used
    // as a safety signal.
    const response = recordingResponse();
    const error = new Error(
      "glob directory /Users/someone/.ssh/conf.d is not under /Users/someone/.ssh"
    );

    respondError(response, error, 400);

    expect(response.recorded.status).toBe(400);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Invalid request." });
    expect(response.recorded.body).not.toContain("/Users/someone");
  });

  it("still tells a 413 caller what the byte limit was", () => {
    const response = recordingResponse();

    respondError(response, new PayloadTooLargeError(64 * 1024 * 1024));

    expect(response.recorded.status).toBe(413);
    expect(JSON.parse(response.recorded.body!).error).toContain("67108864");
  });

  it("does not mistake a look-alike for a PayloadTooLargeError", () => {
    // A plain error carrying statusCode 413 gets the status but not the
    // reconstructed message — the limit has to come from the typed error.
    const response = recordingResponse();
    const impostor = Object.assign(new Error("nice try /etc/passwd"), {
      statusCode: 413,
      limit: 42,
    });

    respondError(response, impostor);

    expect(response.recorded.status).toBe(413);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Invalid request." });
  });

  it("publishes the raw error server-side while withholding it from the client", () => {
    const sentinel = "TS_DIAGNOSTIC_PROBE_7c02be14a6f9";
    const seen: Array<{ error?: Error; statusCode?: number }> = [];
    const onError = (message: unknown) => {
      seen.push(message as { error?: Error; statusCode?: number });
    };

    subscribe(HTTP_ERROR_DIAGNOSTIC_CHANNEL, onError);
    try {
      const response = recordingResponse();
      respondError(response, new Error(sentinel), 400);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.error?.message).toBe(sentinel);
      expect(seen[0]?.statusCode).toBe(400);
      expect(response.recorded.body).not.toContain(sentinel);
    } finally {
      unsubscribe(HTTP_ERROR_DIAGNOSTIC_CHANNEL, onError);
    }
  });
});

describe("a failed connection is reported with a code and a reason", () => {
  it("relays the reason and the category, and nothing of the underlying error", async () => {
    // Every SSH failure reached the client as "Internal server error.", which
    // names no cause. The reason a host could not be reached is the reason
    // the user has to act on, so the backend sends it — built from fixed text
    // and the host label — beside the category the client branches on. The
    // underlying ssh2 error stays on the server.
    const { SshConnectError, SSH_FAILURE_CODES } = await import(
      "../../apps/desktop/server/backend-ssh-failure.mjs"
    );
    const sentinel = "TS_SSH_CONNECT_PROBE_2b7e91";
    const response = recordingResponse();

    respondError(
      response,
      new SshConnectError("gateway.internal:22 refused the sign-in. Check the username.", {
        code: SSH_FAILURE_CODES.authFailed,
        cause: new Error(`All configured authentication methods failed ${sentinel}`),
      }),
    );

    expect(response.recorded.status).toBe(502);
    expect(JSON.parse(response.recorded.body!)).toEqual({
      error: "gateway.internal:22 refused the sign-in. Check the username.",
      code: "auth_failed",
    });
    // The underlying error text is still not relayed.
    expect(response.recorded.body).not.toContain(sentinel);
  });

  it("refuses to relay a look-alike that is not a connection failure", async () => {
    const { SSH_FAILURE_CODES } = await import(
      "../../apps/desktop/server/backend-ssh-failure.mjs"
    );
    const sentinel = "TS_SSH_CONNECT_LOOKALIKE_PROBE_5c1a44";
    const impostor = Object.assign(new Error(`refused the sign-in ${sentinel}`), {
      statusCode: 502,
      code: SSH_FAILURE_CODES.authFailed,
    });
    const response = recordingResponse();

    respondError(response, impostor);

    expect(response.recorded.body).not.toContain(sentinel);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Internal server error." });
  });

  it("relays a refused file operation's reason, and only that reason", async () => {
    // "Permission denied" and "No such file" are the two failures a user
    // meets most, and both used to arrive as "Internal server error.".
    const { SftpOperationError, SFTP_STATUS } = await import(
      "../../apps/desktop/server/backend-sftp-failure.mjs"
    );
    const sentinel = "TS_SFTP_RELAY_PROBE_7a1c44";
    const response = recordingResponse();

    respondError(
      response,
      new SftpOperationError("The server refused access to that path.", {
        statusCode: 403,
        cause: new Error(`Permission denied: ${sentinel}`),
      })
    );

    expect(response.recorded.status).toBe(403);
    expect(JSON.parse(response.recorded.body!)).toEqual({
      error: "The server refused access to that path.",
    });
    // The server's own wording is still not relayed.
    expect(response.recorded.body).not.toContain(sentinel);
    expect(SFTP_STATUS.permissionDenied).toBe(3);
  });

  it("still refuses to relay a look-alike that is not a file-operation failure", async () => {
    const { SFTP_STATUS } = await import(
      "../../apps/desktop/server/backend-sftp-failure.mjs"
    );
    const sentinel = "TS_SFTP_LOOKALIKE_PROBE_9d3b21";
    const impostor = Object.assign(new Error(`refused access ${sentinel}`), {
      statusCode: 403,
      code: SFTP_STATUS.permissionDenied,
    });
    const response = recordingResponse();

    respondError(response, impostor);

    // The exception is by TYPE: the look-alike gets the generic text for the
    // status it carries, and none of its own wording.
    expect(response.recorded.body).not.toContain(sentinel);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Invalid request." });
  });

  it("relays a refused forward request's reason, and only that reason", async () => {
    const { InvalidForwardRequestError } = await import(
      "../../apps/desktop/server/backend-forwards.mjs"
    );
    const sentinel = "TS_FORWARD_RELAY_PROBE_2f6b70";
    const response = recordingResponse();

    respondError(
      response,
      new InvalidForwardRequestError("Local bind port must be 0 (automatic) or 1-65535")
    );

    expect(response.recorded.status).toBe(400);
    expect(JSON.parse(response.recorded.body!)).toEqual({
      error: "Local bind port must be 0 (automatic) or 1-65535",
    });
    expect(response.recorded.body).not.toContain(sentinel);
  });

  it("classifies the ssh2 failures into the categories the client knows", async () => {
    const { sshConnectFailure, SSH_FAILURE_CODES } = await import(
      "../../apps/desktop/server/backend-ssh-failure.mjs"
    );
    const host = { hostname: "gateway.internal", port: 22 };

    const refused = sshConnectFailure(
      Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:22"), {
        level: "client-socket",
        code: "ECONNREFUSED",
      }),
      host,
    );
    expect(refused.code).toBe(SSH_FAILURE_CODES.refused);

    const dns = sshConnectFailure(
      Object.assign(new Error("Error while looking up IPv4 address"), { level: "client-dns" }),
      host,
    );
    expect(dns.code).toBe(SSH_FAILURE_CODES.dnsFailure);

    const auth = sshConnectFailure(
      Object.assign(new Error("All configured authentication methods failed"), {
        level: "client-authentication",
      }),
      host,
    );
    expect(auth.code).toBe(SSH_FAILURE_CODES.authFailed);

    const timeout = sshConnectFailure(
      Object.assign(new Error("Timed out while waiting for handshake"), { level: "client-timeout" }),
      host,
    );
    expect(timeout.code).toBe(SSH_FAILURE_CODES.timeout);
  });

  it("keeps a refused sign-in out of the retry path", async () => {
    // A refused sign-in must not be retried: repeated failed logins can lock
    // the account. The client's classifier reads the code, so the category
    // survives the fixed message.
    const { sshConnectFailure, SSH_FAILURE_CODES } = await import(
      "../../apps/desktop/server/backend-ssh-failure.mjs"
    );
    const { classifySshError } = await import(
      "../../apps/desktop/src/lib/ssh-error-classifier"
    );
    const { shouldScheduleReconnect } = await import(
      "../../apps/desktop/src/components/terminal/connect-failure-policy"
    );

    const failure = sshConnectFailure(
      Object.assign(new Error("All configured authentication methods failed"), {
        level: "client-authentication",
      }),
      { hostname: "gateway.internal", port: 22 },
    );
    expect(failure.code).toBe(SSH_FAILURE_CODES.authFailed);

    const classified = classifySshError(
      Object.assign(new Error(failure.message), { code: failure.code }),
    );
    expect(classified.category).toBe("auth_failed");
    expect(
      shouldScheduleReconnect(classified.category, {
        connectedOnce: true,
        reconnectOnRestore: true,
      }),
    ).toBe(false);
  });
});

describe("#230: the surrounding contract is unchanged", () => {
  it("leaves the WebSocket failSession diagnostics carrying the real message", async () => {
    // Sanitizing getErrorMessage would have been the easy fix and would have
    // blinded the terminal error surface. Source-contract test because
    // importing backend.mjs binds a port.
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain("function getErrorMessage(error) {\n  return error instanceof Error ? error.message : String(error);\n}");
    // The message that goes out on the wire is the real one. It is also
    // remembered on the session, so a websocket that attaches after the
    // failure is replayed it rather than being told nothing.
    expect(source).toMatch(/session\.failureMessage = getErrorMessage\(error\);/);
    expect(source).toMatch(/function failSession\(session, error\) \{[\s\S]*?message: session\.failureMessage,/);
  });

  it("still routes the glob endpoint's refusal through an explicit 400", async () => {
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain("respondError(response, error, 400);");
  });

  it("no longer defines respondError locally in backend.mjs", async () => {
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain('from "./backend-responses.mjs"');
    expect(source).not.toMatch(/^function respondError\(/m);
    expect(source).not.toMatch(/^function sendJson\(/m);
  });
});
