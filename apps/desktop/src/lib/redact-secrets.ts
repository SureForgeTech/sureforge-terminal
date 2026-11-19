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
const ASSIGNMENT_PATTERN =
  /(["']?)([A-Za-z0-9_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/g;

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
