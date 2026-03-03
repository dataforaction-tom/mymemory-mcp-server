import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt } from "./crypto.js";

describe("encryption", () => {
  const passphrase = "test-passphrase-123";

  it("should round-trip encrypt and decrypt", () => {
    const plaintext = '{"facts": [], "meta": {}}';
    const encrypted = encrypt(plaintext, passphrase);
    const decrypted = decrypt(encrypted, passphrase);
    assert.equal(decrypted, plaintext);
  });

  it("should produce different ciphertext each time (random IV/salt)", () => {
    const plaintext = "same data";
    const a = encrypt(plaintext, passphrase);
    const b = encrypt(plaintext, passphrase);
    assert.notEqual(a, b);
  });

  it("should fail to decrypt with wrong passphrase", () => {
    const encrypted = encrypt("secret data", passphrase);
    assert.throws(() => decrypt(encrypted, "wrong-passphrase"));
  });
});
