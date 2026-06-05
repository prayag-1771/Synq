import * as Y from 'yjs';
import { Socket } from 'socket.io-client';
import { Awareness } from 'y-protocols/awareness';
import { useCryptoStore } from '../stores/cryptoStore';
import { useAuthStore } from '../stores/authStore';
import { encryptMessage, decryptMessage } from './cryptoService';
import { getPublicKeyForUser } from './socketService';
import { localDb } from '../db/localDb';

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class YjsE2EEProvider {
  doc: Y.Doc;
  socket: Socket;
  chatId: string;
  awareness: Awareness;
  private destroyed = false;

  constructor(doc: Y.Doc, socket: Socket, chatId: string) {
    this.doc = doc;
    this.socket = socket;
    this.chatId = chatId;
    this.awareness = new Awareness(doc);

    // Set user info for cursors
    const { user } = useAuthStore.getState();
    if (user) {
      this.awareness.setLocalStateField('user', {
        name: user.username,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      });
    }

    // Bind Yjs Document Sync
    this.doc.on('update', this.handleLocalUpdate);
    this.socket.on('doc:update', this.handleRemoteUpdate);

    // Bind Awareness Sync (Cursors)
    this.awareness.on('update', this.handleLocalAwarenessUpdate);
    this.socket.on('doc:cursor', this.handleRemoteCursor);
    
    // Request full state sync from other participants when joining
    this.socket.emit('doc:request-sync', { chatId: this.chatId });
    this.socket.on('doc:request-sync', this.handleSyncRequest);
  }

  destroy() {
    this.destroyed = true;
    this.doc.off('update', this.handleLocalUpdate);
    this.socket.off('doc:update', this.handleRemoteUpdate);
    
    this.awareness.off('update', this.handleLocalAwarenessUpdate);
    this.socket.off('doc:cursor', this.handleRemoteCursor);
    this.socket.off('doc:request-sync', this.handleSyncRequest);
    
    this.awareness.destroy();
  }

  private handleSyncRequest = async (data: { chatId: string }) => {
    if (data.chatId !== this.chatId || this.destroyed) return;
    // Broadcast our entire document state
    const state = Y.encodeStateAsUpdate(this.doc);
    this.handleLocalUpdate(state, 'sync');
  };

  private handleLocalUpdate = async (update: Uint8Array, origin: any) => {
    if (this.destroyed || origin === this) return; // Prevent echoing remote updates
    
    const base64Str = uint8ArrayToBase64(update);
    const encrypted = await this.encryptPayload(base64Str);
    this.socket.emit('doc:update', { chatId: this.chatId, update: encrypted });
  };

  private handleRemoteUpdate = async (data: { chatId: string, update: string, senderId: string }) => {
    if (data.chatId !== this.chatId || this.destroyed) return;
    
    const { user } = useAuthStore.getState();
    if (data.senderId === user?.id) return; // Ignore our own broadcasted updates if they bounce back

    const decrypted = await this.decryptPayload(data.update, data.senderId);
    if (!decrypted) return;

    try {
      const updateArray = base64ToUint8Array(decrypted);
      Y.applyUpdate(this.doc, updateArray, this); // origin is 'this' so handleLocalUpdate ignores it
    } catch (e) {
      console.error('Yjs apply update error:', e);
    }
  };

  private handleLocalAwarenessUpdate = async ({ added, updated, removed }: any, origin: any) => {
    if (this.destroyed || origin === 'remote') return;
    const changedClients = added.concat(updated, removed);
    const states = Array.from(this.awareness.getStates().entries())
        .filter(([clientId]) => changedClients.includes(clientId));
    
    const jsonStr = JSON.stringify(states);
    const encrypted = await this.encryptPayload(jsonStr);
    this.socket.emit('doc:cursor', { chatId: this.chatId, cursor: encrypted });
  };

  private handleRemoteCursor = async (data: { chatId: string, cursor: string, senderId: string }) => {
    if (data.chatId !== this.chatId || this.destroyed) return;
    
    const { user } = useAuthStore.getState();
    if (data.senderId === user?.id) return;

    const decrypted = await this.decryptPayload(data.cursor, data.senderId);
    if (!decrypted) return;

    try {
      const remoteStates = JSON.parse(decrypted);
      remoteStates.forEach(([clientId, state]: [number, any]) => {
        if (state === null) {
          this.awareness.getStates().delete(clientId);
        } else {
          this.awareness.getStates().set(clientId, state);
        }
      });
      this.awareness.emit('update', [{ added: [], updated: remoteStates.map((s:any)=>s[0]), removed: [] }, 'remote']);
    } catch (e) {
      console.error('Awareness error:', e);
    }
  };

  private async encryptPayload(payload: string): Promise<string> {
    const { privateKeyHex } = useCryptoStore.getState();
    const chat = await localDb.chats.get(this.chatId);
    
    if (privateKeyHex && chat && chat.type === 'DIRECT' && chat.otherUser) {
      try {
        const pk = await getPublicKeyForUser(chat.otherUser.id);
        if (pk) return await encryptMessage(payload, pk, privateKeyHex);
      } catch (e) {
        console.error('Yjs E2EE Encryption failed', e);
      }
    }
    return payload; // fallback to plaintext for group chats or missing keys
  }

  private async decryptPayload(payload: string, senderId: string): Promise<string | null> {
    const { privateKeyHex } = useCryptoStore.getState();
    if (privateKeyHex) {
      try {
        const pk = await getPublicKeyForUser(senderId);
        if (pk) return await decryptMessage(payload, pk, privateKeyHex);
      } catch (e) {
        console.error('Yjs E2EE Decryption failed', e);
      }
    }
    return payload;
  }
}
