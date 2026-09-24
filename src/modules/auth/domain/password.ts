import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;
const BCRYPT_HASH = /^\$2[aby]\$(1[0-4])\$[./A-Za-z0-9]{53}$/;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!BCRYPT_HASH.test(hash)) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
