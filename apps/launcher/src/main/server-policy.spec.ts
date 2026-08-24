import { describe, expect, it } from "vitest";
import { nicknameServerTarget } from "./server-policy";

describe("server connection policy", () => {
  it("connects the main server directly by the Lapis profile nickname", () => {
    expect(nicknameServerTarget("main")).toEqual({
      host: "195.208.129.43",
      port: 25565,
    });
  });

  it("keeps ticket authorization as the default for other servers", () => {
    expect(nicknameServerTarget("unknown")).toBeNull();
  });
});
