import { posix as posixPath } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  SFTP_DOWNLOAD_IDLE_TIMEOUT_MS,
  SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS,
  SFTP_UPLOAD_TIMEOUT_MS,
} from "./backend-deadline.mjs";
import { resolveRemotePath, sanitizeFilename } from "./backend-paths.mjs";
import { sftpOperationFailure } from "./backend-sftp-failure.mjs";

// How long the listing waits for a link's target before giving up on it.
const LINK_TARGET_TIMEOUT_MS = 2_000;

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const LINK_TYPE = 0o120000;

export function isDirectory(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === DIRECTORY_TYPE;
  }

  return longname.startsWith("d");
}

export function isLink(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === LINK_TYPE;
  }

  return longname.startsWith("l");
}

export function formatPermissions(mode) {
  if (typeof mode !== "number") {
    return undefined;
  }

  return (mode & 0o777).toString(8).padStart(3, "0");
}

export function toIsoTimestamp(unixSeconds) {
  if (typeof unixSeconds !== "number" || Number.isNaN(unixSeconds)) {
    return undefined;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * What a link points at.
 *
 * A symlink's own mode says it is a link, not what it points at, so a
 * directory reached through one is listed as a file — and a file browser
 * then offers to download a directory it cannot read. The target is
 * resolved with one stat, and only for the links in a listing, which are
 * few.
 *
 * A link that points at nothing stays a file: there is no target to read,
 * and saying "directory" would send the user into a path that cannot be
 * opened.
 */
async function linkTargetIsDirectory(sftp, entryPath) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    // A target that never answers must not take the listing with it: the
    // link stays a file, and the listing is delivered.
    const timer = setTimeout(() => finish(false), LINK_TARGET_TIMEOUT_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }

    sftp.stat(entryPath, (error, stats) => {
      if (error || !stats) {
        finish(false);
        return;
      }
      finish(isDirectory(stats));
    });
  });
}

export function createSftpOperations({ withSftp }) {
  async function listRemoteDirectory(host, pathname) {
    return withSftp(host, async ({ sftp }) => {
      const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
      const entries = await new Promise((resolve, reject) => {
        sftp.readdir(targetPath, (error, list) => {
          if (error) {
            reject(sftpOperationFailure(error));
            return;
          }

          resolve(list ?? []);
        });
      });

      const visible = entries.filter(
        (entry) => entry.filename !== "." && entry.filename !== ".."
      );

      const mapped = [];
      for (const entry of visible) {
        const entryPath = resolveRemotePath(targetPath, entry.filename);
        const linked = isLink(entry.attrs, entry.longname);
        let kind = isDirectory(entry.attrs, entry.longname) ? "directory" : "file";
        if (linked && kind === "file") {
          // A link's own mode says it is a link, not what it points at, so a
          // directory reached through one would be listed as a file — and a
          // file browser would offer to download a directory it cannot read.
          kind = (await linkTargetIsDirectory(sftp, entryPath)) ? "directory" : "file";
        }

        mapped.push({
          name: entry.filename,
          path: entryPath,
          kind,
          size: entry.attrs?.size ?? 0,
          permissions: formatPermissions(entry.attrs?.mode),
          modifiedAt: toIsoTimestamp(entry.attrs?.mtime),
          linked,
        });
      }

      return {
        path: targetPath,
        entries: mapped.sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        }),
      };
    });
  }

  async function createRemoteDirectory(host, pathname) {
    return withSftp(host, async ({ sftp }) => {
      const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);

      await new Promise((resolve, reject) => {
        sftp.mkdir(targetPath, (error) => {
          if (error) {
            reject(sftpOperationFailure(error));
            return;
          }

          resolve();
        });
      });

      return targetPath;
    });
  }

  async function renameRemoteEntry(host, currentPath, nextPath) {
    return withSftp(host, async ({ sftp }) => {
      const sourcePath = resolveRemotePath(host.sftpRoot ?? "/", currentPath);
      const targetPath = resolveRemotePath(host.sftpRoot ?? "/", nextPath);

      await new Promise((resolve, reject) => {
        sftp.rename(sourcePath, targetPath, (error) => {
          if (error) {
            reject(sftpOperationFailure(error));
            return;
          }

          resolve();
        });
      });

      return targetPath;
    });
  }

  async function deleteRemoteEntry(host, pathname, isDirectoryEntry) {
    return withSftp(host, async ({ sftp }) => {
      const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);

      await new Promise((resolve, reject) => {
        const done = (error) => {
          if (error) {
            reject(sftpOperationFailure(error));
            return;
          }

          resolve();
        };

        if (isDirectoryEntry) {
          sftp.rmdir(targetPath, done);
        } else {
          sftp.unlink(targetPath, done);
        }
      });
    });
  }

  async function uploadRemoteFile(host, pathname, contentsBase64) {
    // #182: a TOTAL budget, not idle — sftp.write's single callback exposes no
    // incremental progress to reset against. Sized for the request cap in
    // backend-deadline.mjs.
    return withSftp(host, { timeoutMs: SFTP_UPLOAD_TIMEOUT_MS }, async ({ sftp, onTimeout }) => {
      const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
      const buffer = Buffer.from(contentsBase64, "base64");
      const handle = await new Promise((resolve, reject) => {
        sftp.open(targetPath, "w", (error, nextHandle) => {
          if (error) {
            reject(sftpOperationFailure(error));
            return;
          }

          resolve(nextHandle);
        });
      });

      // Best-effort, never awaited: a timeout must not leave a file handle open
      // on the remote. Guarded so it cannot race the normal close below, and the
      // channel/transport teardown that follows is the real guarantee.
      let closeStarted = false;
      onTimeout(() => {
        if (closeStarted) {
          return;
        }
        closeStarted = true;
        sftp.close(handle, () => {});
      });

      let writeError;
      try {
        await new Promise((resolve, reject) => {
          sftp.write(handle, buffer, 0, buffer.length, 0, (error) => {
            if (error) {
              reject(sftpOperationFailure(error));
              return;
            }

            resolve();
          });
        });
      } catch (error) {
        writeError = error;
      }

      // The handle is closed whatever happened. A close failure must not
      // REPLACE the write's failure: the write is the reason the upload
      // failed, and it is the reason the user needs. The close is only
      // reported when the write succeeded.
      closeStarted = true;
      const closeError = await new Promise((resolve) => {
        sftp.close(handle, (error) => resolve(error));
      }).catch((error) => {
        // A close that throws outright, rather than reporting a status, is
        // still a failure — but only when the write succeeded. When the write
        // already failed, the write's reason is the one that matters.
        if (!writeError) {
          throw error;
        }
        return undefined;
      });

      if (writeError) {
        throw writeError;
      }
      if (closeError) {
        throw sftpOperationFailure(closeError);
      }

      return targetPath;
    });
  }

  async function sendRemoteFile(response, host, pathname) {
    // #182: an IDLE deadline, so a large download that is slow but progressing is
    // not killed; only silence ends it.
    // #288: plus an absolute ceiling, because "not idle" is a bar a hostile or
    // broken peer clears by dripping one byte per interval forever. Idle bounds
    // silence; the ceiling bounds the transfer.
    await withSftp(
      host,
      {
        timeoutMs: SFTP_DOWNLOAD_IDLE_TIMEOUT_MS,
        totalTimeoutMs: SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS,
      },
      async ({ sftp, onTimeout, resetDeadline }) => {
        const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
        const fileStats = await new Promise((resolve, reject) => {
          sftp.stat(targetPath, (error, stats) => {
            if (error) {
              reject(sftpOperationFailure(error));
              return;
            }

            resolve(stats);
          });
        });
        resetDeadline();

        response.writeHead(200, {
          "Content-Disposition": `attachment; filename="${sanitizeFilename(posixPath.basename(targetPath))}"`,
          "Content-Length": String(fileStats.size ?? 0),
          "Content-Type": "application/octet-stream",
        });

        const readStream = sftp.createReadStream(targetPath);
        // Destroyed first so pipeline stops and the remote file handle starts
        // closing before the channel underneath it goes away.
        onTimeout(() => readStream.destroy());
        // Headers — including a Content-Length — are already committed, so the
        // status can no longer be replaced. DESTROY, never end(): end() asserts
        // the response completed normally against a length the body will not
        // reach, leaving the client to notice a framing violation and possibly
        // keeping the connection alive. Destroying aborts it, so the browser's
        // body read rejects and no truncated file reaches the save step.
        onTimeout(() => response.destroy());

        // What counts as progress. `data` is the remote supplying more body.
        // `drain` matters because pipeline pauses the SFTP readable while
        // response.write() applies backpressure — during that pause a slow but
        // alive HTTP consumer produces no `data` at all, and a data-only timer
        // would kill a healthy transfer.
        const onProgress = () => resetDeadline();
        readStream.on("open", onProgress);
        readStream.on("data", onProgress);
        response.on("drain", onProgress);

        try {
          await pipeline(readStream, response);
        } catch (error) {
          // A read failure is an SFTP status failure like any other (the file
          // can vanish between the stat and the open), so it is wrapped the
          // same way. The headers are already committed by this point, so the
          // client sees the transfer fail rather than the message — the stat
          // above is what catches the usual "no such file" before that.
          throw sftpOperationFailure(error);
        } finally {
          readStream.off("open", onProgress);
          readStream.off("data", onProgress);
          response.off("drain", onProgress);
        }
      }
    );
  }

  return {
    listRemoteDirectory,
    createRemoteDirectory,
    renameRemoteEntry,
    deleteRemoteEntry,
    uploadRemoteFile,
    sendRemoteFile,
  };
}
