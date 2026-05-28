import fs from 'fs';
import wordListPath from 'word-list';

// Read all words
const allWords = fs.readFileSync(wordListPath, 'utf8').split('\n');

// Filter 5-letter words
const fiveLetterWords = allWords.filter(w => w.length === 5 && /^[a-z]+$/.test(w));

// Shuffle or just pick 2000 common ones. The word-list is alphabetically sorted.
// We'll select 2000 words. Let's just shuffle them seeded or take a deterministic random subset.
// A simple predictable PRNG for shuffling:
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}
const rng = mulberry32(12345);
for (let i = fiveLetterWords.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [fiveLetterWords[i], fiveLetterWords[j]] = [fiveLetterWords[j], fiveLetterWords[i]];
}

// Take exactly 2000
const selected = fiveLetterWords.slice(0, 2000);

if (!fs.existsSync('./server')) {
    fs.mkdirSync('./server');
}
fs.writeFileSync('./server/words.json', JSON.stringify(selected, null, 2));
console.log(`Generated ${selected.length} words in server/words.json`);
