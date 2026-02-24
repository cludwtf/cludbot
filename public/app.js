// clud terminal — frontend

const thoughtsEl = document.getElementById('thoughts');
const statUsers = document.getElementById('stat-users');
const statInteractions = document.getElementById('stat-interactions');
const statUptime = document.getElementById('stat-uptime');

let lastThoughtId = 0;

function formatTime(isoStr) {
  const d = new Date(isoStr + 'Z');
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function addThoughtLine(thought) {
  // Remove cursor from previous line
  const cursors = thoughtsEl.querySelectorAll('.cursor-blink');
  cursors.forEach(c => c.remove());
  
  const line = document.createElement('div');
  line.className = 'thought-line';
  
  const time = document.createElement('span');
  time.className = 'thought-time';
  time.textContent = `[${formatTime(thought.created_at)}]`;
  
  const prefix = document.createElement('span');
  prefix.className = 'thought-prefix';
  prefix.textContent = 'clud> ';
  
  const text = document.createElement('span');
  text.className = 'thought-text';
  text.textContent = thought.thought;
  
  const cursor = document.createElement('span');
  cursor.className = 'cursor-blink';
  
  line.appendChild(time);
  line.appendChild(prefix);
  line.appendChild(text);
  line.appendChild(cursor);
  
  thoughtsEl.appendChild(line);
  
  // Keep max 100 lines
  while (thoughtsEl.children.length > 100) {
    thoughtsEl.removeChild(thoughtsEl.firstChild);
  }
  
  // Auto scroll
  thoughtsEl.scrollTop = thoughtsEl.scrollHeight;
}

async function fetchThoughts() {
  try {
    const res = await fetch('/api/thoughts');
    const thoughts = await res.json();
    
    if (!thoughts || !thoughts.length) return;
    
    // On first load, show all. After that, only new ones.
    const newThoughts = thoughts
      .filter(t => t.id > lastThoughtId)
      .reverse(); // oldest first
    
    if (lastThoughtId === 0 && newThoughts.length > 0) {
      // First load — clear initializing message
      thoughtsEl.innerHTML = '';
    }
    
    for (const t of newThoughts) {
      addThoughtLine(t);
      lastThoughtId = Math.max(lastThoughtId, t.id);
    }
  } catch (e) {
    console.error('Failed to fetch thoughts:', e);
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    
    statUsers.textContent = stats.users.toLocaleString();
    statInteractions.textContent = stats.interactions.toLocaleString();
    statUptime.textContent = formatUptime(stats.uptime);
  } catch (e) {
    console.error('Failed to fetch stats:', e);
  }
}

function copyCA() {
  const ca = document.getElementById('ca').textContent;
  if (ca === 'TBD') return;
  navigator.clipboard.writeText(ca).then(() => {
    const el = document.getElementById('ca');
    const orig = el.textContent;
    el.textContent = 'copied!';
    setTimeout(() => { el.textContent = orig; }, 1500);
  });
}

async function fetchInteractions() {
  try {
    const res = await fetch('/api/interactions');
    const rows = await res.json();
    const el = document.getElementById('interactions');
    if (!rows || !rows.length) {
      el.innerHTML = '<div class="thought-line"><span class="thought-prefix">clud> </span><span class="thought-text">no conversations yet. someone talk to me.</span></div>';
      return;
    }
    el.innerHTML = '';
    for (const r of rows.slice(0, 20)) {
      const line = document.createElement('div');
      line.className = 'thought-line';
      line.innerHTML = `<span class="thought-time">[${formatTime(r.created_at)}]</span> <span style="color:#ff6b6b">@${r.username || '???'}</span>: ${escHtml(r.user_text?.substring(0,80) || '')}<br><span class="thought-prefix">  └ clud> </span><span class="thought-text">${escHtml(r.clud_reply?.substring(0,120) || '')}</span>`;
      el.appendChild(line);
    }
  } catch(e) { console.error('interactions fetch:', e); }
}
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Initial fetch
fetchInteractions();
fetchThoughts();
fetchStats();

// Poll for updates
setInterval(fetchThoughts, 15000);  // every 15s
setInterval(fetchStats, 30000);     // every 30s
setInterval(fetchInteractions, 30000); // every 30s
