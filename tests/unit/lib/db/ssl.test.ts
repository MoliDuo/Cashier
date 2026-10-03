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

  it("accepts an explicit sslmode=disable for a non-local production host", () => {
    expect(resolvePostgresSsl("postgresql://postgres/cashier?sslmode=disable", "production")).toBe(
      false
    );
  });

  it("rejects non-local production URLs that do not choose a TLS mode", () => {
    expect(() => resolvePostgresSsl("postgresql://db.example/cashier", "production")).toThrow(
      "requires an explicit sslmode"
    );
    expect(() =>
      resolvePostgresSsl("postgresql://db.example/cashier?sslmode=prefer", "production")
    ).toThrow("requires an explicit sslmode");
  });

  it("allows local and non-production URLs without forcing TLS", () => {
    expect(resolvePostgresSsl("postgresql://localhost/cashier", "production")).toBeUndefined();
    expect(resolvePostgresSsl("postgresql://db.example/cashier", "test")).toBeUndefined();
  });
});
