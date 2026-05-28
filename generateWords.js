import fs from 'fs';
import wordListPath from 'word-list';

// Read all words
const allWords = fs.readFileSync(wordListPath, 'utf8').split('\n');

// Filter 5-letter words
const fiveLetterWords = allWords.filter(w => w.length === 5 && /^[a-z]+$/.test(w));

// Just use all 5-letter words
const selected = fiveLetterWords;

if (!fs.existsSync('./server')) {
    fs.mkdirSync('./server');
}
fs.writeFileSync('./server/words.json', JSON.stringify(selected));
console.log(`Generated ${selected.length} words in server/words.json`);
