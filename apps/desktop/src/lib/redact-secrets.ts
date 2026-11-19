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

/**
 * The words a secret is usually stored under.
 *
 * The comparison is against the WORDS of a name, not against the name as a
 * whole: "accessToken" is a secret and "tokenizer" is not, and the only
 * difference is the word boundary. A plural counts ("secrets", "tokens",
 * "passwords"), and the match is case-insensitive.
 */
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
//
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

/**
 * Mask only the tokens in a piece of text.
 *
 * The whole-text redaction masks the assignments first and the tokens
 * after, so a piece of text that is not part of an assignment is masked
 * with the token shapes alone.
 */
function maskTokens(text: string): string {
  let masked = text;
  for (const pattern of TOKEN_PATTERNS) {
    masked = masked.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return masked;
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

// A private key block, open or closed. The whole markers are used, so that a
// "-----BEGIN" that is not a key block is not treated as one.
const PRIVATE_KEY_END = "-----END [A-Z ]*PRIVATE KEY-----";

// The longest a credential name can be. A name longer than this is not a
// credential name, so it is never held back waiting for one.
const MAX_CREDENTIAL_NAME_LENGTH = 64;

// The characters a name, a token or a key marker is made of.
const NAME_CHARACTER = /[A-Za-z0-9_.-]/;

// The prefixes a run can start with and still be a token.
const TOKEN_PREFIXES = [
  "AKIA",
  "ASIA",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "glpat-",
  "xoxa-",
  "xoxb-",
  "xoxp-",
  "xoxr-",
  "xoxs-",
  "eyJ",
];

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
 * The name in front of a separator, and where it starts.
 *
 * A name is a run of name characters that starts with a letter, a digit or
 * an underscore, and it is at most 64 characters long — a longer run is not
 * a credential name.
 */
function nameBefore(text: string, separator: number): number {
  // A quoted name: the quote closes it, so the name is the run before it.
  let end = separator;
  const closing = text[end - 1];
  if (closing === '"' || closing === "'") {
    end -= 1;
  }

  let start = end;
  while (start > 0 && NAME_CHARACTER.test(text[start - 1])) {
    start -= 1;
  }
  if (start === end || end - start > MAX_CREDENTIAL_NAME_LENGTH) {
    return -1;
  }
  if (!/[A-Za-z0-9_]/.test(text[start])) {
    return -1;
  }
  return start;
}

/**
 * The next assignment in the text.
 *
 * An assignment is a name, a separator and a value, and it is found the
 * same way the whole-text redaction finds it: the first separator that has a
 * name in front of it.
 */
function findAssignment(text: string): { nameStart: number; separator: number } | undefined {
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== "=" && character !== ":") {
      continue;
    }
    const nameStart = nameBefore(text, index);
    if (nameStart >= 0) {
      return { nameStart, separator: index };
    }
  }
  return undefined;
}

/**
 * Whether the text is a private key header, and whether it could still
 * become one.
 *
 * The whole-text redaction only treats "-----BEGIN [A-Z ]*PRIVATE KEY-----"
 * as a key block, so a "-----BEGIN" that is not one is ordinary text. A
 * header that is not complete yet may still become one, and is held until
 * it does.
 */
function privateKeyHeaderState(text: string): "complete" | "partial" | "none" {
  const literal = "PRIVATE KEY-----";
  const rest = text.slice("-----BEGIN ".length);

  // The "[A-Z ]*" part may take any number of characters, so the header
  // can be split in more than one way. The loop is bounded: a header whose
  // first part is longer than this is not a header.
  for (let consumed = 0; consumed <= rest.length && consumed <= 128; consumed += 1) {
    const head = rest.slice(0, consumed);
    if (!/^[A-Z ]*$/.test(head)) {
      break;
    }
    // The header is complete when the literal follows the "[A-Z ]*" part.
    if (rest.startsWith(literal, consumed)) {
      return "complete";
    }
    // It may still become one when what follows is the start of the
    // literal and the text ends there.
    const tail = rest.slice(consumed);
    if (tail.length < literal.length && literal.startsWith(tail)) {
      return "partial";
    }
  }
  return "none";
}

/**
 * Whether a run of name characters could be a token.
 *
 * A token is a run that starts with a recognisable prefix. It is not held
 * to the length of a credential name: a token is longer than a name, and a
 * token that is released too early leaves its tail in the preview.
 */
function isTokenRun(run: string): boolean {
  return TOKEN_PREFIXES.some((prefix) => run.startsWith(prefix));
}

/**
 * Keeps the redacted preview of a stream of output.
 *
 * The output arrives in pieces and is unbounded, and a secret may straddle
 * two pieces — so the redaction has to see enough context to recognise it,
 * and it must not have to look at the whole output again for every piece.
 *
 * The redactor is therefore a small lexer over the pieces:
 *
 * - NORMAL: the text is released as soon as nothing in it can still change.
 *   What can still change is an assignment whose value has not arrived, a
 *   run of name characters that could still become a credential name, and a
 *   token that could still grow.
 * - AWAITING-VALUE: a secret assignment's separator was seen. Its value may
 *   be on the next line, so the whitespace is released as it arrives and the
 *   value is masked when it comes.
 * - SECRET-VALUE / SECRET-QUOTED-VALUE: the value of a secret assignment.
 *   It is one secret, so it is masked and dropped as it arrives.
 * - PLAIN-VALUE / PLAIN-QUOTED-VALUE: the value of an assignment that is
 *   not a secret. It is released as it arrives, but it is still consumed as
 *   one thing, so a construct inside it is not picked up a second time.
 * - TOKEN: a token that may still grow. It is held until it ends, and then
 *   masked as a whole.
 * - KEY: the body of a private key block. It is masked and dropped as it
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
  private mode:
    | "normal"
    | "awaiting-value"
    | "secret-value"
    | "secret-quoted-value"
    | "plain-value"
    | "plain-quoted-value"
    | "token"
    | "key" = "normal";
  /** The quote that opened the value, when the value is quoted. */
  private valueQuote = "";
  /** Whether the value's content has already been masked and dropped. */
  private valueMasked = false;
  private redactEnabled: boolean;

  constructor(redact: boolean = true) {
    this.redactEnabled = redact;
  }

  /**
   * Turn the redaction on or off.
   *
   * The setting is a preference the user can change while a command runs,
   * so the next piece of output follows the new setting — and the lexer
   * starts again, so that a construct that was half-read under the old
   * setting cannot swallow the output under the new one.
   */
  setRedactionEnabled(redact: boolean) {
    if (redact === this.redactEnabled) {
      return;
    }
    this.redactEnabled = redact;
    this.mode = "normal";
    this.valueQuote = "";
    this.valueMasked = false;
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

    if (this.escapeCarry) {
      // The text in front of an unfinished escape sequence may be part of a
      // name, so nothing is released until the sequence completes.
      this.pending += text;
      return this.preview();
    }

    this.pending += text;
    this.lex();
    return this.preview();
  }

  /** Read as much of the held text as can be read. */
  private lex(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;

      switch (this.mode) {
        case "normal":
          progressed = this.lexNormal();
          break;
        case "awaiting-value":
          progressed = this.lexAwaitingValue();
          break;
        case "secret-value":
        case "secret-quoted-value":
        case "plain-value":
        case "plain-quoted-value":
          progressed = this.lexValue();
          break;
        case "token":
          progressed = this.lexToken();
          break;
        case "key":
          progressed = this.lexKey();
          break;
      }
    }
  }

  /** The text between the constructs: it is released, masked as tokens. */
  private lexNormal(): boolean {
    const assignment = findAssignment(this.pending);

    // A private key block comes first: its marker is not a name, and its
    // body is dropped as it arrives. With the redaction off it is ordinary
    // text.
    const keyStart = this.redactEnabled ? this.pending.indexOf("-----BEGIN") : -1;
    if (keyStart >= 0 && (!assignment || keyStart < assignment.nameStart)) {
      const header = privateKeyHeaderState(this.pending.slice(keyStart));
      if (header === "partial") {
        // The header is not complete yet: it may still be one.
        return false;
      }
      if (header === "complete") {
        this.releaseTokens(this.pending.slice(0, keyStart));
        this.release(REDACTION_PLACEHOLDER);
        this.pending = this.pending.slice(keyStart);
        this.mode = "key";
        return true;
      }
      // It is not a key block at all: it is ordinary text, and the text
      // after it is scanned as usual.
      this.releaseTokens(this.pending.slice(0, keyStart + "-----BEGIN".length));
      this.pending = this.pending.slice(keyStart + "-----BEGIN".length);
      return true;
    }

    if (assignment) {
      const quoted =
        this.pending[assignment.nameStart - 1] === '"' ||
        this.pending[assignment.nameStart - 1] === "'";
      const name = this.pending.slice(assignment.nameStart, assignment.separator);
      // With the redaction off, nothing is masked and nothing is dropped.
      const secret = this.redactEnabled && isSecretName(name);
      const start = assignment.nameStart - (quoted ? 1 : 0);

      // The text before the assignment, then the name and the separator.
      this.releaseTokens(this.pending.slice(0, start));
      this.releaseTokens(this.pending.slice(start, assignment.separator + 1));
      this.pending = this.pending.slice(assignment.separator + 1);
      // A secret assignment's value is masked; an ordinary one is released
      // as it arrives, but it is consumed as one thing so that a construct
      // inside it is not picked up a second time.
      this.mode = secret ? "awaiting-value" : "plain-value";
      return true;
    }

    // No assignment: the text is a token, or it is ordinary text.
    const runStart = this.runStart();
    if (runStart >= 0) {
      const run = this.pending.slice(runStart);
      if (isTokenRun(run)) {
        // The token may still grow: it is held until it ends.
        this.releaseTokens(this.pending.slice(0, runStart));
        this.pending = this.pending.slice(runStart);
        this.mode = "token";
        return true;
      }
      if (run.length <= MAX_CREDENTIAL_NAME_LENGTH) {
        // The run may still become the name of a credential.
        this.releaseTokens(this.pending.slice(0, runStart));
        this.pending = this.pending.slice(runStart);
        return false;
      }
    }

    // Nothing can change any more: the text is released.
    this.releaseTokens(this.pending);
    this.pending = "";
    return false;
  }

  /** A secret assignment's separator was seen: the value may still come. */
  private lexAwaitingValue(): boolean {
    const text = this.pending;
    if (text.length === 0) {
      return false;
    }

    const character = text[0];
    if (/\s/.test(character)) {
      // The whitespace belongs to the separator: it is released as it
      // arrives, and the value may still come after it.
      this.releaseTokens(character);
      this.pending = text.slice(1);
      return true;
    }

    if (character === "," || character === ";" || character === "}") {
      // The value is empty, so there is no secret to mask.
      this.releaseTokens(character);
      this.pending = text.slice(1);
      this.mode = "normal";
      return true;
    }

    if (character === '"' || character === "'") {
      this.releaseTokens(character);
      this.pending = text.slice(1);
      this.valueQuote = character;
      this.mode = "secret-quoted-value";
      return true;
    }

    this.mode = "secret-value";
    return true;
  }

  /** The value of an assignment is arriving. */
  private lexValue(): boolean {
    const text = this.pending;
    if (text.length === 0) {
      return false;
    }

    const quoted =
      this.mode === "secret-quoted-value" || this.mode === "plain-quoted-value";
    const secret =
      this.redactEnabled &&
      (this.mode === "secret-value" || this.mode === "secret-quoted-value");

    if (quoted) {
      const end = text.indexOf(this.valueQuote);
      if (end < 0) {
        // The value goes on: its content is dropped as it arrives, and the
        // placeholder goes out as soon as the value is known to hold
        // something.
        if (!secret) {
          this.releaseTokens(text);
        } else if (!this.valueMasked && text.length > 0) {
          this.release(REDACTION_PLACEHOLDER);
          this.valueMasked = true;
        }
        this.pending = "";
        return true;
      }
      // The value ends here. An empty value is not a secret, and neither is
      // one that is already the placeholder.
      if (!secret) {
        this.releaseTokens(text.slice(0, end));
      } else if (!this.valueMasked && end > 0) {
        this.release(REDACTION_PLACEHOLDER);
      }
      this.pending = text.slice(end);
      this.mode = "normal";
      this.valueMasked = false;
      return true;
    }

    const end = /[\s,;}]/.exec(text);
    if (!end) {
      // The value goes on: its content is dropped as it arrives, and the
      // placeholder goes out as soon as the value is known to hold
      // something.
      if (!secret) {
        this.releaseTokens(text);
      } else if (!this.valueMasked) {
        this.release(REDACTION_PLACEHOLDER);
        this.valueMasked = true;
      }
      this.pending = "";
      return true;
    }
    if (!secret) {
      this.releaseTokens(text.slice(0, end.index));
    } else if (!this.valueMasked && end.index > 0) {
      this.release(REDACTION_PLACEHOLDER);
    }
    this.pending = text.slice(end.index);
    this.mode = "normal";
    this.valueMasked = false;
    return true;
  }

  /** A token is arriving: it is held until it ends. */
  private lexToken(): boolean {
    const text = this.pending;
    const end = text.search(/[^A-Za-z0-9_.-]/);
    if (end < 0) {
      // The token may still grow.
      return false;
    }
    this.releaseTokens(this.pending.slice(0, end));
    this.pending = text.slice(end);
    this.mode = "normal";
    return true;
  }

  /** The body of a private key block is arriving: it is dropped. */
  private lexKey(): boolean {
    const text = this.pending;
    const end = new RegExp(PRIVATE_KEY_END).exec(text);
    if (!end) {
      // The block is still open: its body is dropped, and only enough is
      // kept to recognise an END marker that arrives in two pieces.
      this.pending = text.slice(-64);
      return false;
    }
    // The block ends here: the marker is part of the block, so it is
    // dropped with it.
    this.pending = text.slice(end.index + end[0].length);
    this.mode = "normal";
    return true;
  }

  /**
   * The start of the run of name characters at the tail of the text.
   *
   * A trailing quote is held with it: the quote can close a name whose
   * opening quote and name arrived earlier, and a name that is split cannot
   * be recognised.
   */
  private runStart(): number {
    let index = this.pending.length;
    let quote = false;
    const last = this.pending[index - 1];
    if (last === '"' || last === "'") {
      quote = true;
      index -= 1;
    }
    while (index > 0 && NAME_CHARACTER.test(this.pending[index - 1])) {
      index -= 1;
    }
    if (index === this.pending.length) {
      return -1;
    }
    // The quote is held with the run: the quote can close a name, and the
    // quote that opens one is part of it.
    return quote ? Math.max(0, index - 1) : index;
  }

  /**
   * Release text that is not part of an assignment: it is masked with the
   * token shapes alone.
   */
  private releaseTokens(text: string): void {
    if (!text) {
      return;
    }
    this.emitted = `${this.emitted}${this.redactEnabled ? maskTokens(text) : text}`.slice(
      -REDACTED_PREVIEW_LIMIT
    );
  }

  /** Release text that is already masked. */
  private release(text: string): void {
    if (!text) {
      return;
    }
    this.emitted = `${this.emitted}${text}`.slice(-REDACTED_PREVIEW_LIMIT);
  }

  private preview(): string {
    // While a key block is open, or the value of an assignment is arriving,
    // the held text is a secret: it is not shown at all.
    const held =
      this.mode === "secret-value" ||
      this.mode === "secret-quoted-value" ||
      this.mode === "key"
        ? ""
        : this.redactEnabled
          ? maskTokens(this.pending)
          : this.pending;
    return `${this.emitted}${held}`.slice(-REDACTED_PREVIEW_LIMIT).trim();
  }
}
