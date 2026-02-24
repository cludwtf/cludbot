/**
 * Bot Detection — filters out bots and spam from mentions
 * Checks: account age, follower count, tweet patterns, known bot markers
 */

function isLikelyBot(user) {
  const reasons = [];

  // Account age check (< 7 days)
  if (user.created_at) {
    const age = Date.now() - new Date(user.created_at).getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) {
      reasons.push('account < 7 days old');
    }
  }

  // Zero followers
  const followers = user.public_metrics?.followers_count || 0;
  if (followers === 0) {
    reasons.push('0 followers');
  }

  // Extremely low follower:following ratio (follows 1000+ but has < 10 followers)
  const following = user.public_metrics?.following_count || 0;
  if (following > 500 && followers < 10) {
    reasons.push('suspicious follow ratio');
  }

  // Username patterns common in bots
  const username = (user.username || '').toLowerCase();
  const botPatterns = [
    /^[a-z]+\d{6,}$/,           // name followed by 6+ digits
    /airdrop/i,
    /giveaway/i,
    /free.*crypto/i,
    /claim.*now/i,
  ];
  if (botPatterns.some(p => p.test(username))) {
    reasons.push('bot username pattern');
  }

  // Bio patterns
  const bio = (user.description || '').toLowerCase();
  const bioBotPatterns = ['airdrop', 'dm for promo', 'send dm', 'click link', 'free crypto', 'giveaway'];
  if (bioBotPatterns.some(p => bio.includes(p))) {
    reasons.push('bot bio pattern');
  }

  // Default profile (no pfp, no bio, no banner)
  if (user.profile_image_url?.includes('default_profile') && !user.description) {
    reasons.push('default profile with no bio');
  }

  // Verdict: 2+ bot signals = likely bot
  const isBot = reasons.length >= 2;

  return { isBot, reasons, confidence: Math.min(reasons.length / 3, 1) };
}

function shouldReply(user, tweetText) {
  const { isBot, reasons } = isLikelyBot(user);
  
  if (isBot) {
    console.log(`[BOT-DETECT] skipping @${user.username} — ${reasons.join(', ')}`);
    return false;
  }

  // Also skip empty/meaningless mentions
  const text = (tweetText || '').replace(/@\w+/g, '').trim();
  if (text.length < 3) {
    console.log(`[BOT-DETECT] skipping @${user.username} — empty mention`);
    return false;
  }

  return true;
}

module.exports = { isLikelyBot, shouldReply };
