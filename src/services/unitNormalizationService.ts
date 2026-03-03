import { sanitizeText } from './serviceUtils';

export interface PriceNormalizationResult {
  submitted_quantity: number;
  submitted_unit: string;
  normalized_quantity: number;
  normalized_unit: string;
  normalized_price: number;
  note: string;
}

const MAX_REASONABLE_QUANTITY = 100000;

function clampQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_REASONABLE_QUANTITY) {
    return 1;
  }

  return Number(value.toFixed(6));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Number(value.toFixed(2));
}

function parseNumber(token: string): number | null {
  const parsed = Number(token.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function inferEggQuantity(text: string): number | null {
  const dozenMatch = text.match(/\bdozen\b|\b12\s*(?:pcs?|pieces?|eggs?)\b/i);
  if (dozenMatch) {
    return 12;
  }

  const trayMatch = text.match(/\btray(?:\s*of)?\s*([0-9]{1,3})?\b/i);
  if (trayMatch) {
    const parsedTray = trayMatch[1] ? parseNumber(trayMatch[1]) : 30;
    return parsedTray ?? 30;
  }

  const eggsBefore = text.match(/\b([0-9]{1,3})\s*eggs?\b/i);
  if (eggsBefore?.[1]) {
    return parseNumber(eggsBefore[1]);
  }

  const eggsAfter = text.match(/\beggs?\s*([0-9]{1,3})\b/i);
  if (eggsAfter?.[1]) {
    return parseNumber(eggsAfter[1]);
  }

  return null;
}

function inferMetricQuantity(text: string): { quantity: number; unit: string; normalizedUnit: string } | null {
  const kgMatch = text.match(/\b([0-9]{1,5}(?:\.[0-9]+)?)\s*(kg|kilo|kilos|kilogram|kilograms)\b/i);
  if (kgMatch?.[1]) {
    const parsed = parseNumber(kgMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'kg', normalizedUnit: 'kg' };
    }
  }

  const gramMatch = text.match(/\b([0-9]{1,5}(?:\.[0-9]+)?)\s*(g|gram|grams)\b/i);
  if (gramMatch?.[1]) {
    const parsed = parseNumber(gramMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'g', normalizedUnit: 'kg' };
    }
  }

  const literMatch = text.match(/\b([0-9]{1,5}(?:\.[0-9]+)?)\s*(l|liter|liters|litre|litres)\b/i);
  if (literMatch?.[1]) {
    const parsed = parseNumber(literMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'liter', normalizedUnit: 'liter' };
    }
  }

  const mlMatch = text.match(/\b([0-9]{1,5}(?:\.[0-9]+)?)\s*(ml|milliliter|milliliters)\b/i);
  if (mlMatch?.[1]) {
    const parsed = parseNumber(mlMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'ml', normalizedUnit: 'liter' };
    }
  }

  const packagedCountTrailingMatch = text.match(
    /\b(?:pack|packs|bundle|bundles|box|boxes|carton|cartons|bottle|bottles|can|cans|sachet|sachets)\s*(?:of\s*)?([0-9]{1,4})\b/i
  );
  if (packagedCountTrailingMatch?.[1]) {
    const parsed = parseNumber(packagedCountTrailingMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'piece', normalizedUnit: 'piece' };
    }
  }

  const packagedCountLeadingMatch = text.match(
    /\b([0-9]{1,4})\s*(?:pack|packs|bundle|bundles|box|boxes|carton|cartons|bottle|bottles|can|cans|sachet|sachets)\b/i
  );
  if (packagedCountLeadingMatch?.[1]) {
    const parsed = parseNumber(packagedCountLeadingMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'piece', normalizedUnit: 'piece' };
    }
  }

  const piecesMatch = text.match(/\b([0-9]{1,4})\s*(pcs?|pieces?|pack|packs)\b/i);
  if (piecesMatch?.[1]) {
    const parsed = parseNumber(piecesMatch[1]);
    if (parsed) {
      return { quantity: parsed, unit: 'piece', normalizedUnit: 'piece' };
    }
  }

  if (/\bper\s*(kg|kilo|kilogram)\b|\/\s*(kg|kilo)\b/i.test(text)) {
    return { quantity: 1, unit: 'kg', normalizedUnit: 'kg' };
  }

  if (/\bper\s*(liter|litre|l)\b|\/\s*(liter|litre|l)\b/i.test(text)) {
    return { quantity: 1, unit: 'liter', normalizedUnit: 'liter' };
  }

  if (/\bper\s*(piece|pc|pcs|egg|eggs)\b|\/\s*(piece|pc|pcs)\b/i.test(text)) {
    return { quantity: 1, unit: 'piece', normalizedUnit: 'piece' };
  }

  return null;
}

function normalizeQuantityAndPrice(
  price: number,
  quantity: number,
  unit: string,
  normalizedUnit: string
): Pick<PriceNormalizationResult, 'submitted_quantity' | 'submitted_unit' | 'normalized_quantity' | 'normalized_unit' | 'normalized_price'> {
  const safeQuantity = clampQuantity(quantity);
  const safePrice = roundMoney(price);

  let normalizedQuantity = safeQuantity;
  if (unit === 'g' && normalizedUnit === 'kg') {
    normalizedQuantity = safeQuantity / 1000;
  }
  if (unit === 'ml' && normalizedUnit === 'liter') {
    normalizedQuantity = safeQuantity / 1000;
  }

  normalizedQuantity = clampQuantity(normalizedQuantity);
  const normalizedPrice = normalizedQuantity > 0 ? roundMoney(safePrice / normalizedQuantity) : safePrice;

  return {
    submitted_quantity: safeQuantity,
    submitted_unit: unit,
    normalized_quantity: normalizedQuantity,
    normalized_unit: normalizedUnit,
    normalized_price: normalizedPrice
  };
}

export function inferPriceNormalization(rawText: string, itemName: string, submittedPrice: number): PriceNormalizationResult {
  const safePrice = roundMoney(submittedPrice);
  if (safePrice <= 0) {
    return {
      submitted_quantity: 1,
      submitted_unit: 'piece',
      normalized_quantity: 1,
      normalized_unit: 'piece',
      normalized_price: 0,
      note: 'Price not available for quantity normalization.'
    };
  }

  const text = sanitizeText(`${rawText} ${itemName}`.toLowerCase());
  const isEggItem = /\begg|eggs|itlog\b/i.test(text);

  if (isEggItem) {
    const eggQuantity = inferEggQuantity(text);
    if (eggQuantity && eggQuantity > 0) {
      const normalized = normalizeQuantityAndPrice(safePrice, eggQuantity, 'piece', 'piece');
      return {
        ...normalized,
        note:
          eggQuantity === 12
            ? 'Egg quantity interpreted as one dozen (12 eggs).'
            : `Egg quantity interpreted as ${eggQuantity} piece(s).`
      };
    }
  }

  const metricQuantity = inferMetricQuantity(text);
  if (metricQuantity) {
    const normalized = normalizeQuantityAndPrice(
      safePrice,
      metricQuantity.quantity,
      metricQuantity.unit,
      metricQuantity.normalizedUnit
    );
    return {
      ...normalized,
      note: `Quantity normalized from ${metricQuantity.unit} to ${metricQuantity.normalizedUnit}.`
    };
  }

  return {
    submitted_quantity: 1,
    submitted_unit: 'piece',
    normalized_quantity: 1,
    normalized_unit: 'piece',
    normalized_price: safePrice,
    note: 'No quantity marker found. Price treated as per singular piece.'
  };
}
