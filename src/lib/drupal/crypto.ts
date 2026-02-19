import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Envelope encryption for Drupal integration credentials.
 * Uses AES-256-GCM with a random IV per encryption.
 * Stored format: iv:ciphertext:authTag (all base64).
 *
 * Requires DRUPAL_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 */

type DrupalCredentials = {
  username?: string;
  password?: string;
  token?: string;
};

function getKey(): Buffer {
  const hex = process.env.DRUPAL_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "DRUPAL_ENCRYPTION_KEY must be set (64 hex chars = 32 bytes). " +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptCredentials(plain: DrupalCredentials): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const plaintext = JSON.stringify(plain);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

export function decryptCredentials(encrypted: string): DrupalCredentials {
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credentials format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const ciphertext = Buffer.from(parts[1], "base64");
  const authTag = Buffer.from(parts[2], "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
