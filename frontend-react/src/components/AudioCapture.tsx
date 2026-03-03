import { useRef, useState } from 'react';
import { transcribeAudio } from '../services/prismService';
import type { AudioTranscriptResult, VoiceLanguage } from '../types';

interface AudioCaptureProps {
  onTranscribe: (result: AudioTranscriptResult) => void;
  onClose: () => void;
  language: VoiceLanguage;
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
        const mimeType = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        try {
          const base64 = await toBase64(audioBlob);
          const payload = await transcribeAudio(base64, mimeType, language);
          const text = String(payload.canonical_text || payload.translated_text || payload.transcribed_text || '').trim();

          if (!text) {
            setError('No speech detected. Please try again.');
            return;
          }

          onTranscribe({
            text,
            translatedText: payload.translated_text,
            canonicalText: payload.canonical_text,
            priceLines: payload.price_lines || [],
            source: 'backend-transcribe'
          });
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
    } catch {
      setError('Could not access microphone. Please allow permission and retry.');
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current || !isRecording) {
      return;
    }

    mediaRecorderRef.current.stop();
    setIsRecording(false);
  }

  function closeModal() {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    onClose();
  }

  return (
    <div className="overlay">
      <div className="audio-modal">
        <div className="modal-header">
          <h3>Voice Input</h3>
          <button type="button" className="ghost-btn" onClick={closeModal} disabled={isProcessing}>
            Close
          </button>
        </div>

        <div className="audio-state">
          {isProcessing
            ? 'Transcribing audio...'
            : isRecording
              ? 'Recording... Press Stop when finished.'
              : 'Press Start to begin recording. Press Stop when done.'}
        </div>

        {error && <p className="error-text">{error}</p>}

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
