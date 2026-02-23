import fs from 'fs';
import path from 'path';
import axios from 'axios';

export type PriceRecord = {
    id: string;
    item: string;
    city: string;
    price: number;
    currency: string;
    sourceSnippet: string;
    detectedAt: string;
    averagePrice: number;
    deviationPercent: number;
    flag: 'normal' | 'high-risk';
};

type ExtractedPrice = {
    item: string;
    price: number;
    currency?: string;
    sourceSnippet?: string;
};

const LOG_FILE = path.join(__dirname, '../data/price-knowledge-log.json');

function ensureStorage(): void {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, '[]', 'utf-8');
    }
}

function normalizeItem(item: string): string {
    return item.trim().toLowerCase();
}

function safeNumber(value: number): number {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

async function readRecords(): Promise<PriceRecord[]> {
    ensureStorage();
    const raw = await fs.promises.readFile(LOG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
}

async function writeRecords(records: PriceRecord[]): Promise<void> {
    await fs.promises.writeFile(LOG_FILE, JSON.stringify(records, null, 2), 'utf-8');
}

function extractByRegex(documentText: string): ExtractedPrice[] {
    const lines = documentText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const results: ExtractedPrice[] = [];

    const patterns = [
        /^(?<item>[a-zA-Z0-9\s().,-]{2,}?)\s*[-:|]\s*(?:₱|PHP\s*)?(?<price>\d+(?:\.\d{1,2})?)$/i,
        /^(?<item>[a-zA-Z0-9\s().,-]{2,}?)\s+(?:at|price|cost)\s*(?:is|=)?\s*(?:₱|PHP\s*)?(?<price>\d+(?:\.\d{1,2})?)$/i
    ];

    for (const line of lines) {
        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (!match?.groups) continue;
            const item = match.groups.item?.trim();
            const price = Number(match.groups.price);
            if (!item || !Number.isFinite(price)) continue;
            results.push({
                item,
                price,
                currency: 'PHP',
                sourceSnippet: line
            });
            break;
        }
    }

    return results;
}

async function extractWithAI(documentText: string, deepseekApiKey?: string): Promise<ExtractedPrice[]> {
    if (!deepseekApiKey) return [];

    const prompt = [
        'Extract product price entries from the provided document.',
        'Return strict JSON only with this schema:',
        '{"entries":[{"item":"string","price":number,"currency":"PHP","sourceSnippet":"string"}]}',
        'Rules: include only entries with clear numeric prices, use PHP as default currency, no extra text.',
        'Document:',
        documentText
    ].join('\n');

    const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0
        },
        {
            headers: {
                Authorization: `Bearer ${deepseekApiKey}`,
                'Content-Type': 'application/json'
            }
        }
    );

    const content: string = response.data?.choices?.[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

    return entries
        .map((entry: any) => ({
            item: String(entry.item ?? '').trim(),
            price: Number(entry.price),
            currency: String(entry.currency ?? 'PHP').trim() || 'PHP',
            sourceSnippet: String(entry.sourceSnippet ?? '').trim()
        }))
        .filter((entry: ExtractedPrice) => entry.item && Number.isFinite(entry.price) && entry.price > 0);
}

function computeAverage(existing: PriceRecord[], item: string, city: string): number {
    const normalized = normalizeItem(item);
    const matches = existing.filter((record) => normalizeItem(record.item) === normalized && record.city === city);
    if (!matches.length) return 0;
    const sum = matches.reduce((total, record) => total + record.price, 0);
    return sum / matches.length;
}

export async function scanAndLogDocument(input: {
    documentText: string;
    city?: string;
    deepseekApiKey?: string;
}): Promise<{
    city: string;
    scannedCount: number;
    storedCount: number;
    highRiskCount: number;
    records: PriceRecord[];
}> {
    const city = (input.city ?? 'cebu').toLowerCase();
    const existing = await readRecords();

    let extracted: ExtractedPrice[] = [];
    try {
        extracted = await extractWithAI(input.documentText, input.deepseekApiKey);
    } catch (_error) {
        extracted = [];
    }

    if (!extracted.length) {
        extracted = extractByRegex(input.documentText);
    }

    const stored: PriceRecord[] = [];

    for (const entry of extracted) {
        const baselineAverage = computeAverage(existing, entry.item, city);
        const averagePrice = baselineAverage > 0 ? baselineAverage : entry.price;
        const deviationPercent = averagePrice > 0 ? ((entry.price - averagePrice) / averagePrice) * 100 : 0;
        const flag: 'normal' | 'high-risk' = deviationPercent > 30 ? 'high-risk' : 'normal';

        const record: PriceRecord = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            item: entry.item,
            city,
            price: safeNumber(entry.price),
            currency: entry.currency ?? 'PHP',
            sourceSnippet: entry.sourceSnippet ?? entry.item,
            detectedAt: new Date().toISOString(),
            averagePrice: safeNumber(averagePrice),
            deviationPercent: safeNumber(deviationPercent),
            flag
        };

        existing.push(record);
        stored.push(record);
    }

    if (stored.length) {
        await writeRecords(existing);
    }

    return {
        city,
        scannedCount: extracted.length,
        storedCount: stored.length,
        highRiskCount: stored.filter((record) => record.flag === 'high-risk').length,
        records: stored
    };
}

export async function getKnowledgeBaseRecords(filters?: { city?: string; item?: string }): Promise<PriceRecord[]> {
    const records = await readRecords();
    const city = filters?.city?.toLowerCase();
    const item = filters?.item?.toLowerCase();

    return records.filter((record) => {
        if (city && record.city !== city) return false;
        if (item && !record.item.toLowerCase().includes(item)) return false;
        return true;
    });
}

export function computeAverages(records: PriceRecord[]): Array<{ item: string; city: string; averagePrice: number; count: number }> {
    const grouped = new Map<string, { item: string; city: string; sum: number; count: number }>();

    for (const record of records) {
        const key = `${normalizeItem(record.item)}::${record.city}`;
        const group = grouped.get(key) ?? { item: record.item, city: record.city, sum: 0, count: 0 };
        group.sum += record.price;
        group.count += 1;
        grouped.set(key, group);
    }

    return Array.from(grouped.values()).map((group) => ({
        item: group.item,
        city: group.city,
        averagePrice: safeNumber(group.sum / group.count),
        count: group.count
    }));
}
