import type { AnalysisResult } from '../types';

interface AnalysisResultCardProps {
  result: AnalysisResult;
}

export function AnalysisResultCard({ result }: AnalysisResultCardProps) {
  return (
    <section className="result-card">
      <div className="result-head">
        <h2>{result.productName}</h2>
        <span className="status-pill">{result.status}</span>
      </div>
      <div className="result-grid">
        <div>
          <div className="metric-label">Submitted Price</div>
          <div className="metric-value">{formatCurrency(result.inputPrice)}</div>
        </div>
        <div>
          <div className="metric-label">Fair Price</div>
          <div className="metric-value">{formatCurrency(result.fairValue)}</div>
        </div>
        <div>
          <div className="metric-label">Region</div>
          <div className="metric-value">{result.region}</div>
        </div>
      </div>
      <p className="reasoning">{result.reasoning}</p>
      {result.priceLines && result.priceLines.length > 0 && (
        <div className="price-lines">
          <h4>Machine Price Lines</h4>
          {result.priceLines.map((line) => (
            <code key={line}>{line}</code>
          ))}
        </div>
      )}
    </section>
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'N/A';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
}

