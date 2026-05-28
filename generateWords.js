import fs from 'fs';
import wordListPath from 'word-list';

// Read all words
const allWords = fs.readFileSync(wordListPath, 'utf8').split('\n');

// Filter 5-letter words — kept as full validation list
const fiveLetterWords = allWords.filter(w => w.length === 5 && /^[a-z]+$/.test(w));
const wordSet = new Set(fiveLetterWords);

if (!fs.existsSync('./server')) {
    fs.mkdirSync('./server');
}

// Full list for guess validation (unchanged)
fs.writeFileSync('./server/words.json', JSON.stringify(fiveLetterWords));
console.log(`Generated ${fiveLetterWords.length} words in server/words.json`);

// Build target word list: top 2000 most-frequent 5-letter words that exist in our word set.
// Frequency data: Norvig's public-domain Google n-gram counts (norvig.com/ngrams/count_1w.txt)
// Format: "<word>\t<count>" sorted descending by count.
const freqPath = './server/freq_raw.txt';
if (!fs.existsSync(freqPath)) {
    console.warn('freq_raw.txt not found — skipping targetWords.json generation.');
    process.exit(0);
}

const freqLines = fs.readFileSync(freqPath, 'utf8').split('\n');
const targetWords = [];
for (const line of freqLines) {
    if (targetWords.length >= 2000) break;
    const [word] = line.split('\t');
    const w = word?.toLowerCase().trim();
    if (w && wordSet.has(w)) {
        targetWords.push(w);
    }
}

fs.writeFileSync('./server/targetWords.json', JSON.stringify(targetWords));
console.log(`Generated ${targetWords.length} common target words in server/targetWords.json`);
