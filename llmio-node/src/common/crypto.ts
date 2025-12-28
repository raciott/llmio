import { randomBytes } from "node:crypto";
import { KeyPrefix } from "../consts.js";

const Alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateRandomChars(length: number) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += Alphabet[bytes[i] % Alphabet.length];
  return out;
}

export function generateAuthKey() {
  return `${KeyPrefix}${generateRandomChars(36)}`;
}
