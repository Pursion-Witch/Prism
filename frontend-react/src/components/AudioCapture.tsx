import { useRef, useState } from 'react';
import { transcribeAudio } from '../services/prismService';

interface AudioCaptureProps {
  onTranscribe: (text: string) => void;
  onClose: () => void;
  language: string;
}

export function AudioCapture({ onTranscribe, onClose, language }: AudioCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function startRecording() {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        try {
          const base64 = await toBase64(audioBlob);
          const payload = await transcribeAudio(base64, recorder.mimeType || 'audio/webm', language);
          const text = String(payload.canonical_text || payload.translated_text || payload.transcribed_text || '').trim();
          if (text) {
            onTranscribe(text);
          } else {
            setError('No speech detected.');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to transcribe audio.');
        } finally {
          streamRef.current?.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
          setIsProcessing(false);
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('Could not access microphone.');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  return (
    <div className="overlay">
      <div className="audio-modal">
        <div className="modal-header">
          <h3>Voice Input</h3>
          <button type="button" className="ghost-btn" onClick={() => { stopRecording(); onClose(); }} disabled={isProcessing}>
            Close
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="audio-state">{isProcessing ? 'Transcribing audio...' : isRecording ? 'Recording...' : 'Tap to start'}</div>
        {!isProcessing && (
          <button type="button" className="primary-btn" onClick={isRecording ? stopRecording : () => void startRecording()}>
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
        )}
      </div>
    </div>
  );
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const base64 = value.split(',')[1] || '';
      if (!base64) {
        reject(new Error('Failed to read recorded audio.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
    reader.readAsDataURL(blob);
  });
}

