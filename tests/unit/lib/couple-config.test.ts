import { afterEach, describe, expect, it } from "vitest";
import { getCoupleConfig, isCoupleMember } from "@/lib/couple-config";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const partner = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ledger = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const original = {
  owner: process.env.COUPLE_OWNER_USER_ID,
  partner: process.env.COUPLE_PARTNER_USER_ID,
  ledger: process.env.COUPLE_LEDGER_ID,
};

afterEach(() => {
  if (original.owner == null) delete process.env.COUPLE_OWNER_USER_ID;
  else process.env.COUPLE_OWNER_USER_ID = original.owner;
  if (original.partner == null) delete process.env.COUPLE_PARTNER_USER_ID;
  else process.env.COUPLE_PARTNER_USER_ID = original.partner;
  if (original.ledger == null) delete process.env.COUPLE_LEDGER_ID;
  else process.env.COUPLE_LEDGER_ID = original.ledger;
});

describe("couple configuration", () => {
  it("accepts only the two configured member IDs", () => {
    process.env.COUPLE_OWNER_USER_ID = owner;
    process.env.COUPLE_PARTNER_USER_ID = partner;
    process.env.COUPLE_LEDGER_ID = ledger;
    expect(getCoupleConfig()).toEqual({ ownerId: owner, partnerId: partner, ledgerId: ledger });
    expect(isCoupleMember(owner)).toBe(true);
    expect(isCoupleMember(partner)).toBe(true);
    expect(isCoupleMember(ledger)).toBe(false);
  });

  it("fails closed when values are missing, repeated or malformed", () => {
    delete process.env.COUPLE_OWNER_USER_ID;
    expect(getCoupleConfig()).toBeNull();
    process.env.COUPLE_OWNER_USER_ID = owner;
    process.env.COUPLE_PARTNER_USER_ID = owner;
    process.env.COUPLE_LEDGER_ID = ledger;
    expect(getCoupleConfig()).toBeNull();
    process.env.COUPLE_PARTNER_USER_ID = "invalid";
    expect(isCoupleMember(owner)).toBe(false);
  });
});
