// The local preview mode must never switch on outside `next dev` on a developer's computer.
import { describe, expect, it } from "vitest";
import { devPreviewUserId } from "@/lib/dev-preview";

const id = "6f1c2a3e-0000-4000-8000-000000000d01";

describe("local preview mode", () => {
  it("works only in development with the setting present", () => {
    expect(devPreviewUserId({ NODE_ENV: "development", MRD_DEV_USER_ID: id })).toBe(id);
    expect(devPreviewUserId({ NODE_ENV: "development" })).toBeNull();
  });

  it("a test may switch demo user with the cookie — only while preview mode is on", () => {
    const other = "6f1c2a3e-0000-4000-8000-000000000d03";
    expect(devPreviewUserId({ NODE_ENV: "development", MRD_DEV_USER_ID: id }, other)).toBe(other);
    expect(devPreviewUserId({ NODE_ENV: "development", MRD_DEV_USER_ID: id }, "not-a-uuid")).toBe(id);
    expect(devPreviewUserId({ NODE_ENV: "development" }, other)).toBeNull();
    expect(devPreviewUserId({ NODE_ENV: "production", MRD_DEV_USER_ID: id }, other)).toBeNull();
  });

  it("is ignored in production builds and on Vercel, even if the setting is present", () => {
    expect(devPreviewUserId({ NODE_ENV: "production", MRD_DEV_USER_ID: id })).toBeNull();
    expect(devPreviewUserId({ NODE_ENV: "test", MRD_DEV_USER_ID: id })).toBeNull();
    expect(devPreviewUserId({ NODE_ENV: "development", VERCEL: "1", MRD_DEV_USER_ID: id })).toBeNull();
  });
});
