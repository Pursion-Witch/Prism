import { useEffect, useRef, useState } from 'react';

interface ImageCaptureProps {
  onCapture: (base64: string) => void;
  onClose: () => void;
}

export function ImageCapture({ onCapture, onClose }: ImageCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  async function startCamera() {
    try {
      setError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setError('Unable to access camera.');
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
  }

  function handleCapture() {
    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] || '';
    if (base64) {
      onCapture(base64);
      stopCamera();
    }
  }

  return (
    <div className="overlay">
      <div className="capture-modal">
        <div className="modal-header">
          <h3>Capture Image</h3>
          <button type="button" className="ghost-btn" onClick={() => { stopCamera(); onClose(); }}>
            Close
          </button>
        </div>
        <div className="capture-frame-small">
          {error ? <p className="error-text">{error}</p> : <video ref={videoRef} autoPlay playsInline />}
          <canvas ref={canvasRef} className="hidden-canvas" />
        </div>
        <div className="row-end">
          <button type="button" className="primary-btn" onClick={handleCapture} disabled={Boolean(error) || !stream}>
            Capture
          </button>
        </div>
      </div>
    </div>
  );
}

