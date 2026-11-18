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

// KEY=value, "key": "value", key: value — with a quoted or bare value.
//
// The name has to be a sequence of components, one of which is a secret word.
// That is what keeps "authorisation" (which contains "auth") and "tokenizer"
// (which starts with "token") out: the secret word has to be a whole
// component, and the name has to end at a word boundary.
const SECRET_ASSIGNMENT_PATTERN =
  /(["']?\b(?:[A-Za-z0-9]+[-_])*(?:pass(?:word|phrase)?|secret|token|api[-_]?key|access[-_]?key|credential|private[-_]?key)(?:[-_][A-Za-z0-9]+)*\b["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi;

// Well-known token shapes. Each is long enough and specific enough that a
// false positive is very unlikely.
const TOKEN_PATTERNS: RegExp[] = [
  // AWS access key ids.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  // GitLab tokens.
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  // Slack tokens.
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // JSON web tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // A private key block.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

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
    SECRET_ASSIGNMENT_PATTERN,
    (match: string, prefix: string, value: string) => {
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
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
      return `${prefix}${quote}${REDACTION_PLACEHOLDER}${quote}`;
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
