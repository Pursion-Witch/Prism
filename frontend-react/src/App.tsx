import { type FormEvent, useMemo, useState } from 'react';
import { Camera, Mic, Send, X } from 'lucide-react';
import { AudioCapture } from './components/AudioCapture';
import { ImageCapture } from './components/ImageCapture';
import { extractPriceLines, identifyFromImage } from './services/prismService';
import type { AudioTranscriptResult, CaptureSource, LatestResult, VoiceLanguage } from './types';

export default function App() {
  const [showCamera, setShowCamera] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>('en');
  const [textInput, setTextInput] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<LatestResult | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasInput = useMemo(() => Boolean(textInput.trim() || capturedImage), [textInput, capturedImage]);

  function dedupeLines(lines: string[]): string[] {
    const deduped: string[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const clean = line.trim();
      if (!clean) {
        continue;
      }

      const key = clean.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      deduped.push(clean);
    }

    return deduped;
  }

  async function analyzeCurrentInput(
    sourceHint: CaptureSource,
    options?: { text?: string; image?: string | null; seedLines?: string[] }
  ) {
    const text = (options?.text ?? textInput).trim();
    const image = options?.image ?? capturedImage;
    const seedLines = options?.seedLines || [];

    if (!text && !image) {
      return;
    }

    setIsWorking(true);
    setError(null);

    try {
      const linePool: string[] = [...seedLines];
      let productLabel = '';

      const shouldExtractText = Boolean(text) && !(sourceHint === 'voice' && seedLines.length > 0);
      if (shouldExtractText) {
        const textResult = await extractPriceLines(text);
        linePool.push(...(textResult.price_lines || []));
      }

      if (image) {
        const imageResult = await identifyFromImage(image);
        productLabel = imageResult.label;
        linePool.push(...imageResult.priceLines);
      }

      const source: CaptureSource = text && image ? 'mixed' : sourceHint;
      setLatestResult({
        source,
        timestamp: Date.now(),
        textInput: text,
        productLabel,
        priceLines: dedupeLines(linePool)
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recognition failed.');
    } finally {
      setIsWorking(false);
    }
  }

  async function handleImageCapture(base64: string) {
    setCapturedImage(base64);
    setShowCamera(false);
    await analyzeCurrentInput(textInput.trim() ? 'mixed' : 'image', {
      text: textInput,
      image: base64
    });
  }

  async function handleVoiceText(payload: AudioTranscriptResult) {
    setShowAudio(false);
    const combinedText = `${textInput} ${payload.text}`.trim();
    setTextInput(combinedText);

    await analyzeCurrentInput(capturedImage ? 'mixed' : 'voice', {
      text: combinedText,
      image: capturedImage,
      seedLines: payload.priceLines || []
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await analyzeCurrentInput(textInput.trim() && capturedImage ? 'mixed' : textInput.trim() ? 'text' : 'image');
  }

  function handleClear() {
    setTextInput('');
    setCapturedImage(null);
    setLatestResult(null);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>PRISM DeepSeek Scanner</h1>
        <p>Type, speak, or capture an image. The system returns machine-readable price lines immediately.</p>
      </header>

      <section className="form-card">
        <form className="form-body" onSubmit={handleSubmit}>
          <label className="label" htmlFor="prism-basic-input">
            Product Query / OCR Text / Voice Transcript
          </label>
          <textarea
            id="prism-basic-input"
            className="input textarea"
            value={textInput}
            onChange={(event) => setTextInput(event.target.value)}
            placeholder="Example: Yakult 5-pack in Cebu, or Bigas regular milled â‚±52 per kg"
            rows={4}
          />

          {capturedImage && (
            <div className="image-preview">
              <img src={`data:image/jpeg;base64,${capturedImage}`} alt="Captured product" />
              <button type="button" className="ghost-btn" onClick={() => setCapturedImage(null)}>
                <X size={16} />
                Remove image
              </button>
            </div>
          )}

          <div className="row">
            <button type="button" className="ghost-btn" onClick={() => setShowCamera(true)} disabled={isWorking}>
              <Camera size={16} />
              Camera
            </button>
            <button type="button" className="ghost-btn" onClick={() => setShowAudio(true)} disabled={isWorking}>
              <Mic size={16} />
              Voice
            </button>
            <select
              className="input select-inline"
              value={voiceLanguage}
              onChange={(event) => setVoiceLanguage(event.target.value as VoiceLanguage)}
            >
              <option value="en">English</option>
              <option value="tl">Tagalog</option>
              <option value="ceb">Cebuano</option>
            </select>
          </div>

          <div className="row">
            <button type="submit" className="primary-btn" disabled={isWorking || !hasInput}>
              <Send size={16} />
              {isWorking ? 'Recognizing...' : 'Check Price Now'}
            </button>
            <button type="button" className="danger-btn" onClick={handleClear} disabled={isWorking}>
              Clear All
            </button>
          </div>
        </form>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="simple-card">
        <h3>Latest Result</h3>
        {!latestResult ? (
          <p className="value-line">No result yet.</p>
        ) : (
          <>
            <div className="result-grid-small">
              <div className="metric-box">
                <span className="metric-label">Source</span>
                <span className="metric-value">{latestResult.source.toUpperCase()}</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Price Lines</span>
                <span className="metric-value">{latestResult.priceLines.length}</span>
              </div>
              <div className="metric-box">
                <span className="metric-label">Updated</span>
                <span className="metric-value">{new Date(latestResult.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>

            {latestResult.productLabel && (
              <p className="value-line">
                <strong>Detected Product:</strong> {latestResult.productLabel}
              </p>
            )}

            {latestResult.textInput && (
              <p className="value-line">
                <strong>Input Text:</strong> {latestResult.textInput}
              </p>
            )}

            {latestResult.priceLines.length > 0 && (
              <div className="price-lines">
                {latestResult.priceLines.map((line) => (
                  <code key={`line-${line}`}>{line}</code>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {showCamera && <ImageCapture onCapture={(base64) => void handleImageCapture(base64)} onClose={() => setShowCamera(false)} />}
      {showAudio && (
        <AudioCapture
          language={voiceLanguage}
          onTranscribe={(payload) => void handleVoiceText(payload)}
          onClose={() => setShowAudio(false)}
        />
      )}
    </main>
  );
}

