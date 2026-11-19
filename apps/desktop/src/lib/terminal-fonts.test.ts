import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_FONT,
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_NAMES,
  TERMINAL_FONT_SIZES,
  isKnownTerminalFont,
  listTerminalFontOptions,
  resolveTerminalFontStack,
  resolveTerminalFontSize,
} from "./terminal-fonts";

// The parity matrix named the font picker as the last of the shell-preference
// gaps: the terminal had one hard-coded family and one hard-coded size, so
// these tests pin the resolution rules the picker relies on.

describe("terminal fonts", () => {
  it("keeps the font and size the terminal already used as the default", () => {
    expect(DEFAULT_TERMINAL_FONT).toBe("system-mono");
    expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(13);
    // The default stack is the one the terminal had before the picker.
    expect(resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)).toBe(
      '"SFMono-Regular", "Menlo", "Monaco", monospace'
    );
  });

  it("lists every font it knows, once each", () => {
    const options = listTerminalFontOptions();
    expect(options.map((option) => option.name)).toEqual([...TERMINAL_FONT_NAMES]);
    expect(new Set(options.map((option) => option.name)).size).toBe(options.length);
    for (const option of options) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.stack.length).toBeGreaterThan(0);
    }
  });

  it("gives every font a stack with a fallback behind it", () => {
    // A font that is not installed would otherwise render as nothing.
    for (const option of listTerminalFontOptions()) {
      expect(option.stack).toContain("monospace");
    }
  });

  it("falls back to the default stack for an inherited property name", () => {
    // "constructor" and "__proto__" are properties every object has, so a
    // lookup that does not check for an OWN property would hand the
    // terminal something that is not a font.
    expect(resolveTerminalFontStack("constructor")).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
    expect(resolveTerminalFontStack("__proto__")).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
    expect(resolveTerminalFontStack("toString")).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
  });

  it("falls back to the default stack for a font it does not know", () => {
    expect(resolveTerminalFontStack("not-a-font")).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
    expect(resolveTerminalFontStack(undefined)).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
    expect(resolveTerminalFontStack(42)).toBe(
      resolveTerminalFontStack(DEFAULT_TERMINAL_FONT)
    );
  });

  it("clamps a size to what a person can read", () => {
    expect(resolveTerminalFontSize(14)).toBe(14);
    expect(resolveTerminalFontSize(0)).toBe(MIN_TERMINAL_FONT_SIZE);
    expect(resolveTerminalFontSize(999)).toBe(MAX_TERMINAL_FONT_SIZE);
    expect(resolveTerminalFontSize(-4)).toBe(MIN_TERMINAL_FONT_SIZE);
    expect(resolveTerminalFontSize(Number.NaN)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
    expect(resolveTerminalFontSize(undefined)).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });

  it("offers sizes that are all readable", () => {
    for (const size of TERMINAL_FONT_SIZES) {
      expect(size).toBeGreaterThanOrEqual(MIN_TERMINAL_FONT_SIZE);
      expect(size).toBeLessThanOrEqual(MAX_TERMINAL_FONT_SIZE);
    }
  });

  it("knows which fonts it offers", () => {
    expect(isKnownTerminalFont("menlo")).toBe(true);
    expect(isKnownTerminalFont("not-a-font")).toBe(false);
    expect(isKnownTerminalFont(undefined)).toBe(false);
  });
});
