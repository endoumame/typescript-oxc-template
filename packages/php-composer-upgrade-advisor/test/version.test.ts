import {
  classifyVersionChange,
  compareVersions,
  constraintAllowsPhp,
  phpVersionForConstraint,
} from "../src/version.js";

describe("version utilities", () => {
  it("normalizes minor PHP versions for constraint checks", () => {
    expect(phpVersionForConstraint("8.3")).toBe("8.3.0");
    expect(phpVersionForConstraint("8.3.2")).toBe("8.3.0");
  });

  it("evaluates common Composer PHP constraints", () => {
    expect(constraintAllowsPhp("^8.1", "8.3")).toBe(true);
    expect(constraintAllowsPhp("^8.1", "9.0")).toBe(false);
    expect(constraintAllowsPhp(">=8.1 <8.3", "8.3")).toBe(false);
    expect(constraintAllowsPhp(">=8.1 <8.4", "8.3")).toBe(true);
    expect(constraintAllowsPhp("~8.2.0", "8.3")).toBe(false);
    expect(constraintAllowsPhp("8.3.*", "8.3")).toBe(true);
    expect(constraintAllowsPhp("^7.4 || ^8.3", "8.3")).toBe(true);
  });

  it("compares and classifies semantic version updates", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(classifyVersionChange("1.2.3", "1.2.4")).toBe("patch");
    expect(classifyVersionChange("1.2.3", "1.3.0")).toBe("minor");
    expect(classifyVersionChange("1.2.3", "2.0.0")).toBe("major");
    expect(classifyVersionChange("1.2.3", "1.2.3")).toBe("none");
  });
});
