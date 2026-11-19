// Keep secrets out of the session history.
//
// The history keeps a preview of what a command printed, and that preview is
// persisted across relaunches (see the roadmap: "persisted output previews
// improve search and replay evidence, but they can still retain sensitive
// command results until explicit redaction and sensitivity controls exist").
//
// A command that prints a token, a password, or an API key leaves it in the
// history — in the preview, and in the local storage the preview is written
// to. This module is the redaction: it masks the shapes that are secrets by
// construction, so the history can be kept without keeping the secret.
//
// The rules are deliberately conservative: a pattern that is not a secret is
// not masked, because a history that hides everything is a history nobody
// can search. Each rule is anchored to something that cannot be a false
// positive by accident — a named secret, a credential in an assignment, a
// token with a recognisable prefix.

/** What a redacted value is replaced with. */
export const REDACTION_PLACEHOLDER = "[redacted]";

// The words a secret is usually stored under.
//
// The comparison is against the WORDS of a name, not against the name as a
// whole: "accessToken" is a secret and "tokenizer" is not, and the only
// difference is the word boundary. A plural counts ("secrets", "tokens",
// "passwords"), and the match is case-insensitive.
const SECRET_WORDS = new Set([
  "password",
  "passwd",
  "pass",
  "passphrase",
  "secret",
  "token",
  "credential",
  "auth",
  "apikey",
  "accesskey",
  "privatekey",
]);

// A name that pairs a qualifier with "key" is a secret: "apiKey",
// "accessKey", "privateKey". A bare "key" is NOT — "key=value" is far more
// often a lookup than a credential.
const SECRET_KEY_QUALIFIERS = new Set([
  "api",
  "access",
  "private",
  "client",
  "signing",
  "encryption",
  "ssh",
]);

// KEY=value, "key": "value", key: value — the name is captured on its own so
// it can be checked word by word, and the separator is captured so the
// replacement keeps the shape of the text.
// The name is bounded: an unbounded one is QUADRATIC on a long line of
// output (the engine tries every name length at every position), and a
// 70 kB base64 blob would take seconds to redact.
const ASSIGNMENT_PATTERN =
  /(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]{0,63})\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/g;

// Well-known token shapes. Each is long enough and specific enough that a
// false positive is very unlikely.
const TOKEN_PATTERNS: RegExp[] = [
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // GitHub fine-grained personal access tokens.
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  // GitLab tokens.
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  // Slack tokens.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // JSON web tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // A private key block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // A private key block that has NOT ended yet: the closed-block pattern
  // cannot match it, so its body would sit in the preview unhidden until
  // the block ends. It runs after the closed pattern, so a finished block
  // is already gone by then.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*$/g,
];

/**
 * The words of a name.
 *
 * "AWS_SECRET_ACCESS_KEY" becomes [aws, secret, access, key], "accessToken"
 * becomes [access, token], and "api-key" becomes [api, key]. The separators
 * are `-`, `_`, `.` and the case change in a camelCase name.
 */
export function secretNameWords(name: string): string[] {
  return name
    .replace(/^["']|["']$/g, "")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((chunk) => chunk.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function isSecretWord(word: string): boolean {
  if (SECRET_WORDS.has(word)) {
    return true;
  }
  // A plural is the same word.
  if (word.length > 3 && word.endsWith("s")) {
    return SECRET_WORDS.has(word.slice(0, -1));
  }
  return false;
}

function singular(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * Whether a name is one a secret is stored under.
 *
 * The name is split into words and checked: a secret word anywhere in it
 * makes it a secret name, and so does a qualified "key" ("apiKey").
 */
export function isSecretName(name: string): boolean {
  const words = secretNameWords(name);

  for (const word of words) {
    if (isSecretWord(word)) {
      return true;
    }
  }

  for (let index = 0; index + 1 < words.length; index += 1) {
    if (words[index + 1] !== "key" && words[index + 1] !== "keys") {
      continue;
    }
    if (SECRET_KEY_QUALIFIERS.has(singular(words[index]))) {
      return true;
    }
  }

  return false;
}

/**
 * Mask the secrets in a piece of text.
 *
 * A masked value is replaced with a fixed placeholder, so the shape of the
 * output changes. That is the point: the history must not be able to give
 * the secret back.
 */
export function redactSecrets(text: string): string {
  if (!text) {
    return text;
  }

  let redacted = text.replace(
    ASSIGNMENT_PATTERN,
    (
      match: string,
      quote: string,
      name: string,
      separator: string,
      value: string
    ) => {
      if (!isSecretName(name)) {
        return match;
      }

      const inner = value.startsWith('"')
        ? value.slice(1, -1)
        : value.startsWith("'")
          ? value.slice(1, -1)
          : value;
      // An empty value is not a secret, and neither is one that is already
      // the placeholder.
      if (!inner || inner === REDACTION_PLACEHOLDER) {
        return match;
      }

      const valueQuote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
      return `${quote}${name}${quote}${separator}${valueQuote}${REDACTION_PLACEHOLDER}${valueQuote}`;
    }
  );

  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTION_PLACEHOLDER);
  }

  return redacted;
}

/**
 * Whether a piece of text looks like it holds a secret.
 *
 * Used to tell the user that a preview was redacted, rather than leaving
 * them to wonder why a command's output looks odd.
 */
export function containsSecret(text: string): boolean {
  if (!text) {
    return false;
  }
  return redactSecrets(text) !== text;
}

// The escape codes a terminal writes around its output, and the bell.
const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
const TERMINAL_BELL_CHARACTER = String.fromCharCode(7);
const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(
  `${ANSI_ESCAPE_CHARACTER}\\[[0-9;?]*[ -/]*[@-~]`,
  "g"
);
const TERMINAL_BELL_REGEX = new RegExp(TERMINAL_BELL_CHARACTER, "g");

// An escape sequence that has not finished arriving.
//
// A colour code can split a name — "pass" + ESC + "word" — and a name that
// is split cannot be recognised, so an unfinished sequence is carried into
// the next piece of output and the text in front of it is held until the
// sequence completes.
const INCOMPLETE_ESCAPE_TAIL_REGEX = new RegExp(
  `${ANSI_ESCAPE_CHARACTER}(?:\\[[0-9;?]*[ -/]*)?$`
);

/** How much of the redacted output the preview keeps. */
export const REDACTED_PREVIEW_LIMIT = 600;

// A private key block, open or closed.
const PRIVATE_KEY_BEGIN = "-----BEGIN";
const PRIVATE_KEY_END = "-----END";

// How much of a key block's body is kept while the block is open: enough to
// recognise an END marker that arrives in two pieces.
const PRIVATE_KEY_MARKER_KEEP = 64;

// The longest a credential name can be. A name longer than this is not a
// credential name, so it is never held back waiting for one.
const MAX_CREDENTIAL_NAME_LENGTH = 64;

/**
 * The tail of the text that is an escape sequence that has not finished.
 */
function incompleteEscapeTail(text: string): string {
  const match = INCOMPLETE_ESCAPE_TAIL_REGEX.exec(text);
  return match ? match[0] : "";
}

/**
 * The terminal's own codes, stripped.
 *
 * The escape codes are stripped BEFORE the redaction, so a coloured
 * "password=" is still a "password=" and a secret that a colour code split
 * in half is still found.
 */
export function stripTerminalCodes(text: string): string {
  return text
    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, "")
    .replace(/\r/g, "")
    .replace(TERMINAL_BELL_REGEX, "");
}

/**
 * The assignment at the tail of the text, if there is one.
 *
 * An assignment is the name, the separator and the value. It is at the tail
 * when nothing but whitespace and the value follow the separator — the value
 * ends at the first whitespace or delimiter, so an assignment whose value
 * has arrived is finished and an assignment whose value has not is still
 * open.
 *
 * The name is what tells the redaction that the value is a secret, so an
 * open assignment is held whole until its value arrives.
 */
function openAssignment(text: string): { index: number; value: string } | undefined {
  // The last separator, walking back over the characters a name or a value
  // is made of.
  let separator = -1;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index];
    if (character === "=" || character === ":") {
      separator = index;
      break;
    }
    if (!/[\sA-Za-z0-9_.-]/.test(character)) {
      // A delimiter ends the search: the assignment ended earlier.
      return undefined;
    }
  }
  if (separator < 0) {
    return undefined;
  }

  // The name, before the separator.
  let nameStart = separator;
  while (nameStart > 0 && /[A-Za-z0-9_.-]/.test(text[nameStart - 1])) {
    nameStart -= 1;
  }
  if (nameStart === separator || separator - nameStart > MAX_CREDENTIAL_NAME_LENGTH) {
    return undefined;
  }

  // What follows the separator must be the value and nothing else.
  const after = text.slice(separator + 1);
  if (!/^\s*[^\s,;}]*$/.test(after)) {
    return undefined;
  }

  const value = after.trimStart();
  return { index: nameStart, value };
}

/**
 * The start of the run of name characters at the tail of the text.
 *
 * A run like "pass" can still become the name of a credential, and a token
 * like "ghp_abc" can still grow, so the run is held until more text says
 * what it is. A run longer than a credential name cannot be one, so it is
 * released.
 */
function trailingNameRunStart(text: string): number {
  let index = text.length;
  while (index > 0 && /[A-Za-z0-9_.-]/.test(text[index - 1])) {
    index -= 1;
  }
  const run = text.length - index;
  return run > 0 && run <= MAX_CREDENTIAL_NAME_LENGTH ? index : -1;
}

/**
 * Keeps the redacted preview of a stream of output.
 *
 * The output arrives in pieces and is unbounded, and a secret may straddle
 * two pieces — so the redaction has to see enough context to recognise it,
 * and it must not have to look at the whole output again for every piece.
 *
 * The redactor is therefore a small state machine:
 *
 * - NORMAL: text is released as soon as nothing can still change it. What
 *   can still change is an assignment whose value has not arrived, and a
 *   run of name characters that could still become a credential name.
 * - IN-VALUE: the rest of an assignment's value. It is one secret and it
 *   ends at the first whitespace or delimiter, so it is masked and dropped
 *   as it arrives.
 * - IN-KEY: the body of a private key block. It is masked and dropped as it
 *   arrives, so a key block of any length costs nothing.
 *
 * What is released is masked once, and what is held is small, so the cost
 * of a piece of output does not grow with the output seen so far.
 */
export class OutputRedactor {
  /** The released output, already masked. Only its tail is kept. */
  private emitted = "";
  /** The text that is still held back, because something in it may change. */
  private pending = "";
  /** An escape sequence that has not finished arriving. */
  private escapeCarry = "";
  private mode: "normal" | "in-value" | "in-key" = "normal";
  private redactEnabled: boolean;

  constructor(redact: boolean = true) {
    this.redactEnabled = redact;
  }

  /**
   * Turn the redaction on or off.
   *
   * The setting is a preference the user can change while a command runs,
   * so the next piece of output follows the new setting.
   */
  setRedactionEnabled(redact: boolean) {
    this.redactEnabled = redact;
  }

  /**
   * How much text the redactor is holding back.
   *
   * What is held is what could still change: an assignment waiting for its
   * value, a run of name characters, the body of a key block. It is small by
   * construction, and this is how a caller can see that it stays small.
   */
  get heldLength(): number {
    return this.pending.length + this.escapeCarry.length;
  }

  /**
   * Add a piece of output, and return the redacted preview of everything
   * seen so far.
   */
  append(chunk: string): string {
    // The escape codes. An unfinished sequence is carried into the next
    // piece, and the text in front of it is held: a colour code can split a
    // name, and a name that is split cannot be recognised.
    const combined = this.escapeCarry + chunk;
    const carry = incompleteEscapeTail(combined);
    this.escapeCarry = carry;
    const text = stripTerminalCodes(combined.slice(0, combined.length - carry.length));

    if (this.redactEnabled && this.mode === "in-key") {
      // The body of a key block: masked and dropped, with just enough kept
      // to recognise an END marker that arrives in two pieces.
      const together = this.pending + text;
      const end = together.indexOf(PRIVATE_KEY_END);
      if (end < 0) {
        this.pending = together.slice(-PRIVATE_KEY_MARKER_KEEP);
        return this.preview();
      }
      this.mode = "normal";
      this.pending = "";
      return this.appendText(together.slice(end + PRIVATE_KEY_END.length));
    }

    if (this.redactEnabled) {
      const begin = text.indexOf(PRIVATE_KEY_BEGIN);
      if (begin >= 0) {
        this.release(this.pending + text.slice(0, begin));
        this.release(REDACTION_PLACEHOLDER);
        this.mode = "in-key";
        this.pending = text.slice(begin).slice(-PRIVATE_KEY_MARKER_KEEP);
        return this.preview();
      }
    }

    if (this.escapeCarry) {
      // The text in front of an unfinished escape sequence may be part of a
      // name, so nothing is released until the sequence completes.
      this.pending += text;
      return this.preview();
    }

    return this.appendText(text);
  }

  private appendText(text: string): string {
    if (!this.redactEnabled) {
      this.pending += text;
      this.release(this.pending);
      this.pending = "";
      return this.preview();
    }

    if (this.mode === "in-value") {
      // The rest of an assignment's value: it is one secret, and it ends at
      // the first whitespace or delimiter.
      const end = /[\s,;}]/.exec(text);
      if (!end) {
        return this.preview();
      }
      this.mode = "normal";
      this.pending = "";
      this.release(text[end.index]);
      return this.appendText(text.slice(end.index + 1));
    }

    this.pending += text;

    // An assignment at the tail: its name, its separator and its value are
    // masked as one thing, so the whole of it is held until the value has
    // arrived.
    const assignment = openAssignment(this.pending);
    if (assignment) {
      this.release(this.pending.slice(0, assignment.index));
      if (assignment.value.length === 0) {
        // The value has not arrived: the assignment is held whole.
        this.pending = this.pending.slice(assignment.index);
        return this.preview();
      }
      // The value has arrived: it is masked now, and the rest of it is
      // masked as it arrives.
      this.release(this.pending.slice(assignment.index));
      this.mode = "in-value";
      this.pending = "";
      return this.preview();
    }

    // A run of name characters at the tail could still be the name of a
    // credential, or the start of a token.
    const run = trailingNameRunStart(this.pending);
    if (run >= 0) {
      this.release(this.pending.slice(0, run));
      this.pending = this.pending.slice(run);
      return this.preview();
    }

    this.release(this.pending);
    this.pending = "";
    return this.preview();
  }

  /**
   * Mask a piece of text and keep it.
   *
   * Only the tail of the released output is kept, because the preview is
   * the tail of the output.
   */
  private release(text: string): void {
    if (!text) {
      return;
    }
    this.emitted = `${this.emitted}${this.mask(text)}`.slice(-REDACTED_PREVIEW_LIMIT);
  }

  private mask(text: string): string {
    return this.redactEnabled ? redactSecrets(text) : text;
  }

  private preview(): string {
    // While a key block is open, the held text is its body: it is a secret,
    // so it is not shown at all. While an assignment's value is arriving,
    // the held text is the rest of the value, and it is masked already.
    const held =
      this.mode === "in-value" || this.mode === "in-key" ? "" : this.mask(this.pending);
    return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
  }
}
