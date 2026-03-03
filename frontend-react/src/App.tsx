import { useState } from 'react';
import { AnalyzerForm } from './components/AnalyzerForm';
import { AnalysisResultCard } from './components/AnalysisResultCard';
import { analyzeProductPrice, analyzeRawProductText } from './services/prismService';
import type { AnalysisResult, BasicInput, ProductInput } from './types';

export default function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze(input: ProductInput | BasicInput) {
    setIsLoading(true);
    setError(null);
    try {
      const response = 'text' in input ? await analyzeRawProductText(input) : await analyzeProductPrice(input);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>PRISM React Scanner</h1>
        <p>DeepSeek-based text, image, and voice assisted price intelligence.</p>
      </header>

      <AnalyzerForm onAnalyze={handleAnalyze} isLoading={isLoading} />

      {error && <div className="error-banner">{error}</div>}
      {result && <AnalysisResultCard result={result} />}
    </main>
  );
}

