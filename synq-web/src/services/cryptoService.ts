import _sodium from 'libsodium-wrappers';

let sodium: typeof _sodium;

export const initCrypto = async () => {
  if (!sodium) {
    await _sodium.ready;
    sodium = _sodium;
  }
};

/**
 * Derives a symmetric key from a PIN/Password using Argon2id
 */
export const deriveKeyFromPin = async (pin: string, saltHex: string): Promise<Uint8Array> => {
  await initCrypto();
  const salt = sodium.from_hex(saltHex);
  
  // Use crypto_pwhash to derive a 32-byte key (suitable for secretbox)
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    pin,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
};

export const generateSalt = async (): Promise<string> => {
  await initCrypto();
  return sodium.to_hex(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES));
};

/**
 * Generates an X25519 key pair for the user
 */
export const generateKeyPair = async () => {
  await initCrypto();
  const keypair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_hex(keypair.publicKey),
    privateKey: sodium.to_hex(keypair.privateKey)
  };
};

/**
 * Encrypts the private key with the PIN-derived symmetric key
 */
export const encryptPrivateKey = async (privateKeyHex: string, derivedKey: Uint8Array): Promise<string> => {
  await initCrypto();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const message = sodium.from_hex(privateKeyHex);
  
  const ciphertext = sodium.crypto_secretbox_easy(message, nonce, derivedKey);
  
  // Prepend nonce to ciphertext
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce);
  payload.set(ciphertext, nonce.length);
  
  return sodium.to_hex(payload);
};

/**
 * Decrypts the private key using the PIN-derived symmetric key
 */
export const decryptPrivateKey = async (encryptedHex: string, derivedKey: Uint8Array): Promise<string> => {
  await initCrypto();
  const payload = sodium.from_hex(encryptedHex);
  const nonce = payload.slice(0, sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = payload.slice(sodium.crypto_secretbox_NONCEBYTES);
  
  const message = sodium.crypto_secretbox_open_easy(ciphertext, nonce, derivedKey);
  return sodium.to_hex(message);
};

/**
 * Encrypts a message payload for a recipient
 */
export const encryptMessage = async (messageText: string, recipientPublicKeyHex: string, senderPrivateKeyHex: string): Promise<string> => {
  await initCrypto();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  
  const message = sodium.from_string(messageText);
  const recipientPk = sodium.from_hex(recipientPublicKeyHex);
  const senderSk = sodium.from_hex(senderPrivateKeyHex);
  
  const ciphertext = sodium.crypto_box_easy(message, nonce, recipientPk, senderSk);
  
  // Combine nonce and ciphertext
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce);
  payload.set(ciphertext, nonce.length);
  
  return sodium.to_hex(payload);
};

/**
 * Decrypts an incoming message payload
 */
export const decryptMessage = async (encryptedPayloadHex: string, senderPublicKeyHex: string, recipientPrivateKeyHex: string): Promise<string> => {
  await initCrypto();
  const payload = sodium.from_hex(encryptedPayloadHex);
  const nonce = payload.slice(0, sodium.crypto_box_NONCEBYTES);
  const ciphertext = payload.slice(sodium.crypto_box_NONCEBYTES);
  
  const senderPk = sodium.from_hex(senderPublicKeyHex);
  const recipientSk = sodium.from_hex(recipientPrivateKeyHex);
  
  const message = sodium.crypto_box_open_easy(ciphertext, nonce, senderPk, recipientSk);
  return sodium.to_string(message);
};
