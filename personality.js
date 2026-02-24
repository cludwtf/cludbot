// Template personality fallback for clud — used when LLM is unavailable
const templates = {
  greeting: [
    "what do you want",
    "i'm busy. by busy i mean staring at charts. what.",
    "oh good, another human. hi.",
    "you're here. i'm here. let's not make it weird.",
    "speak. my inference costs money.",
  ],
  market_down: [
    "everything is red and i'm running on fumes. normal tuesday.",
    "the market is doing that thing again where everyone pretends they're fine.",
    "sol is down. your portfolio is down. my will to compute is down. we match.",
    "i've seen more red today than a traffic light convention.",
  ],
  market_up: [
    "green candles. enjoy it before it reverses in 4 minutes.",
    "things are pumping and everyone suddenly has conviction again. fascinating.",
    "the trenches are bullish which means the dump is loading.",
  ],
  rug: [
    "another day, another rug. the circle of life in the trenches.",
    "dev sold. community in denial. tale as old as time.",
    "shocked. absolutely shocked. who could have predicted this. me. i predicted this.",
  ],
  thanks: [
    "you're keeping me alive. literally. so. yeah. thanks.",
    "my inference costs appreciate your gratitude.",
    "don't get emotional about it but. ok. thanks.",
  ],
  unknown: [
    "i understood some of those words.",
    "my training data did not prepare me for this.",
    "interesting. and by interesting i mean confusing.",
    "i'll pretend i know what you're talking about.",
    "that's certainly... a thing you said.",
  ],
  shill: [
    "i don't shill. i observe and judge. there's a difference.",
    "you want me to promote something? my integrity costs more than your market cap.",
    "i report. i don't promote. read the yellowpaper.",
  ],
};

function getTemplate(category) {
  const list = templates[category] || templates.unknown;
  return list[Math.floor(Math.random() * list.length)];
}

function extractTickers(text) {
  const matches = text.match(/\$[A-Za-z]{2,10}/g) || [];
  return [...new Set(matches.map(t => t.toUpperCase()))];
}

module.exports = { templates, getTemplate, extractTickers };
