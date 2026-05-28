import express from 'express';
import cors from 'cors';
import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
