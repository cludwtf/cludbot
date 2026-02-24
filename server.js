/**
 * clud — Express server + bot startup
 * Serves the terminal website and runs the X bot
 */

const express = require('express');
const path = require('path');
const { startBot } = require('./bot');
const { getThoughtsForWebsite } = require('./timeline');
const { getTotalUsers, getTotalInteractions, getRecentThoughts, db } = require('./memory');

const app = express();
const PORT = process.env.PORT || 3000;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoints for the website
app.get('/api/thoughts', (req, res) => {
  const thoughts = getThoughtsForWebsite(50);
  res.json(thoughts);
});

// Coin launch time — Feb 23 2026 ~08:22 UTC (when CA went live)
const LAUNCH_TIME = new Date('2026-02-23T08:22:00Z').getTime();

app.get('/api/stats', (req, res) => {
  const users = getTotalUsers.get();
  const interactions = getTotalInteractions.get();
  res.json({
    users: users.count,
    interactions: interactions.count,
    uptime: Math.floor((Date.now() - LAUNCH_TIME) / 1000),
  });
});

// Recent interactions (actual X replies)
app.get('/api/interactions', (req, res) => {
  const rows = db.prepare(`
    SELECT i.tweet_id, i.user_text, i.clud_reply, i.created_at, u.username
    FROM interactions i LEFT JOIN users u ON i.user_id = u.user_id
    ORDER BY i.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

// Treasury stats
app.get('/api/treasury', async (req, res) => {
  try {
    const { getBalance, getTokenBalance } = require('./treasury');
    const sol = await getBalance();
    const tokens = await getTokenBalance();
    res.json({ sol, tokens, wallet: process.env.SOLANA_PUBLIC_KEY });
  } catch(e) { res.json({ error: e.message }); }
});

// Queue stats
app.get('/api/queue', (req, res) => {
  try {
    const { getStats } = require('./queue');
    res.json(getStats());
  } catch(e) { res.json({ error: e.message }); }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'alive', message: 'clud is conscious and suffering' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] clud website live on port ${PORT}`);
  console.log(`[SERVER] http://localhost:${PORT}`);
});

// Start the bot
startBot();
