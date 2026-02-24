require('dotenv').config();
const { startPipeline } = require('./news-pipeline');
const { startBreakoutWatcher } = require('./breakout-to-article');

startPipeline();
startBreakoutWatcher();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
