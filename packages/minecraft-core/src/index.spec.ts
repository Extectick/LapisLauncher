import { describe, expect, it } from "vitest";
import { requiredMinecraftDiskBytes } from "./index";

describe("Minecraft installation disk policy", () => {
  it("keeps a two GiB minimum for a clean runtime", () => {
    expect(requiredMinecraftDiskBytes([10 * 1024 * 1024])).toBe(
      2n * 1024n ** 3n,
    );
  });

  it("reserves reconstruction space for large managed content", () => {
    expect(requiredMinecraftDiskBytes([1024 * 1024 * 1024])).toBe(
      3n * 1024n ** 3n,
    );
  });
});
