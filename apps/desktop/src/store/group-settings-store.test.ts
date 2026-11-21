import { describe, expect, it } from "vitest";

import {
  applyGroupSettings,
  groupSettingsFor,
  type GroupSettings,
} from "./group-settings-store";

// The parity matrix said the group surfaces carried "no inherited protocol
// settings yet", so every host in a group had to be given its own bastion,
// SFTP root and environment one at a time — and every one of them drifted.

describe("group settings", () => {
  const host = {
    username: "",
    jumpHostId: undefined,
    sftpRoot: "",
    environment: {},
  };

  it("supplies what the host does not set", () => {
    const applied = applyGroupSettings(host, {
      username: "ops",
      jumpHostId: "host-bastion",
      sftpRoot: "/srv/app",
      environment: { REGION: "eu-west-1" },
    });

    expect(applied.username).toBe("ops");
    expect(applied.jumpHostId).toBe("host-bastion");
    expect(applied.sftpRoot).toBe("/srv/app");
    expect(applied.environment).toEqual({ REGION: "eu-west-1" });
  });

  it("never overrides what the host sets itself", () => {
    const applied = applyGroupSettings(
      {
        username: "root",
        jumpHostId: "host-own-bastion",
        sftpRoot: "/home/root",
        environment: { REGION: "us-east-1" },
      },
      {
        username: "ops",
        jumpHostId: "host-group-bastion",
        sftpRoot: "/srv/app",
        environment: { REGION: "eu-west-1", TIER: "web" },
      }
    );

    expect(applied.username).toBe("root");
    expect(applied.jumpHostId).toBe("host-own-bastion");
    expect(applied.sftpRoot).toBe("/home/root");
    // The environment is merged per key: the host's own value wins, and the
    // group's other keys still come through.
    expect(applied.environment).toEqual({ REGION: "us-east-1", TIER: "web" });
  });

  it("changes nothing when the group says nothing", () => {
    expect(applyGroupSettings(host, undefined)).toBe(host);
    expect(applyGroupSettings(host, {})).toBe(host);
    expect(applyGroupSettings(host, { environment: {} })).toBe(host);
  });

  it("ignores a blank value in the group", () => {
    const applied = applyGroupSettings(host, { username: "   ", sftpRoot: "" });

    expect(applied.username).toBe("");
    expect(applied.sftpRoot).toBe("");
  });

  it("finds the settings for a host's group", () => {
    const settings: Record<string, GroupSettings> = {
      "Acme / Production": { username: "ops" },
    };

    expect(groupSettingsFor(settings, "Acme / Production")?.username).toBe("ops");
    expect(groupSettingsFor(settings, "Acme / Staging")).toBeUndefined();
    expect(groupSettingsFor(settings, undefined)).toBeUndefined();
    expect(groupSettingsFor(settings, "")).toBeUndefined();
  });
});
