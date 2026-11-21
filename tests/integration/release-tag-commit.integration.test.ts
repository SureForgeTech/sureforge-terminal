// The release tag must name the commit the published assets were built from.
// The workflow used to start on a pushed `v*` tag, which made that binding
// true by construction; the dispatch path takes the tag as free text, so the
// publish step proves it instead of trusting it. These tests pin the
// resolution rules: lightweight tags, annotated tags, a tag that is absent,
// and a tag that names a different commit than the build.
import { describe, expect, it } from "vitest";
import { assertTagMatchesBuild, resolveTagCommit } from "../../scripts/verify-release-tag-commit.mjs";

const REPOSITORY = "SureForgeTech/sureforge-terminal";
const BUILT = "1".repeat(40);
const OTHER = "2".repeat(40);
const ANNOTATED = "3".repeat(40);

function fakeGh(responses: Record<string, string>) {
  return (args: string[]) => {
    const apiPath = args[1] ?? "";
    const response = responses[apiPath];
    if (response === undefined) {
      throw new Error(`unexpected gh api path: ${apiPath}`);
    }
    return response;
  };
}

describe("release tag to build commit binding", () => {
  it("resolves a lightweight tag to the commit it names", () => {
    const gh = fakeGh({ [`repos/${REPOSITORY}/git/ref/tags/v0.2.2`]: `${BUILT}\tcommit` });
    expect(resolveTagCommit("v0.2.2", REPOSITORY, gh)).toBe(BUILT);
  });

  it("dereferences an annotated tag to the commit it wraps", () => {
    const gh = fakeGh({
      [`repos/${REPOSITORY}/git/ref/tags/v0.2.2`]: `${ANNOTATED}\ttag`,
      [`repos/${REPOSITORY}/git/tags/${ANNOTATED}`]: BUILT,
    });
    expect(resolveTagCommit("v0.2.2", REPOSITORY, gh)).toBe(BUILT);
  });

  it("resolves nothing when the tag does not exist", () => {
    const gh = fakeGh({});
    expect(resolveTagCommit("v0.2.2", REPOSITORY, gh)).toBeNull();
  });

  it("accepts a tag that names the built commit", () => {
    const gh = fakeGh({ [`repos/${REPOSITORY}/git/ref/tags/v0.2.2`]: `${BUILT}\tcommit` });
    expect(
      assertTagMatchesBuild({ tag: "v0.2.2", builtCommit: BUILT, repository: REPOSITORY, gh }),
    ).toEqual({ tag: "v0.2.2", tagCommit: BUILT, builtCommit: BUILT });
  });

  it("refuses a tag that names another commit", () => {
    const gh = fakeGh({ [`repos/${REPOSITORY}/git/ref/tags/v0.2.2`]: `${OTHER}\tcommit` });
    expect(() =>
      assertTagMatchesBuild({ tag: "v0.2.2", builtCommit: BUILT, repository: REPOSITORY, gh }),
    ).toThrow(/names commit .* but the published assets were built from/);
  });

  it("refuses when the promoted manifest names no build commit", () => {
    const gh = fakeGh({ [`repos/${REPOSITORY}/git/ref/tags/v0.2.2`]: `${BUILT}\tcommit` });
    expect(() =>
      assertTagMatchesBuild({ tag: "v0.2.2", builtCommit: "", repository: REPOSITORY, gh }),
    ).toThrow(/names no build commit/);
  });

  it("refuses when the tag does not resolve to a commit", () => {
    const gh = fakeGh({});
    expect(() =>
      assertTagMatchesBuild({ tag: "v0.2.2", builtCommit: BUILT, repository: REPOSITORY, gh }),
    ).toThrow(/did not resolve to a commit/);
  });
});
