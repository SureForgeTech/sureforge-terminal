import { useMemo, useState } from "react";

import { cn } from "../lib/utils";
import { useHostsStore } from "../store/hosts-store";
import {
  useGroupSettingsStore,
  type GroupSettings,
} from "../store/group-settings-store";

// The settings a group of hosts shares.
//
// The parity matrix said the group surfaces carried "no inherited protocol
// settings yet": every host in a group had to be given its own bastion, SFTP
// root and environment, one host at a time. These are the DEFAULTS for a
// group — a host that sets one of them itself keeps its own value.

interface GroupSettingsSectionProps {
  className?: string;
}

export function GroupSettingsSection({ className }: GroupSettingsSectionProps) {
  const hosts = useHostsStore((state) => state.hosts);
  const groupSettings = useGroupSettingsStore((state) => state.groupSettings);
  const setGroupSettings = useGroupSettingsStore((state) => state.setGroupSettings);

  // The groups are the ones the hosts actually use, so the section never
  // shows a group nobody has a host in.
  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const host of hosts) {
      if (host.group) {
        seen.add(host.group);
      }
    }
    return [...seen].sort((left, right) => left.localeCompare(right));
  }, [hosts]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className={cn("rounded-[22px] border border-slate-800/80 bg-slate-950/45 p-4", className)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
        Group settings
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-400">
        Defaults for the hosts in a group: the sign-in name, the bastion, the SFTP root and the
        environment. A host that sets one of these itself keeps its own value, so nothing is
        overridden.
      </p>

      <div className="mt-3 grid gap-3">
        {groups.map((group) => (
          <GroupSettingsCard
            key={group}
            group={group}
            settings={groupSettings[group]}
            hostCount={hosts.filter((host) => host.group === group).length}
            onSave={(settings) => setGroupSettings(group, settings)}
          />
        ))}
      </div>
    </div>
  );
}

interface GroupSettingsCardProps {
  group: string;
  settings?: GroupSettings;
  hostCount: number;
  onSave: (settings: GroupSettings) => void;
}

function GroupSettingsCard({ group, settings, hostCount, onSave }: GroupSettingsCardProps) {
  const hosts = useHostsStore((state) => state.hosts);
  const [username, setUsername] = useState(settings?.username ?? "");
  const [jumpHostId, setJumpHostId] = useState(settings?.jumpHostId ?? "");
  const [sftpRoot, setSftpRoot] = useState(settings?.sftpRoot ?? "");
  const [environment, setEnvironment] = useState(() =>
    Object.entries(settings?.environment ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")
  );

  function save() {
    const parsedEnvironment: Record<string, string> = {};
    for (const line of environment.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const separator = trimmed.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      parsedEnvironment[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }

    onSave({
      username: username.trim() || undefined,
      jumpHostId: jumpHostId || undefined,
      sftpRoot: sftpRoot.trim() || undefined,
      environment: Object.keys(parsedEnvironment).length > 0 ? parsedEnvironment : undefined,
    });
  }

  return (
    <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-100">{group}</p>
        <p className="text-[11px] uppercase tracking-[0.14em] text-slate-500">
          {hostCount} {hostCount === 1 ? "host" : "hosts"}
        </p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Default user name
          <input
            type="text"
            value={username}
            placeholder="leave empty to use the host's own"
            onChange={(event) => setUsername(event.target.value)}
            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Default bastion
          <select
            value={jumpHostId}
            onChange={(event) => setJumpHostId(event.target.value)}
            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">leave empty to use the host's own</option>
            {hosts
              .filter((host) => host.protocol === "ssh")
              .map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label} ({host.hostname})
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Default SFTP root
          <input
            type="text"
            value={sftpRoot}
            placeholder="leave empty to use the host's own"
            onChange={(event) => setSftpRoot(event.target.value)}
            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Default environment
          <textarea
            value={environment}
            rows={3}
            placeholder={"REGION=eu-west-1\nTIER=web"}
            onChange={(event) => setEnvironment(event.target.value)}
            className="rounded-[10px] border border-slate-800 bg-slate-950/70 px-2 py-1.5 font-mono text-xs text-slate-100"
          />
        </label>
      </div>

      <button
        type="button"
        onClick={save}
        className="mt-3 rounded-[12px] border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-sm text-emerald-100 transition hover:border-emerald-300/60"
      >
        Save group settings
      </button>
    </div>
  );
}
