import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const { Pool } = pg;
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Railway Postgres usually requires ssl off or rejectUnauthorized false for external
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  
  pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      google_id TEXT PRIMARY KEY,
      email TEXT,
      history JSONB DEFAULT '{}'
    )
  `).catch(err => console.error("DB init error:", err));
} else {
  console.warn("DATABASE_URL not set. Database features will not work.");
}

const googleClient = new OAuth2Client(process.env.VITE_GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {
  if (!token) return null;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.VITE_GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  } catch (e) {
    console.error("Google token verification failed:", e);
    return null;
  }
}

app.post('/api/auth', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    const result = await pool.query(`
      INSERT INTO users (google_id, email, history)
      VALUES ($1, $2, '{}')
      ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING history
    `, [payload.sub, payload.email]);
    
    res.json({ history: result.rows[0].history, user: { name: payload.name, picture: payload.picture } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post('/api/sync', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const payload = await verifyGoogleToken(req.body.token);
  if (!payload) return res.status(401).json({ error: "Invalid token" });

  try {
    await pool.query(`
      UPDATE users SET history = $1 WHERE google_id = $2
    `, [JSON.stringify(req.body.history), payload.sub]);
    
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Load our generated 2000 target words
const targetWordsPath = path.join(__dirname, 'words.json');
const targetWords = JSON.parse(fs.readFileSync(targetWordsPath, 'utf8'));

// Provide a simple PRNG
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Generate a hash from a string to use as seed
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
}

// Endpoint to get the target word for the given index
app.get('/api/word', (req, res) => {
    const index = parseInt(req.query.index) || 0;
    
    // Get current date in US Central Time (America/Chicago)
    const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    
    // Seed is based on the date and the index
    const seedString = `${centralTimeDateStr}-${index}`;
    const seedNumber = hashString(seedString);
    
    const rng = mulberry32(seedNumber);
    
    // Pick a word
    const randIndex = Math.floor(rng() * targetWords.length);
    const word = targetWords[randIndex];
    
    res.json({ word, date: centralTimeDateStr, index });
});

// Optionally, provide an endpoint to check if a word is valid.
// For a Wordle clone, it's easier to just allow the client to download the full valid list
// or we can just let the client validate against any 5-letter string for simplicity,
// but since we want quality, let's serve the targetWords for validation, or a bigger list.
// To keep the network payload small, we'll validate on the server or send all targetWords.
// Actually, let's just send the whole targetWords list so the client can validate guesses against it.
app.get('/api/valid-words', (req, res) => {
    res.json(targetWords);
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../dist')));
app.use((req, res, next) => {
    if (req.method === 'GET') {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    } else {
        next();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
