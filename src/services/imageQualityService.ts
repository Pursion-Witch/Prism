import sharp from 'sharp';

export interface ImageQualityAnalysis {
  is_acceptable: boolean;
  brightness_level: 'dark' | 'normal' | 'bright' | 'overexposed';
  estimated_brightness: number; // 0-255
  blur_detected: boolean;
  blur_score: number; // Higher = sharper
  error?: string;
  recommendations: string[];
}

export interface ImagePreprocessResult {
  buffer: Buffer;
  width: number | null;
  height: number | null;
}

/**
 * Analyze image quality to detect potential issues before sending to vision API.
 * This saves API calls and improves reliability.
 */
export async function analyzeImageQuality(imageBuffer: Buffer): Promise<ImageQualityAnalysis> {
  try {
    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        is_acceptable: false,
        brightness_level: 'normal',
        estimated_brightness: 128,
        blur_detected: true,
        blur_score: 0,
        error: 'Empty image buffer',
        recommendations: ['Image buffer is empty']
      };
    }

    // Get image metadata and histogram
    const stats = await sharp(imageBuffer).greyscale().stats();

    if (!stats || !stats.channels || stats.channels.length === 0) {
      return {
        is_acceptable: true,
        brightness_level: 'normal',
        estimated_brightness: 128,
        blur_detected: false,
        blur_score: 50,
        recommendations: []
      };
    }

    const brightness = stats.channels[0]?.mean ?? 128;
    const recommendations: string[] = [];

    // Analyze brightness
    let brightLevel: 'dark' | 'normal' | 'bright' | 'overexposed' = 'normal';
    if (brightness < 50) {
      brightLevel = 'dark';
      recommendations.push('Image is too dark. Retake in better lighting.');
    } else if (brightness < 80) {
      brightLevel = 'dark';
      recommendations.push('Image is quite dark. Better lighting recommended.');
    } else if (brightness > 220) {
      brightLevel = 'overexposed';
      recommendations.push('Image is overexposed. Reduce bright light/reflections.');
    } else if (brightness > 180) {
      brightLevel = 'bright';
      recommendations.push('Image is bright. Try to reduce reflections.');
    }

    // Analyze blur using edge detection
    const blurAnalysis = await detectBlur(imageBuffer);
    const isBlurry = blurAnalysis.blur_score < 8;

    if (isBlurry) {
      recommendations.push('Image appears blurry. Keep steady when capturing.');
    }

    // Overall acceptability
    const isAcceptable =
      !isBlurry && brightLevel !== 'dark' && brightLevel !== 'overexposed';

    return {
      is_acceptable: isAcceptable,
      brightness_level: brightLevel,
      estimated_brightness: Math.round(brightness),
      blur_detected: isBlurry,
      blur_score: blurAnalysis.blur_score,
      recommendations
    };
  } catch (error) {
    // If analysis fails, return neutral assessment (don't block processing)
    return {
      is_acceptable: true,
      brightness_level: 'normal',
      estimated_brightness: 128,
      blur_detected: false,
      blur_score: 50,
      error: error instanceof Error ? error.message : 'Unknown error during image analysis',
      recommendations: []
    };
  }
}

/**
 * Apply a lightweight enhancement pass to improve OCR/vision reliability.
 */
export async function preprocessImageForScan(imageBuffer: Buffer): Promise<ImagePreprocessResult> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width ?? null;
  const height = metadata.height ?? null;

  let pipeline = sharp(imageBuffer, { failOn: 'none' }).rotate().normalize().sharpen();
  if (width && width < 1200) {
    pipeline = pipeline.resize({ width: 1200, withoutEnlargement: false, fit: 'inside' });
  }

  const buffer = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { buffer, width, height };
}

/**
 * Detect blur in an image using edge detection via convolution.
 * The idea: sharp images have high variance in edges, blurry ones don't.
 */
async function detectBlur(
  imageBuffer: Buffer
): Promise<{ blur_score: number; is_blurry: boolean }> {
  try {
    // Use Laplacian kernel for edge detection
    const laplacianKernel = [
      [0, -1, 0],
      [-1, 4, -1],
      [0, -1, 0]
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeImage = await (sharp(imageBuffer) as any)
      .greyscale()
      .convolve({
        kernel: laplacianKernel
      })
      .stats();

    // Standard deviation of edge detection indicates sharpness
    const edgeVariance = edgeImage?.channels?.[0]?.stdev ?? 0;

    // Normalize to 0-100 scale (empirically determined)
    // Values > 15 usually indicate sharp images, < 5 usually indicate blur
    const blurScore = Math.min(100, Math.max(0, edgeVariance * 2));

    return {
      blur_score: Number(blurScore.toFixed(1)),
      is_blurry: blurScore < 8
    };
  } catch {
    // If blur detection fails, assume image is ok
    return {
      blur_score: 50,
      is_blurry: false
    };
  }
}

/**
 * Get user-friendly message based on quality analysis.
 */
export function getQualityFeedback(analysis: ImageQualityAnalysis): string {
  if (!analysis.is_acceptable) {
    if (analysis.recommendations.length > 0) {
      return analysis.recommendations[0];
    }
    return 'Image quality is poor. Please retake the photo.';
  }
  return 'Image quality is acceptable.';
}

/**
 * Check if an image is acceptable for processing.
 */
export function isImageAcceptable(analysis: ImageQualityAnalysis): boolean {
  return analysis.is_acceptable;
}
