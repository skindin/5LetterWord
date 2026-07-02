import fs from 'fs';

const targetWords = JSON.parse(fs.readFileSync('./server/targetWords.json', 'utf8'));
const targetWordsLegacy = JSON.parse(fs.readFileSync('./server/targetWordsLegacy.json', 'utf8'));

function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}

const SWITCHOVER_DATE = '2026-07-03';

function getTargetWord(date, seqIndex) {
    const seedString = `${date}-${seqIndex}`;
    const seedNumber = hashString(seedString);
    const rng = mulberry32(seedNumber);
    
    const list = (date < SWITCHOVER_DATE) ? targetWordsLegacy : targetWords;
    const randIndex = Math.floor(rng() * list.length);
    return list[randIndex];
}

// Test dates
console.log("Date: 2026-07-02 (before switchover):");
for (let i = 0; i < 5; i++) {
    const oldWord = targetWordsLegacy[Math.floor(mulberry32(hashString(`2026-07-02-${i}`))() * targetWordsLegacy.length)];
    const verifiedWord = getTargetWord("2026-07-02", i);
    console.log(`  Seq ${i}: ${verifiedWord} (matches legacy: ${oldWord === verifiedWord})`);
}

console.log("\nDate: 2026-07-03 (after switchover):");
for (let i = 0; i < 5; i++) {
    const verifiedWord = getTargetWord("2026-07-03", i);
    const inCleaned = targetWords.includes(verifiedWord);
    console.log(`  Seq ${i}: ${verifiedWord} (in cleaned list: ${inCleaned})`);
}
