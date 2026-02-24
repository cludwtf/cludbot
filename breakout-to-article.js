/**
 * Breakout Monitor → Article Bridge
 * Watches breakout_alerts.json and generates articles from new alerts
 */

const fs = require('fs');
const path = require('path');
const { writeArticle, publishArticle, tweetArticle, slugify, isAlreadyWritten } = require('./news-pipeline');

const ALERTS_FILE = '/root/.openclaw/data/memory/breakout_alerts.json';
const POLL_INTERVAL = 30000; // 30s

let lastSeenCount = 0;
let watchInterval;

function loadAlerts() {
  try {
    if (!fs.existsSync(ALERTS_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function checkForNewAlerts() {
  const alerts = loadAlerts();
  if (alerts.length <= lastSeenCount) {
    lastSeenCount = alerts.length; // handle file shrinks
    return;
  }

  const newAlerts = alerts.slice(lastSeenCount);
  lastSeenCount = alerts.length;
  console.log(`[BREAKOUT] ${newAlerts.length} new alert(s)`);

  for (const alert of newAlerts) {
    try {
      const sym = alert.symbol || alert.name || 'unknown';
      const slug = slugify(`breakout-${sym}-${Date.now()}`);
      if (isAlreadyWritten(slug)) continue;

      const mcapStr = alert.mcap ? `$${(alert.mcap / 1e6).toFixed(1)}M mcap` : '';
      const volStr = alert.volume ? `$${(alert.volume / 1e6).toFixed(1)}M vol` : '';
      const topic = `${alert.name || sym} ($${sym}) breakout detected — ${[mcapStr, volStr].filter(Boolean).join(', ')}. ${alert.narrative || ''} ${alert.alert_type || ''}`.trim();

      const article = await writeArticle(topic, 'TRENCH NEWS', alert, slug);
      if (article) {
        const published = await publishArticle(article);
        if (published) await tweetArticle(article);
      }
    } catch (e) {
      console.error(`[BREAKOUT] Error processing alert:`, e.message);
    }
  }
}

function startBreakoutWatcher() {
  // Initialize count from existing file
  lastSeenCount = loadAlerts().length;
  console.log(`[BREAKOUT] watcher started — ${lastSeenCount} existing alerts, polling every 30s`);
  watchInterval = setInterval(checkForNewAlerts, POLL_INTERVAL);
}

function stopBreakoutWatcher() {
  if (watchInterval) clearInterval(watchInterval);
}

module.exports = { startBreakoutWatcher, stopBreakoutWatcher };
