/**
 * Global tweet lock — prevents multiple engines from tweeting simultaneously
 * Any module should call canTweet() before posting and markTweeted() after
 */

let lastTweetTime = 0;
const MIN_GAP_MS = 3 * 60 * 1000; // 3 min minimum between any tweets

function canTweet() {
  return Date.now() - lastTweetTime >= MIN_GAP_MS;
}

function markTweeted() {
  lastTweetTime = Date.now();
}

function waitTime() {
  const remaining = MIN_GAP_MS - (Date.now() - lastTweetTime);
  return Math.max(0, remaining);
}

module.exports = { canTweet, markTweeted, waitTime, MIN_GAP_MS };
