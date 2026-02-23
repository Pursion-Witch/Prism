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
 
+
+app.get('/', (_req, res) => {
+    res.sendFile(path.join(__dirname, '../public/index.html'));
+});
+
+app.get('/product-scanner', (_req, res) => {
+    res.sendFile(path.join(__dirname, '../public/product-scanner.html'));
+});
+
+app.get('/dashboard', (_req, res) => {
+    res.sendFile(path.join(__dirname, '../public/dashboard.html'));
+});
+
+app.get('/marketplace', (_req, res) => {
+    res.sendFile(path.join(__dirname, '../public/marketplace.html'));
+});
+
+app.get('/admin-panel', (_req, res) => {
+    res.sendFile(path.join(__dirname, '../public/admin-panel.html'));
+});
+
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
