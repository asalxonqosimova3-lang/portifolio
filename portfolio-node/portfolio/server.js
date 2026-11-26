// Oddiy Node.js server: saytni ko'rsatadi va formadan kelgan xabarni Telegram botga yuboradi.
// Qo'shimcha paket o'rnatish shart emas. Node.js 18 yoki yangisi kerak.
const http = require('http');
const fs = require('fs');
const path = require('path');

// .env faylini o'qish
try {
  const envText = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
} catch (e) {
  console.log('.env fayli topilmadi');
}

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
};
const PUBLIC = new Set(['index.html', 'photo.jpg', 'photo.jpeg', 'photo.png', 'photo.webp']);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

// Spamdan himoya: bitta IP daqiqasiga 5 ta xabar
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

async function handleSend(req, res) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10000) return send(res, 413, { error: 'Xabar juda katta.' });
  }
  let b = {};
  try { b = JSON.parse(raw || '{}'); } catch { b = {}; }

  if (b.website) return send(res, 200, { ok: true }); // spam tuzog'i
  if (limited(req.socket.remoteAddress)) return send(res, 429, { error: "Juda ko'p urinish. Bir daqiqadan keyin qayta yuboring." });
  if (!TOKEN || !CHAT_ID) return send(res, 500, { error: '.env faylida token yoki chat ID yozilmagan.' });

  const name = String(b.name || '').trim().slice(0, 80);
  const contact = String(b.contact || '').trim().slice(0, 80);
  const service = String(b.service || '').trim().slice(0, 80);
  const msg = String(b.msg || '').trim().slice(0, 1000);
  if (!name || !contact || !msg) return send(res, 400, { error: "Barcha maydonlarni to'ldiring." });

  const text =
    '<b>Saytdan yangi xabar</b>\n\n' +
    '<b>Ism:</b> ' + esc(name) + '\n' +
    '<b>Aloqa:</b> ' + esc(contact) + '\n' +
    '<b>Xizmat:</b> ' + esc(service) + '\n' +
    '<b>Xabar:</b> ' + esc(msg);

  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      console.log('Telegram xatosi:', r.status, d.description || '');
      return send(res, 502, { error: "Telegramga yuborib bo'lmadi: " + (d.description || r.status) });
    }
    console.log('Xabar yuborildi:', name);
    return send(res, 200, { ok: true });
  } catch (e) {
    console.log('Ulanish xatosi:', e.message);
    return send(res, 502, { error: "Telegramga ulanib bo'lmadi. Internetni tekshiring." });
  }
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (url === '/api/send') {
    if (req.method !== 'POST') return send(res, 405, { error: 'Faqat POST' });
    return handleSend(req, res);
  }

  const file = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  if (!PUBLIC.has(file)) { res.writeHead(404); return res.end('Topilmadi'); }
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Topilmadi'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Sayt ishga tushdi: http://localhost:' + PORT);
  if (!TOKEN || !CHAT_ID) console.log('Diqqat: .env faylida TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID yozilmagan.');
});
