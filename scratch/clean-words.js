import fs from 'fs';
import path from 'path';

const targetWordsPath = './server/targetWords.json';
const targetWords = JSON.parse(fs.readFileSync(targetWordsPath, 'utf8'));

const blacklist = new Set([
  // Personal Names (First/Last)
  "james", "peter", "jones", "louis", "jesus", "harry", "kelly", "henry", "lewis", 
  "maria", "jerry", "laura", "billy", "nancy", "jimmy", "barry", "ralph", "carol", 
  "tommy", "bobby", "colin", "oscar", "donna", "danny", "tyler", "diane", "devon", 
  "betty", "jesse", "sally", "burke", "moses", "logan", "brent", "shawn", "buffy", 
  "riley", "lohan", "bowie", "peggy", "denis", "silva", "welch", "dixie", "kirby", 
  "ariel", "monty", "hogan", "corey", "clint", "mitch", "sammy", "brock", "kylie", 
  "benny", "erica", "fritz", "polly", "garth", "paolo", "doris", "sloan", "tammy", 
  "sonny", "yates", "missy", "rubin", "norma", "romeo",
  
  // Proper nouns / Countries / States / Brands
  "texas", "yahoo", "spain", "vegas", "honda", "chile", "cisco", "intel", "wales", 
  "congo", "fedex", "turks", "alamo", "zaire", "sakai", "deere", "amiga", "cajun", 
  "dolce", "wigan", "nazis"
]);

const cleanedWords = targetWords.filter(word => !blacklist.has(word));

console.log(`Original count: ${targetWords.length}`);
console.log(`Cleaned count: ${cleanedWords.length}`);
console.log(`Removed ${targetWords.length - cleanedWords.length} proper nouns/names.`);

// Write back to file
fs.writeFileSync(targetWordsPath, JSON.stringify(cleanedWords), 'utf8');
console.log("Successfully updated server/targetWords.json!");
