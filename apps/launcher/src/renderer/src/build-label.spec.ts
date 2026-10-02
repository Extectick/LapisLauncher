import { describe, expect, it } from "vitest";
import { formatBuildVersion, loaderDisplayName } from "./build-label";

describe("build version labels", () => {
  it("shows NeoForge for the Thaumcraft build", () => {
    expect(formatBuildVersion({ loader: "neoforge", minecraftVersion: "1.21.1" }))
      .toBe("NeoForge 1.21.1");
    expect(loaderDisplayName("neoforge")).toBe("NeoForge");
  });

  it("keeps the existing Fabric label", () => {
    expect(formatBuildVersion({ loader: "fabric", minecraftVersion: "26.2" }))
      .toBe("Fabric 26.2");
    expect(loaderDisplayName("fabric")).toBe("Fabric");
  });
});
