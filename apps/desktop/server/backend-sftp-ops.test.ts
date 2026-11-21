import { describe, expect, it, vi } from "vitest";
import { createSftpOperations } from "./backend-sftp-ops.mjs";

// A symlink's own mode says it is a link, not what it points at, so a
// directory reached through one was listed as a file — and a file browser
// then offered to download a directory it cannot read. The listing resolves
// the target of the links it finds, with one stat each.

describe("listing a remote directory", () => {
  const DIRECTORY = 0o040755;
  const FILE = 0o100644;
  const LINK = 0o120777;

  function setup(entries: Array<{ filename: string; mode: number; longname: string }>) {
    const stat = vi.fn((path: string, callback: (error: Error | null, stats?: unknown) => void) => {
      callback(null, { mode: path.endsWith("dir-link") ? DIRECTORY : FILE });
    });
    const readdir = vi.fn((_path: string, callback: (error: Error | null, list?: unknown[]) => void) => {
      callback(null, entries);
    });
    const sftp = { readdir, stat };
    const withSftp = vi.fn(async (_host: unknown, operation: (context: unknown) => unknown) =>
      operation({ sftp })
    );
    const operations = createSftpOperations({ withSftp });
    return { operations, readdir, stat };
  }

  it("lists a link to a directory as a directory", async () => {
    const { operations, stat } = setup([
      { filename: "dir-link", mode: LINK, longname: "lrwxrwxrwx 1 o o 0 Jan 1 00:00 dir-link -> /srv/app" },
    ]);

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/" },
      "/"
    );

    expect(listing.entries[0]?.kind).toBe("directory");
    expect(listing.entries[0]?.linked).toBe(true);
    // One stat, for the link.
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it("lists a link to a file as a file", async () => {
    const { operations } = setup([
      { filename: "file-link", mode: LINK, longname: "lrwxrwxrwx 1 o o 0 Jan 1 00:00 file-link -> /srv/notes.txt" },
    ]);

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/" },
      "/"
    );

    expect(listing.entries[0]?.kind).toBe("file");
    expect(listing.entries[0]?.linked).toBe(true);
  });

  it("lists a broken link as a file", async () => {
    const { operations, stat } = setup([
      { filename: "broken-link", mode: LINK, longname: "lrwxrwxrwx 1 o o 0 Jan 1 00:00 broken-link -> /gone" },
    ]);
    stat.mockImplementation((_path, callback) => {
      callback(new Error("No such file"));
    });

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/" },
      "/"
    );

    expect(listing.entries[0]?.kind).toBe("file");
  });

  it("delivers the listing when a link's target never answers", async () => {
    // A target that never answers must not take the listing with it: the
    // link stays a file, and the listing is delivered.
    const { operations, stat } = setup([
      { filename: "slow-link", mode: LINK, longname: "lrwxrwxrwx 1 o o 0 Jan 1 00:00 slow-link -> /srv/app" },
    ]);
    stat.mockImplementation(() => {
      // Never calls back.
    });

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/" },
      "/"
    );

    expect(listing.entries[0]?.kind).toBe("file");
    expect(listing.entries[0]?.linked).toBe(true);
  });

  it("leaves the rest of a listing as it was", async () => {
    // The kind of a link is resolved; nothing else about an entry changes.
    const { operations } = setup([
      { filename: "app", mode: DIRECTORY, longname: "drwxr-xr-x 2 o o 40 Jan 1 00:00 app" },
      { filename: "notes.txt", mode: FILE, longname: "-rw-r--r-- 1 o o 12 Jan 1 00:00 notes.txt" },
      { filename: "z-link", mode: LINK, longname: "lrwxrwxrwx 1 o o 0 Jan 1 00:00 z-link -> /srv/notes.txt" },
    ]);

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/srv" },
      "/"
    );

    // The path is resolved against the host's SFTP root, as it always was.
    expect(listing.path).toBe("/");
    expect(listing.entries.map((entry) => entry.name)).toEqual(["app", "notes.txt", "z-link"]);
    expect(listing.entries.map((entry) => entry.kind)).toEqual(["directory", "file", "file"]);
    expect(listing.entries.map((entry) => entry.path)).toEqual([
      "/app",
      "/notes.txt",
      "/z-link",
    ]);
    expect(listing.entries.map((entry) => entry.linked)).toEqual([false, false, true]);
  });

  it("does not stat an entry that is not a link", async () => {
    const { operations, stat } = setup([
      { filename: "notes.txt", mode: FILE, longname: "-rw-r--r-- 1 o o 12 Jan 1 00:00 notes.txt" },
      { filename: "app", mode: DIRECTORY, longname: "drwxr-xr-x 2 o o 40 Jan 1 00:00 app" },
    ]);

    const listing = await operations.listRemoteDirectory(
      { hostname: "example.test", sftpRoot: "/" },
      "/"
    );

    expect(listing.entries.map((entry) => entry.kind).sort()).toEqual(["directory", "file"]);
    expect(stat).not.toHaveBeenCalled();
  });
});
