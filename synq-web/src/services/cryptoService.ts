import _sodium from 'libsodium-wrappers';

let sodium: typeof _sodium;

export const initCrypto = async () => {
  if (!sodium) {
    await _sodium.ready;
    sodium = _sodium;
  }
};

/**
 * Derives a symmetric key from a PIN/Password using native WebCrypto PBKDF2
 */
export const deriveKeyFromPin = async (pin: string, saltHex: string): Promise<Uint8Array> => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  // Convert hex string back to Uint8Array
  const saltArray = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltArray,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256 // 32 bytes for libsodium secretbox
  );
  
  return new Uint8Array(derivedBits);
};

export const generateSalt = async (): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
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
  const nonce = sodium.randombytes_buf(24); // crypto_secretbox_NONCEBYTES is 24
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
  const nonce = payload.slice(0, 24); // crypto_secretbox_NONCEBYTES
  const ciphertext = payload.slice(24);
  
  const message = sodium.crypto_secretbox_open_easy(ciphertext, nonce, derivedKey);
  return sodium.to_hex(message);
};

/**
 * Encrypts a message payload for a recipient
 */
export const encryptMessage = async (messageText: string, recipientPublicKeyHex: string, senderPrivateKeyHex: string): Promise<string> => {
  await initCrypto();
  const nonce = sodium.randombytes_buf(24); // crypto_box_NONCEBYTES is 24
  
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
  const nonce = payload.slice(0, 24); // crypto_box_NONCEBYTES is 24
  const ciphertext = payload.slice(24);
  
  const senderPk = sodium.from_hex(senderPublicKeyHex);
  const recipientSk = sodium.from_hex(recipientPrivateKeyHex);
  
  const message = sodium.crypto_box_open_easy(ciphertext, nonce, senderPk, recipientSk);
  return sodium.to_string(message);
};
