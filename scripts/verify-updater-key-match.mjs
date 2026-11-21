// The bundle being released must trust the same updater public key that the
// release is signed and verified with.
//
// The updater's public key is compiled into the app, while the update feed is
// signed with the private key held in the release-signing environment. The
// bundle records the key it was built with, so a bundle built before a key
// rotation is caught here: signing such a bundle with the new key would
// publish a feed that the installed copies — which still trust the old key —
// reject, and an app updated through that feed would keep trusting the old
// key and reject every update after it.
import fs, { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readUpdaterPubkey(tauriConfPath) {
  const config = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  return config.plugins?.updater?.pubkey ?? "";
}

function shorten(pubkey) {
  return pubkey.length > 16 ? `${pubkey.slice(0, 16)}…` : pubkey;
}

export function assertUpdaterKeyMatches({ manifest, tauriConf }) {
  const builtPubkey = manifest?.updater?.pubkey ?? "";
  const currentPubkey = readUpdaterPubkey(tauriConf);

  if (!builtPubkey) {
    throw new Error(
      "The promoted bundle records no updater public key, so it predates the key record and cannot be released against the current key. Rebuild the bundle.",
    );
  }
  if (!currentPubkey) {
    throw new Error(`The updater public key is missing from ${tauriConf}.`);
  }
  if (builtPubkey !== currentPubkey) {
    throw new Error(
      `The promoted bundle trusts updater key ${shorten(builtPubkey)} but this checkout signs with ${shorten(currentPubkey)}. Rebuild the bundle before releasing it.`,
    );
  }

  return { pubkey: currentPubkey };
}

function parseArgs(argv) {
  const options = { manifest: "", tauriConf: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest") {
      options.manifest = argv[index + 1] ?? "";
      index += 1;
    } else if (argument === "--tauri-conf") {
      options.tauriConf = argv[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.manifest || !options.tauriConf) {
      throw new Error(
        "Usage: node verify-updater-key-match.mjs --manifest <path> --tauri-conf <path>",
      );
    }
    const manifest = JSON.parse(fs.readFileSync(options.manifest, "utf8"));
    const result = assertUpdaterKeyMatches({ manifest, tauriConf: options.tauriConf });
    console.log(`The promoted bundle trusts the updater key this checkout signs with (${shorten(result.pubkey)}).`);
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

// Whether this file is the program that was started. The comparison is on
// the real paths, so a script reached through a symlink, or through
// /proc/self/cwd, still matches: a URL comparison would not, and the guard
// would then exit successfully without having run — which is a silent pass
// for the release path this guard stands in.
function startedAsTheProgram() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (startedAsTheProgram()) {
  main();
}
