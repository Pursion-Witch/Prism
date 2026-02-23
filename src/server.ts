import express from 'express';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import baseline from '../data/baseline.json';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Helper:baseline math
// note that 100 ra atong items for this from maynila or cebu tbd
function getBaselinePrice(item: string): number | null {
    const key = item.toLowerCase();
    return (baseline as any)[key] || null;
}

app.post('/api/assess', async (req, res) => {
    const { item, price } = req.body;
    if (!item || price === undefined) {
        return res.status(400).json({ error: 'Missing item or price' });
    }

    const baselinePrice = getBaselinePrice(item);
    if (baselinePrice === null) {
        return res.json({
            message: `Sorry, we don't have baseline data for "${item}" yet.`,
            flag: 'unknown'
        });
    }

    const diffPercent = ((price - baselinePrice) / baselinePrice) * 100;
    let flag = 'fair';
    if (diffPercent > 30) flag = 'high-risk';
    else if (diffPercent > 10) flag = 'overpriced';

    // Knowledge base
    try {
        const prompt = `You are PRISM, a Philippine market analyst. A user wants to buy ${item} at ₱${price}. The fair market value is ₱${baselinePrice}. Tell the user if it's fair, expensive, or suspicious in 2 sentences.`;

        const deepseekRes = await axios.post(
            'https://api.deepseek.com/v1/chat/completions',
            {
                model: 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const message = deepseekRes.data.choices[0].message.content;
        res.json({ message, flag, baseline: baselinePrice });
    } catch (error) {
        console.error('DeepSeek API error:', error);
        // Fallback message
        const fallback = `The baseline price for ${item} is ₱${baselinePrice}. You are paying ₱${price} (${diffPercent > 0 ? '+' : ''}${diffPercent.toFixed(1)}%).`;
        res.json({ message: fallback, flag, baseline: baselinePrice });
    }
});

app.listen(PORT, () => {
    console.log(`PRISM MVP running on http://localhost:${PORT}`);
});