import { describe, expect, it } from "vitest";
import { resolvePostgresSsl } from "@/lib/db/ssl";

describe("resolvePostgresSsl", () => {
  it("maps supported sslmode values to explicit Pool TLS settings", () => {
    expect(
      resolvePostgresSsl("postgresql://db.example/cashier?sslmode=require", "production")
    ).toEqual({ rejectUnauthorized: false });
    expect(
      resolvePostgresSsl("postgresql://db.example/cashier?sslmode=verify-full", "production")
    ).toEqual({ rejectUnauthorized: true });
    expect(resolvePostgresSsl("postgresql://localhost/cashier?sslmode=disable", "production")).toBe(
      false
    );
  });

  it("rejects insecure non-local production URLs", () => {
    expect(() => resolvePostgresSsl("postgresql://db.example/cashier", "production")).toThrow(
      "requires sslmode=require or sslmode=verify-full"
    );
    expect(() =>
      resolvePostgresSsl("postgresql://db.example/cashier?sslmode=prefer", "production")
    ).toThrow("requires sslmode=require or sslmode=verify-full");
  });

  it("allows local and non-production URLs without forcing TLS", () => {
    expect(resolvePostgresSsl("postgresql://localhost/cashier", "production")).toBeUndefined();
    expect(resolvePostgresSsl("postgresql://db.example/cashier", "test")).toBeUndefined();
  });
});
