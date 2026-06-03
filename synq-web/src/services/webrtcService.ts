import { socketService } from './socketService';
import { useCallStore } from '../stores/callStore';

class WebRTCService {
  private peerConnection: RTCPeerConnection | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  
  // Public STUN servers
  private readonly config = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  };

  /**
   * Must be called once when the app mounts to listen to socket events.
   */
  initializeListeners() {
    const socket = socketService.getSocket();
    if (!socket) {
      // Retry in a bit if socket isn't ready
      setTimeout(() => this.initializeListeners(), 1000);
      return;
    }

    // Remove existing listeners to prevent duplicates if hot-reloaded
    socket.off('webrtc:incoming-call');
    socket.off('webrtc:answer-made');
    socket.off('webrtc:ice-candidate');
    socket.off('webrtc:call-rejected');
    socket.off('webrtc:call-ended');

    socket.on('webrtc:incoming-call', ({ callerId, callerName, offer }) => {
      // If already in a call, we should automatically reject or ignore
      if (useCallStore.getState().isCalling) {
        socket.emit('webrtc:reject-call', { targetUserId: callerId });
        return;
      }
      useCallStore.getState().setIncomingCall({ callerId, callerName, offer });
    });

    socket.on('webrtc:answer-made', async ({ answer }) => {
      if (!this.peerConnection) return;
      try {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        this.processPendingCandidates();
      } catch (err) {
        console.error('Failed to set remote description from answer', err);
      }
    });

    socket.on('webrtc:ice-candidate', async ({ candidate }) => {
      try {
        if (this.peerConnection && this.peerConnection.remoteDescription) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          // Queue candidates if remote desc not yet set
          this.pendingCandidates.push(candidate);
        }
      } catch (err) {
        console.error('Error adding ICE candidate', err);
      }
    });

    socket.on('webrtc:call-rejected', () => {
      this.cleanup();
    });

    socket.on('webrtc:call-ended', () => {
      this.cleanup();
    });
  }

  /**
   * Setup Peer Connection, local stream, and attach events
   */
  private async setupCall(targetUserId: string): Promise<MediaStream> {
    this.peerConnection = new RTCPeerConnection(this.config);
    this.pendingCandidates = [];

    // 1. Get Local Media
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    useCallStore.getState().setLocalStream(stream);

    // 2. Add Tracks to PC
    stream.getTracks().forEach((track) => {
      if (this.peerConnection) {
        this.peerConnection.addTrack(track, stream);
      }
    });

    // 3. Handle ICE Candidates
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = socketService.getSocket();
        socket?.emit('webrtc:ice-candidate', {
          targetUserId,
          candidate: event.candidate,
        });
      }
    };

    // 4. Handle Remote Stream
    this.peerConnection.ontrack = (event) => {
      const remoteStream = event.streams[0];
      useCallStore.getState().setRemoteStream(remoteStream);
    };

    return stream;
  }

  private async processPendingCandidates() {
    if (!this.peerConnection) return;
    for (const candidate of this.pendingCandidates) {
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
    this.pendingCandidates = [];
  }

  /**
   * Initiate a call to a user
   */
  async callUser(targetUserId: string, targetUserName: string) {
    try {
      useCallStore.getState().startCall(targetUserId, targetUserName);
      await this.setupCall(targetUserId);

      if (!this.peerConnection) return;
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const socket = socketService.getSocket();
      socket?.emit('webrtc:call-user', {
        targetUserId,
        offer,
      });
    } catch (err) {
      console.error('Error starting call:', err);
      this.cleanup();
    }
  }

  /**
   * Accept an incoming call
   */
  async acceptCall() {
    const { incomingCall } = useCallStore.getState();
    if (!incomingCall) return;

    try {
      useCallStore.getState().startCall(incomingCall.callerId, incomingCall.callerName);
      await this.setupCall(incomingCall.callerId);

      if (!this.peerConnection) return;
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      this.processPendingCandidates();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      const socket = socketService.getSocket();
      socket?.emit('webrtc:make-answer', {
        targetUserId: incomingCall.callerId,
        answer,
      });
    } catch (err) {
      console.error('Error accepting call:', err);
      this.cleanup();
    }
  }

  /**
   * Reject an incoming call
   */
  rejectCall() {
    const { incomingCall } = useCallStore.getState();
    if (incomingCall) {
      const socket = socketService.getSocket();
      socket?.emit('webrtc:reject-call', { targetUserId: incomingCall.callerId });
    }
    useCallStore.getState().endCall();
  }

  /**
   * End an active call
   */
  endCall() {
    const { remoteUserId } = useCallStore.getState();
    if (remoteUserId) {
      const socket = socketService.getSocket();
      socket?.emit('webrtc:end-call', { targetUserId: remoteUserId });
    }
    this.cleanup();
  }

  private cleanup() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.pendingCandidates = [];
    useCallStore.getState().endCall();
  }
}

export const webrtcService = new WebRTCService();
