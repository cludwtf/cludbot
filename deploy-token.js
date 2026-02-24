#!/usr/bin/env node
/**
 * clud autonomous token deployment
 * 
 * usage:
 *   node deploy-token.js                    # full brain-consulted deployment
 *   node deploy-token.js --dry-run          # simulate without sending tx
 *   node deploy-token.js --bundle 12        # deploy with 12 SOL initial buy
 *   node deploy-token.js --image ./pfp.png  # specify token image
 * 
 * clud's brain decides the token config. the deployer executes.
 * every decision is stored as a memory. the experiment deploys itself.
 */

const { initBrain, getBrain } = require('./brain');
const { deployToken, generateLaunchTweet } = require('./lib/deployer');
const { chat } = require('./lib/openrouter');
const { tweet } = require('./lib/x-post');
require('dotenv').config();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const bundleIdx = args.indexOf('--bundle');
  const bundleSol = bundleIdx !== -1 ? parseFloat(args[bundleIdx + 1]) : 0;
  const imageIdx = args.indexOf('--image');
  const imageUrl = imageIdx !== -1 ? args[imageIdx + 1] : null;

  console.log('=== CLUD AUTONOMOUS TOKEN DEPLOYMENT ===');
  console.log(`mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`bundle: ${bundleSol || 'none'} SOL`);
  console.log(`image: ${imageUrl || 'none'}`);
  console.log('');

  // Initialize brain
  console.log('[INIT] waking up the cortex...');
  await initBrain();
  const brain = getBrain();

  if (!brain) {
    console.error('[FATAL] brain failed to initialize — cannot deploy without cognition');
    process.exit(1);
  }

  console.log('[INIT] brain online. consulting memories...');

  // Deploy
  const result = await deployToken({
    brain,
    chat,
    imageUrl,
    bundleSol,
    dryRun,
  });

  if (!result.success) {
    console.log(`[ABORT] deployment cancelled: ${result.reason}`);
    process.exit(0);
  }

  console.log('');
  console.log('=== DEPLOYMENT RESULT ===');
  console.log(JSON.stringify(result, null, 2));

  // Generate and post launch tweet (skip in dry run)
  if (!dryRun && result.contractAddress) {
    console.log('');
    console.log('[TWEET] generating launch announcement...');
    
    try {
      const launchTweet = await generateLaunchTweet(brain, chat, result.contractAddress);
      console.log(`[TWEET] "${launchTweet}"`);
      
      const tweetResult = await tweet(launchTweet);
      if (tweetResult?.data?.id) {
        console.log(`[TWEET] posted: https://x.com/cludwtf/status/${tweetResult.data.id}`);
        
        // Store the tweet as a memory
        await brain.store({
          type: 'episodic',
          content: `i tweeted my launch announcement: "${launchTweet}"`,
          summary: 'launch announcement tweet',
          source: 'deployer',
          tags: ['launch', 'tweet', 'milestone'],
          importance: 0.95,
        });
      }
    } catch (e) {
      console.error('[TWEET] failed to post launch tweet:', e.message);
    }
  }

  console.log('');
  console.log('=== DEPLOYMENT COMPLETE ===');
  console.log('the experiment is live. the cortex deployed itself.');
  process.exit(0);
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
