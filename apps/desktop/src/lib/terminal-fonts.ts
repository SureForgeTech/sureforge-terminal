// The terminal's font.
//
// The parity matrix names the font picker as the last of the shell-preference
// gaps ("the remaining gap is the font picker (font family + size)"), and it
// was a real one: the terminal used one hard-coded family and one hard-coded
// size, so a user whose font was not in the stack — or whose screen needed a
// different size — had no way to change it.
//
// A font family is a CSS font stack: xterm.js takes the same string a browser
// would, so the options are the fonts a person already has on the machine,
// each with sensible fallbacks behind it.

/** The font families the picker offers. */
export const TERMINAL_FONT_NAMES = [
  "system-mono",
  "sf-mono",
  "menlo",
  "monaco",
  "jetbrains-mono",
  "fira-code",
  "source-code-pro",
  "cascadia-code",
  "ubuntu-mono",
  "consolas",
] as const;

export type TerminalFontName = (typeof TERMINAL_FONT_NAMES)[number];

/**
 * The default: the stack the terminal already used, so a user who changes
 * nothing sees exactly what they saw before.
 */
export const DEFAULT_TERMINAL_FONT: TerminalFontName = "system-mono";

/** The default size, which is the size the terminal already used. */
export const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** The sizes the picker offers, in points. */
export const TERMINAL_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20] as const;

export type TerminalFontSize = (typeof TERMINAL_FONT_SIZES)[number];

/** The smallest and largest size a user may pick. */
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

interface TerminalFontEntry {
  label: string;
  /** The CSS font stack xterm.js is given. */
  stack: string;
}

const fonts: Record<TerminalFontName, TerminalFontEntry> = {
  "system-mono": {
    label: "System monospace",
    stack: '"SFMono-Regular", "Menlo", "Monaco", monospace',
  },
  "sf-mono": {
    label: "SF Mono",
    stack: '"SF Mono", "SFMono-Regular", "Menlo", "Monaco", monospace',
  },
  menlo: {
    label: "Menlo",
    stack: 'Menlo, "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  monaco: {
    label: "Monaco",
    stack: 'Monaco, "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  "fira-code": {
    label: "Fira Code",
    stack: '"Fira Code", "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  "source-code-pro": {
    label: "Source Code Pro",
    stack: '"Source Code Pro", "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  "cascadia-code": {
    label: "Cascadia Code",
    stack: '"Cascadia Code", "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  "ubuntu-mono": {
    label: "Ubuntu Mono",
    stack: '"Ubuntu Mono", "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
  consolas: {
    label: "Consolas",
    stack: 'Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace',
  },
};

export interface TerminalFontOption {
  name: TerminalFontName;
  label: string;
  stack: string;
}

/**
 * The font families the picker offers, in the order it lists them.
 */
export function listTerminalFontOptions(): TerminalFontOption[] {
  return TERMINAL_FONT_NAMES.map((name) => ({
    name,
    label: fonts[name].label,
    stack: fonts[name].stack,
  }));
}

/**
 * The CSS font stack for a font name.
 *
 * An unknown name falls back to the default stack, so a persisted value from
 * a future version (or a hand-edited one) cannot leave the terminal with no
 * font at all.
 */
export function resolveTerminalFontStack(name: unknown): string {
  // An OWN property only: `name in fonts` would also find the inherited
  // ones, so "constructor" or "__proto__" would resolve to something that is
  // not a font at all.
  if (typeof name === "string" && Object.prototype.hasOwnProperty.call(fonts, name)) {
    return fonts[name as TerminalFontName].stack;
  }
  return fonts[DEFAULT_TERMINAL_FONT].stack;
}

/**
 * Whether a value names a font the picker offers.
 */
export function isKnownTerminalFont(value: unknown): value is TerminalFontName {
  return typeof value === "string" && (TERMINAL_FONT_NAMES as readonly string[]).includes(value);
}

/**
 * The size to use, clamped to what the terminal can render.
 *
 * A size outside the range is not a size a person can read, so it is clamped
 * rather than refused: a persisted value from a future version must not leave
 * the terminal unreadable.
 */
export function resolveTerminalFontSize(value: unknown): number {
  const size = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)));
}
