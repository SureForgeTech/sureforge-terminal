// Settings a group of hosts shares.
//
// The parity matrix says the group, tag and filter surfaces are implemented
// but that they carry "no inherited protocol settings yet" — so every host
// in a group had to be given its own bastion, its own SFTP root and its own
// environment, one host at a time, and every one of them drifted.
//
// A group's settings are DEFAULTS: a host keeps its own value where it has
// one, and takes the group's where it does not. Nothing is overwritten, so a
// host that needs its own bastion still has one.

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { createMigratingLocalStorage } from "../lib/persistence";

/**
 * The settings a group can supply.
 *
 * Every field is optional, and an absent field means "this group says
 * nothing about it" — not "this group says the default".
 */
export interface GroupSettings {
  /** The default sign-in name for hosts in the group. */
  username?: string;
  /** The default bastion for hosts in the group. */
  jumpHostId?: string;
  /** The default SFTP root for hosts in the group. */
  sftpRoot?: string;
  /** The default environment for hosts in the group, merged per key. */
  environment?: Record<string, string>;
}

interface GroupSettingsState {
  groupSettings: Record<string, GroupSettings>;
  setGroupSettings: (group: string, settings: GroupSettings) => void;
  clearGroupSettings: (group: string) => void;
}

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useGroupSettingsStore = create<GroupSettingsState>()(
  persist(
    (set) => ({
      groupSettings: {},
      setGroupSettings: (group, settings) =>
        set((state) => ({
          groupSettings: {
            ...state.groupSettings,
            [group]: settings,
          },
        })),
      clearGroupSettings: (group) =>
        set((state) => {
          const next = { ...state.groupSettings };
          delete next[group];
          return { groupSettings: next };
        }),
    }),
    {
      name: "terminal-workspace-group-settings",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : createMigratingLocalStorage()
      ),
      partialize: (state) => ({ groupSettings: state.groupSettings }),
    }
  )
);

/**
 * The settings a group supplies, for a host in that group.
 *
 * A host with no group, or a group with no settings, inherits nothing.
 */
export function groupSettingsFor(
  groupSettings: Record<string, GroupSettings>,
  group: string | undefined
): GroupSettings | undefined {
  if (!group) {
    return undefined;
  }
  return groupSettings[group];
}

/**
 * Apply a group's settings to a host that has not set those things itself.
 *
 * The host's own value always wins where it has one:
 *
 * - a username the host carries is kept, an empty one is inherited;
 * - a bastion the host names is kept, an unset one is inherited;
 * - an SFTP root the host carries is kept, an empty one is inherited;
 * - the environment is merged per key, so a host can override one variable
 *   and inherit the rest.
 */
export function applyGroupSettings<
  T extends {
    username: string;
    jumpHostId?: string;
    sftpRoot: string;
    environment: Record<string, string>;
  }
>(host: T, settings: GroupSettings | undefined): T {
  if (!settings) {
    return host;
  }

  const username = host.username.trim() ? host.username : settings.username?.trim() || host.username;
  const jumpHostId = host.jumpHostId ?? settings.jumpHostId;
  const sftpRoot = host.sftpRoot.trim() ? host.sftpRoot : settings.sftpRoot?.trim() || host.sftpRoot;
  const environment =
    settings.environment && Object.keys(settings.environment).length > 0
      ? { ...settings.environment, ...host.environment }
      : host.environment;

  if (
    username === host.username &&
    jumpHostId === host.jumpHostId &&
    sftpRoot === host.sftpRoot &&
    environment === host.environment
  ) {
    return host;
  }

  return { ...host, username, jumpHostId, sftpRoot, environment };
}
