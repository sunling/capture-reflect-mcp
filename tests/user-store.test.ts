import { describe, expect, it, vi } from "vitest";
import { connectionUserIdForSubject } from "../src/production/user-store.js";

describe("connection user identity", () => {
  it("keeps the canonical WorkOS subject unchanged", async () => {
    const userIdsForGitHub = vi.fn();
    await expect(connectionUserIdForSubject({ userIdsForGitHub }, "user_existing"))
      .resolves.toBe("user_existing");
    expect(userIdsForGitHub).not.toHaveBeenCalled();
  });

  it("maps a legacy signed github subject to its single stored connection", async () => {
    const userIdsForGitHub = vi.fn().mockResolvedValue(["user_existing"]);
    await expect(connectionUserIdForSubject({ userIdsForGitHub }, "github:42"))
      .resolves.toBe("user_existing");
    expect(userIdsForGitHub).toHaveBeenCalledWith(42);
  });

  it.each([
    { userIds: [] },
    { userIds: ["user_one", "user_two"] },
  ])("does not guess when a legacy mapping is not unique", async ({ userIds }) => {
    const userIdsForGitHub = vi.fn().mockResolvedValue(userIds);
    await expect(connectionUserIdForSubject({ userIdsForGitHub }, "github:42"))
      .resolves.toBe("github:42");
  });
});
