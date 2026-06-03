import React, { useEffect, useRef } from 'react';
import { useCallStore } from '../stores/callStore';
import { webrtcService } from '../services/webrtcService';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from 'lucide-react';

export default function CallModal() {
  const {
    isCalling,
    incomingCall,
    remoteUserName,
    localStream,
    remoteStream,
    isMuted,
    isVideoOff,
  } = useCallStore();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (!isCalling && !incomingCall) {
    return null;
  }

  // Incoming Call State
  if (incomingCall && !isCalling) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center shadow-2xl max-w-sm w-full mx-4">
          <div className="w-20 h-20 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mb-6 animate-pulse">
            <Phone className="w-8 h-8 text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Incoming Video Call</h2>
          <p className="text-slate-400 mb-8">{incomingCall.callerName} is calling you...</p>
          
          <div className="flex gap-4 w-full">
            <button
              onClick={() => webrtcService.rejectCall()}
              className="flex-1 py-3 px-4 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 font-semibold flex justify-center transition-colors"
            >
              Decline
            </button>
            <button
              onClick={() => webrtcService.acceptCall()}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold flex justify-center shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active Call State
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col animate-in slide-in-from-bottom-8 duration-300">
      {/* Remote Video (Full Screen) */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center animate-pulse">
            <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center mb-4">
              <Video className="w-10 h-10 text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium tracking-wide">Connecting to {remoteUserName}...</p>
          </div>
        )}

        {/* Local Video (PiP) */}
        <div className="absolute top-6 right-6 w-32 md:w-48 aspect-[3/4] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border-2 border-slate-800/80 z-10">
          {localStream ? (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted // Always mute local video so user doesn't hear themselves
              className="w-full h-full object-cover transform scale-x-[-1]"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-900">
              <VideoOff className="w-6 h-6 text-slate-600" />
            </div>
          )}
        </div>

        {/* Name overlay */}
        <div className="absolute top-6 left-6 px-4 py-2 bg-slate-900/60 backdrop-blur-md rounded-lg border border-slate-800/60 text-white font-medium shadow-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          {remoteUserName}
        </div>
      </div>

      {/* Control Bar */}
      <div className="h-24 bg-slate-900 border-t border-slate-800 flex items-center justify-center gap-6 px-6">
        <button
          onClick={() => useCallStore.getState().toggleMute()}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            isMuted 
              ? 'bg-slate-800 text-slate-400 border border-slate-700' 
              : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        <button
          onClick={() => webrtcService.endCall()}
          className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-500/20 transition-all hover:scale-105 active:scale-95"
        >
          <PhoneOff className="w-7 h-7" />
        </button>

        <button
          onClick={() => useCallStore.getState().toggleVideo()}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            isVideoOff 
              ? 'bg-slate-800 text-slate-400 border border-slate-700' 
              : 'bg-slate-800 text-white hover:bg-slate-700'
          }`}
        >
          {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}
