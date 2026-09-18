import type { SetupPort } from "@/application/contracts";
import { ValidationError } from "@/lib/errors";
import { validatePassword } from "@/modules/auth/services/password-policy";

export interface SetupInput {
  bookNames: readonly string[];
  defaultBookName: string;
  email: string;
  password: string;
  locale: string;
}

export interface SetupResult {
  userId: string;
  ledgerId: string;
}

/**
 * Normalizes and checks what the wizard collected before the one transaction
 * that writes it. The port owns the transaction; the rules about what counts as
 * a usable first-run input live here.
 */
export async function createInitialAccount(
  input: SetupInput,
  setup: Pick<SetupPort, "createInitialAccount">
): Promise<SetupResult> {
  const names = input.bookNames.map((name) => name.trim()).filter((name) => name !== "");
  if (names.length === 0) throw new ValidationError("At least one book is required");
  if (new Set(names).size !== names.length) {
    throw new ValidationError("Book names must be unique");
  }
  const defaultBookName = input.defaultBookName.trim();
  if (!names.includes(defaultBookName)) {
    throw new ValidationError("The default book must be one of the books");
  }
  validatePassword(input.password);
  return setup.createInitialAccount({
    bookNames: names,
    defaultBookName,
    email: input.email.trim().toLowerCase(),
    password: input.password,
    locale: input.locale,
  });
}
