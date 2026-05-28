export function getGuessStatuses(guess: string, targetWord: string): ('correct' | 'present' | 'absent')[] {
  const statuses: ('correct' | 'present' | 'absent')[] = Array(5).fill('absent');
  const targetCharCounts: Record<string, number> = {};

  for (const char of targetWord) {
    targetCharCounts[char] = (targetCharCounts[char] || 0) + 1;
  }

  // First pass: find correct letters
  for (let i = 0; i < 5; i++) {
    if (guess[i] === targetWord[i]) {
      statuses[i] = 'correct';
      targetCharCounts[guess[i]]--;
    }
  }

  // Second pass: find present letters
  for (let i = 0; i < 5; i++) {
    if (statuses[i] !== 'correct' && targetCharCounts[guess[i]] > 0) {
      statuses[i] = 'present';
      targetCharCounts[guess[i]]--;
    }
  }

  return statuses;
}
