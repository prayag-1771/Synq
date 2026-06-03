import { create } from 'zustand';

export interface IncomingCallData {
  callerId: string;
  callerName: string;
  offer: any;
}

interface CallState {
  isCalling: boolean;
  incomingCall: IncomingCallData | null;
  remoteUserId: string | null;
  remoteUserName: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;

  setIncomingCall: (call: IncomingCallData | null) => void;
  startCall: (remoteUserId: string, remoteUserName: string) => void;
  endCall: () => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  setRemoteStream: (stream: MediaStream | null) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  isCalling: false,
  incomingCall: null,
  remoteUserId: null,
  remoteUserName: null,
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isVideoOff: false,

  setIncomingCall: (call) => set({ incomingCall: call }),
  
  startCall: (remoteUserId, remoteUserName) => set({
    isCalling: true,
    remoteUserId,
    remoteUserName,
    incomingCall: null,
  }),

  endCall: () => {
    const { localStream } = get();
    // Stop local tracks
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    set({
      isCalling: false,
      incomingCall: null,
      remoteUserId: null,
      remoteUserName: null,
      localStream: null,
      remoteStream: null,
      isMuted: false,
      isVideoOff: false,
    });
  },

  setStreams: (local, remote) => set({ localStream: local, remoteStream: remote }),
  setLocalStream: (stream) => set({ localStream: stream }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  
  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = isMuted; // if it was muted (true), enable it.
      });
    }
    set({ isMuted: !isMuted });
  },

  toggleVideo: () => {
    const { localStream, isVideoOff } = get();
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = isVideoOff; // if it was off (true), enable it.
      });
    }
    set({ isVideoOff: !isVideoOff });
  },
}));
