import { formatInTimeZone } from 'date-fns-tz';

// Re-implementation of backend streak calculation
function getStreakStats(history, currentDateStr) {
    const wonGames = Object.values(history || {}).filter(g => g && g.status === 'won');
    const winDatesSorted = Array.from(new Set(wonGames.map(g => g.date))).sort();

    if (winDatesSorted.length === 0) {
        return { currentStreak: 0, longestStreak: 0 };
    }

    const parseDateString = (dateStr) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    };

    const dates = winDatesSorted.map(parseDateString);
    
    let longestStreak = 0;
    let tempStreak = 1;
    
    for (let i = 0; i < dates.length; i++) {
        if (i > 0) {
            const diffTime = dates[i].getTime() - dates[i-1].getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
                tempStreak++;
            } else if (diffDays > 1) {
                if (tempStreak > longestStreak) {
                    longestStreak = tempStreak;
                }
                tempStreak = 1;
            }
        }
    }
    if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
    }

    // Calculate current streak
    let currentStreak = 0;
    const lastWinDateStr = winDatesSorted[winDatesSorted.length - 1];
    const lastWinDate = parseDateString(lastWinDateStr);
    const currentDate = parseDateString(currentDateStr);
    
    const diffTime = currentDate.getTime() - lastWinDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0 || diffDays === 1) {
        let currentTemp = 1;
        for (let i = dates.length - 1; i > 0; i--) {
            const diffT = dates[i].getTime() - dates[i-1].getTime();
            const diffD = Math.round(diffT / (1000 * 60 * 60 * 24));
            if (diffD === 1) {
                currentTemp++;
            } else {
                break;
            }
        }
        currentStreak = currentTemp;
    } else {
        currentStreak = 0;
    }

    return { currentStreak, longestStreak };
}

// Mock database users
const mockUsers = [
  {
    google_id: "user_played_today",
    email: "user1@example.com",
    display_name: "Played Today",
    email_consent: true,
    history: {
      "1": { date: "2026-07-02", status: "won" } // Played today
    }
  },
  {
    google_id: "user_live_streak_consented",
    email: "user2@example.com",
    display_name: "Live Streak (Consented)",
    email_consent: true,
    history: {
      "1": { date: "2026-07-01", status: "won" } // Won yesterday (diffDays === 1)
    }
  },
  {
    google_id: "user_live_streak_no_consent",
    email: "user3@example.com",
    display_name: "Live Streak (No Consent)",
    email_consent: false,
    history: {
      "1": { date: "2026-07-01", status: "won" } // Won yesterday, but no consent
    }
  },
  {
    google_id: "user_lost_streak_yesterday",
    email: "user4@example.com",
    display_name: "Lost Streak Yesterday (Consented)",
    email_consent: true,
    history: {
      "1": { date: "2026-06-30", status: "won" } // Won 2 days ago, missed yesterday (diffDays === 2)
    }
  },
  {
    google_id: "user_inactive",
    email: "user5@example.com",
    display_name: "Long Inactive (Consented)",
    email_consent: true,
    history: {
      "1": { date: "2026-06-25", status: "won" } // Won 7 days ago (diffDays >= 3)
    }
  }
];

function testCronLogic(currentHour, isSunday) {
  const todayDateStr = "2026-07-02";
  const yesterdayDateStr = "2026-07-01";
  
  let actionType = null;
  if (currentHour === 10) {
    actionType = 'lost_streak';
  } else if (currentHour === 22) {
    actionType = 'live_streak_or_digest';
  }

  console.log(`[Test Run] Hour: ${currentHour}:00 CT | Sunday: ${isSunday} | Action: ${actionType}`);

  const sent = [];

  for (const user of mockUsers) {
    // Only send if they have email consent
    if (!user.email_consent) continue;

    const history = user.history || {};
    
    // 1. Played today check
    const playedToday = Object.values(history).some(g => g && g.date === todayDateStr);
    if (playedToday) continue;

    // 2. Calculate stats
    const { currentStreak } = getStreakStats(history, todayDateStr);

    const wonGames = Object.values(history).filter(g => g && g.status === 'won');
    const winDatesSorted = Array.from(new Set(wonGames.map(g => g.date))).sort();
    
    let diffDays = 999;
    if (winDatesSorted.length > 0) {
        const lastWinDateStr = winDatesSorted[winDatesSorted.length - 1];
        const parseDateString = (dateStr) => {
            const [year, month, day] = dateStr.split('-').map(Number);
            return new Date(year, month - 1, day);
        };
        const lastWinDate = parseDateString(lastWinDateStr);
        const currentDate = parseDateString(todayDateStr);
        diffDays = Math.round((currentDate.getTime() - lastWinDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    let shouldSend = false;
    let emailTypeToSend = null;

    if (actionType === 'lost_streak') {
        const playedYesterday = Object.values(history).some(g => g && g.date === yesterdayDateStr);
        if (diffDays === 2 && !playedYesterday) {
            shouldSend = true;
            emailTypeToSend = 'lost_streak';
        }
    } else if (actionType === 'live_streak_or_digest') {
        if (diffDays === 1) {
            shouldSend = true;
            emailTypeToSend = 'live_streak';
        } else if ((diffDays >= 3 || winDatesSorted.length === 0) && isSunday) {
            shouldSend = true;
            emailTypeToSend = 'weekly_digest';
        }
    }

    if (shouldSend) {
      sent.push({ name: user.display_name, email: user.email, type: emailTypeToSend });
    }
  }

  return sent;
}

// RUN TESTS
console.log("=== RUNNING TIMED EMAIL TRIGGER LOGIC TESTS ===\n");

// Test 1: 10:00 AM (Lost streaks check)
const sentAt10Am = testCronLogic(10, false);
console.log("Emails Sent:", sentAt10Am);
if (sentAt10Am.length !== 1 || sentAt10Am[0].type !== 'lost_streak' || sentAt10Am[0].name !== 'Lost Streak Yesterday (Consented)') {
  throw new Error("Test 1 failed: Expected only Lost Streak Yesterday to get lost_streak email at 10 AM");
}
console.log("✅ Test 1 (10 AM Lost Streak) Passed!\n");

// Test 2: 10:00 PM on a Weekday (Live streaks only)
const sentAt10PmWeekday = testCronLogic(22, false);
console.log("Emails Sent:", sentAt10PmWeekday);
if (sentAt10PmWeekday.length !== 1 || sentAt10PmWeekday[0].type !== 'live_streak' || sentAt10PmWeekday[0].name !== 'Live Streak (Consented)') {
  throw new Error("Test 2 failed: Expected only Live Streak (Consented) to get live_streak email at 10 PM on weekdays");
}
console.log("✅ Test 2 (10 PM Weekday Live Streak) Passed!\n");

// Test 3: 10:00 PM on Sunday (Live streaks + Weekly digest)
const sentAt10PmSunday = testCronLogic(22, true);
console.log("Emails Sent:", sentAt10PmSunday);
if (sentAt10PmSunday.length !== 2) {
  throw new Error("Test 3 failed: Expected 2 emails on Sunday 10 PM (one live_streak, one weekly_digest)");
}
const liveStreakEmail = sentAt10PmSunday.find(e => e.type === 'live_streak');
const weeklyDigestEmail = sentAt10PmSunday.find(e => e.type === 'weekly_digest');
if (!liveStreakEmail || liveStreakEmail.name !== 'Live Streak (Consented)' || !weeklyDigestEmail || weeklyDigestEmail.name !== 'Long Inactive (Consented)') {
  throw new Error("Test 3 failed: Incorrect emails sent on Sunday 10 PM");
}
console.log("✅ Test 3 (10 PM Sunday Live Streak + Weekly Digest) Passed!\n");

console.log("🎉 All advanced email scheduler logic tests passed successfully!");
