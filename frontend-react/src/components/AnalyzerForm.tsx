import { type ChangeEvent, type FormEvent, useState } from 'react';
import type { BasicInput, PhilippineRegion, ProductInput, SellerType } from '../types';
import { AudioCapture } from './AudioCapture';
import { ImageCapture } from './ImageCapture';

interface AnalyzerFormProps {
  onAnalyze: (data: ProductInput | BasicInput) => Promise<void>;
  isLoading: boolean;
}

const PHILIPPINE_REGIONS: PhilippineRegion[] = [
  'NCR',
  'CAR',
  'Region I',
  'Region II',
  'Region III',
  'Region IV-A',
  'Region IV-B',
  'Region V',
  'Region VI',
  'Region VII',
  'Region VIII',
  'Region IX',
  'Region X',
  'Region XI',
  'Region XII',
  'Caraga',
  'BARMM'
];

const SELLER_TYPES: SellerType[] = [
  'Supermarket',
  'Public Market (Palengke)',
  'Sari-sari Store',
  'Online (Lazada/Shopee)',
  'Drugstore',
  'Hardware',
  'Department Store'
];

type Tab = 'basic' | 'advanced';

export function AnalyzerForm({ onAnalyze, isLoading }: AnalyzerFormProps) {
  const [activeTab, setActiveTab] = useState<Tab>('basic');
  const [basicInput, setBasicInput] = useState('');
  const [showCamera, setShowCamera] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [voiceLanguage, setVoiceLanguage] = useState('en');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductInput>({
    name: '',
    price: '',
    category: 'Basic Commodities',
    details: '',
    region: 'NCR',
    sellerType: 'Supermarket'
  });

  async function handleBasicSubmit(event: FormEvent) {
    event.preventDefault();
    if (!basicInput.trim() && !capturedImage) return;
    await onAnalyze({ text: basicInput.trim(), image: capturedImage || undefined });
  }

  async function handleAdvancedSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formData.name || !formData.price) return;
    await onAnalyze({ ...formData, image: capturedImage || undefined });
  }

  function handleAdvancedChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function handleCapture(base64: string) {
    setCapturedImage(base64);
    setShowCamera(false);
  }

  function handleTranscribe(text: string) {
    setBasicInput((prev) => (prev ? `${prev} ${text}` : text));
    setShowAudio(false);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const base64 = await fileToBase64(file);
    setCapturedImage(base64);
    event.target.value = '';
  }

  return (
    <div className="form-card">
      <div className="tabs">
        <button type="button" className={activeTab === 'basic' ? 'tab active' : 'tab'} onClick={() => setActiveTab('basic')}>
          Basic Check
        </button>
        <button
          type="button"
          className={activeTab === 'advanced' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('advanced')}
        >
          Advanced Check
        </button>
      </div>

      {activeTab === 'basic' ? (
        <form className="form-body" onSubmit={(event) => void handleBasicSubmit(event)}>
          <label className="label">Describe product or ask directly</label>
          <textarea
            className="input textarea"
            rows={4}
            value={basicInput}
            onChange={(event) => setBasicInput(event.target.value)}
            placeholder="Example: Yakult in Cebu or Bigas NFA 45 per kilo"
          />

          {capturedImage && (
            <div className="image-preview">
              <img src={`data:image/jpeg;base64,${capturedImage}`} alt="Captured" />
              <button type="button" className="danger-btn" onClick={() => setCapturedImage(null)}>
                Remove
              </button>
            </div>
          )}

          <div className="row">
            <button type="button" className="ghost-btn" onClick={() => setShowCamera(true)}>
              Camera
            </button>
            <button type="button" className="ghost-btn" onClick={() => setShowAudio(true)}>
              Voice
            </button>
            <label className="ghost-btn file-label">
              Upload
              <input type="file" accept="image/*" onChange={(event) => void handleUpload(event)} />
            </label>
            <select className="input select-inline" value={voiceLanguage} onChange={(event) => setVoiceLanguage(event.target.value)}>
              <option value="en">English</option>
              <option value="tl">Tagalog</option>
              <option value="ceb">Cebuano</option>
            </select>
          </div>

          <button type="submit" className="primary-btn full" disabled={isLoading || (!basicInput.trim() && !capturedImage)}>
            {isLoading ? 'Analyzing...' : 'Check Price Now'}
          </button>
        </form>
      ) : (
        <form className="form-body" onSubmit={(event) => void handleAdvancedSubmit(event)}>
          <label className="label">Product Name</label>
          <input className="input" name="name" value={formData.name} onChange={handleAdvancedChange} required />

          <div className="two-col">
            <div>
              <label className="label">Price (PHP)</label>
              <input className="input" name="price" value={formData.price} onChange={handleAdvancedChange} required />
            </div>
            <div>
              <label className="label">Category</label>
              <input className="input" name="category" value={formData.category} onChange={handleAdvancedChange} />
            </div>
          </div>

          <div className="two-col">
            <div>
              <label className="label">Region</label>
              <select className="input" name="region" value={formData.region} onChange={handleAdvancedChange}>
                {PHILIPPINE_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Seller Type</label>
              <select className="input" name="sellerType" value={formData.sellerType} onChange={handleAdvancedChange}>
                {SELLER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="label">Details</label>
          <textarea className="input textarea" name="details" value={formData.details} onChange={handleAdvancedChange} />

          <div className="row">
            <button type="button" className="ghost-btn" onClick={() => setShowCamera(true)}>
              Capture Item
            </button>
            {capturedImage && <span className="small-note">Image ready</span>}
          </div>

          <button type="submit" className="primary-btn full" disabled={isLoading}>
            {isLoading ? 'Analyzing...' : 'Run Advanced Check'}
          </button>
        </form>
      )}

      {showCamera && <ImageCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />}
      {showAudio && <AudioCapture language={voiceLanguage} onTranscribe={handleTranscribe} onClose={() => setShowAudio(false)} />}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const base64 = value.split(',')[1] || '';
      if (!base64) {
        reject(new Error('Failed to read file.'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}
