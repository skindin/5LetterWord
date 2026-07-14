import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { formatInTimeZone } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import { Resend } from 'resend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
if (resend) {
  console.log("Resend email reminder client initialized successfully.");
} else {
  console.warn("RESEND_API_KEY not set. Automated email reminder features will be disabled.");
}

const { Pool } = pg;
let pool = null;
if (process.env.DATABASE_URL) {
  console.log("Found DATABASE_URL, attempting to connect to database...");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL
    // Removed strict SSL config as Railway's internal networks often reject SSL connections
  });
  
  pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      google_id TEXT PRIMARY KEY,
      email TEXT,
      history JSONB DEFAULT '{}'
    )
  `).then(async () => {
    // Run migrations to support usernames and profile images
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_dev BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS skip_email_prompt BOOLEAN DEFAULT FALSE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await pool.query(`UPDATE users SET created_at = '2026-06-01 00:00:00' WHERE created_at IS NULL`);
    
    // Create relationship table for mutual friendships
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        user_id_1 TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        user_id_2 TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        PRIMARY KEY (user_id_1, user_id_2)
      )
    `);
    
    // Create sessions table for persistent Google Sign-In sessions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_token TEXT PRIMARY KEY,
        google_id TEXT REFERENCES users(google_id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create cron_logs table to track automated email runs and debug them
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cron_logs (
        id SERIAL PRIMARY KEY,
        run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        action_type TEXT,
        success BOOLEAN,
        sent_count INTEGER,
        skipped_count INTEGER,
        details JSONB
      )
    `);
    console.log("Database tables verified, migrated, and ready.");
  }).catch(err => {
    console.error("CRITICAL DB INIT ERROR. Connection failed:", err.message);
  });
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

// Hash a password using scrypt natively
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// Verify a password using scrypt natively
function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !storedPasswordHash.includes(':')) return false;
  const [salt, originalHash] = storedPasswordHash.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === originalHash;
}

async function getUserFromToken(token, emailConsent = null) {
  if (!token) return null;
  if (!pool) return null;

  try {
    // 1. Try to find session in our database
    const sessionRes = await pool.query(`
      SELECT u.google_id, u.email, u.username, u.display_name, u.picture, u.is_dev, u.history, u.email_consent, u.skip_email_prompt
      FROM sessions s
      JOIN users u ON s.google_id = u.google_id
      WHERE s.session_token = $1
    `, [token]);

    if (sessionRes.rows.length > 0) {
      return { user: sessionRes.rows[0], token, isNewUser: false };
    }

    // 2. Try to verify as a Google ID token
    const payload = await verifyGoogleToken(token);
    if (!payload) return null;

    // Check if user already exists
    const checkUser = await pool.query('SELECT google_id FROM users WHERE google_id = $1', [payload.sub]);
    const isNewUser = checkUser.rows.length === 0;

    if (isNewUser && payload.email) {
      const emailCheck = await pool.query('SELECT google_id FROM users WHERE LOWER(email) = $1', [payload.email.toLowerCase()]);
      if (emailCheck.rows.length > 0) {
        throw new Error('EMAIL_IN_USE');
      }
    }

    // Create or update user
    const userRes = await pool.query(`
      INSERT INTO users (google_id, email, display_name, picture, email_consent)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (google_id) DO UPDATE SET 
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        picture = EXCLUDED.picture,
        email_consent = users.email_consent OR EXCLUDED.email_consent
      RETURNING google_id, email, username, display_name, picture, is_dev, history, email_consent, skip_email_prompt
    `, [payload.sub, payload.email, payload.name, payload.picture, emailConsent === true]);

    const user = userRes.rows[0];
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    await pool.query(`
      INSERT INTO sessions (session_token, google_id)
      VALUES ($1, $2)
    `, [sessionToken, user.google_id]);

    return { user, token: sessionToken, isNewUser };
  } catch (e) {
    console.error("Error authenticating token:", e);
    return null;
  }
}

function sanitizeHistory(history) {
  if (!history) return {};
  const sanitized = {};
  for (const [key, game] of Object.entries(history)) {
    sanitized[key] = {
      guesses: game.guesses || [],
      status: game.status || 'playing',
      date: game.date || ''
    };
    if (game.status === 'won' || game.status === 'lost') {
      sanitized[key].targetWord = game.targetWord;
    }
  }
  return sanitized;
}

app.post('/api/auth', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  try {
    const result = await getUserFromToken(req.body.token, req.body.emailConsent);
    if (!result) return res.status(401).json({ error: "Invalid token" });

    const { user, token, isNewUser } = result;
    res.json({
      token,
      history: sanitizeHistory(user.history),
      username: user.username,
      isDev: user.is_dev,
      emailConsent: user.email_consent,
      skipEmailPrompt: user.skip_email_prompt,
      isNewUser: !!isNewUser,
      user: { name: user.display_name, picture: user.picture, email: user.email }
    });
  } catch (e) {
    if (e.message === 'EMAIL_IN_USE') {
      return res.status(400).json({ error: "Email address is already in use." });
    }
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const { username, password, emailConsent, email } = req.body;
  
  const cleanEmail = email?.trim() || null;
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  
  // Validate username format
  const cleanUsername = username?.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: "Username must be 3-20 characters, lowercase alphanumeric or underscore." });
  }
  
  if (username !== cleanUsername) {
    return res.status(400).json({ error: "Username contains invalid characters." });
  }

  // Validate password length
  if (!password || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    // Check if username is already taken
    const checkUser = await pool.query('SELECT google_id FROM users WHERE username = $1', [cleanUsername]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ error: "Username is already taken." });
    }

    // Check if email is already taken
    if (cleanEmail) {
      const emailCheck = await pool.query('SELECT google_id FROM users WHERE LOWER(email) = $1', [cleanEmail.toLowerCase()]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ error: "Email address is already in use." });
      }
    }

    const localId = `local:${crypto.randomUUID()}`;
    const passwordHash = hashPassword(password);
    
    // Create a default premium high-contrast SVG letter avatar
    const initial = cleanUsername.charAt(0).toLowerCase();
    const defaultPic = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="50" fill="%2310b981"/><text x="50" y="55" dominant-baseline="middle" text-anchor="middle" font-family="'Outfit', sans-serif" font-weight="800" font-size="50" fill="%23ffffff">${initial}</text></svg>`;

    // Insert new local user
    const userRes = await pool.query(`
      INSERT INTO users (google_id, username, display_name, password_hash, picture, email_consent, email)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING google_id, email, username, display_name, picture, is_dev, history, email_consent, skip_email_prompt
    `, [localId, cleanUsername, cleanUsername, passwordHash, defaultPic, emailConsent === true, cleanEmail]);

    const user = userRes.rows[0];
    const sessionToken = crypto.randomBytes(32).toString('hex');
    
    // Create session
    await pool.query(`
      INSERT INTO sessions (session_token, google_id)
      VALUES ($1, $2)
    `, [sessionToken, user.google_id]);

    res.json({
      token: sessionToken,
      history: sanitizeHistory(user.history),
      username: user.username,
      isDev: user.is_dev,
      emailConsent: user.email_consent,
      skipEmailPrompt: user.skip_email_prompt,
      user: { name: user.display_name, picture: user.picture, email: user.email }
    });

  } catch (e) {
    console.error("Registration error:", e);
    res.status(500).json({ error: "Database error during registration." });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required." });
  }

  const cleanUsername = username.trim().toLowerCase();

  try {
    const userRes = await pool.query(`
      SELECT google_id, email, username, display_name, password_hash, picture, is_dev, history, email_consent, skip_email_prompt
      FROM users
      WHERE username = $1
    `, [cleanUsername]);

    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const user = userRes.rows[0];
    
    // If the account was registered with Google and has no local credentials
    if (!user.password_hash) {
      return res.status(400).json({ error: "This account is configured with Google. Please use Google Sign-In." });
    }

    const isMatch = verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions (session_token, google_id)
      VALUES ($1, $2)
    `, [sessionToken, user.google_id]);

    res.json({
      token: sessionToken,
      history: sanitizeHistory(user.history),
      username: user.username,
      isDev: user.is_dev,
      emailConsent: user.email_consent,
      skipEmailPrompt: user.skip_email_prompt,
      user: { name: user.display_name, picture: user.picture, email: user.email }
    });

  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Database error during login." });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }

  const cleanEmail = email.trim().toLowerCase();

  try {
    const userRes = await pool.query(`
      SELECT google_id, username, display_name, email, password_hash 
      FROM users 
      WHERE LOWER(email) = $1
    `, [cleanEmail]);

    if (userRes.rows.length === 0) {
      // Generic success message to protect privacy
      return res.json({ success: true, message: "If an account matches that email, a reset link has been sent." });
    }

    const user = userRes.rows[0];

    if (!user.password_hash) {
      return res.status(400).json({ error: "This email address is registered using Google Sign-In. Please use Google Sign-In to log in." });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + 1); // 1 hour token lifetime

    await pool.query(`
      UPDATE users 
      SET reset_password_token = $1, reset_password_expires = $2 
      WHERE google_id = $3
    `, [token, expires, user.google_id]);

    if (resend) {
      const sender = process.env.SENDER_EMAIL || 'reminders@gnomebuddygames.com';
      let fromField = sender.includes('<') && sender.includes('>') 
          ? sender 
          : `"5 Letter Word" <${sender}>`;

      const appUrl = `https://${process.env.RAILWAY_STATIC_URL || '5letterword.up.railway.app'}`;
      const resetUrl = `${appUrl}/reset-password?token=${token}`;

      const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset your 5 Letter Word password</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
        </head>
        <body style="background-color: #0f172a; margin: 0; padding: 40px 20px; font-family: 'Outfit', sans-serif; -webkit-font-smoothing: antialiased; box-sizing: border-box;">
            <div class="container" style="max-width: 560px; margin: 0 auto; background-color: #1e293b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; padding: 40px; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4); text-align: left; box-sizing: border-box;">
                
                <!-- Logo -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                    <tr>
                        <td style="background-color: #10b981; color: white; width: 36px; height: 36px; border-radius: 10px; text-align: center; font-weight: 800; font-size: 18px; font-family: 'Outfit', sans-serif;">5</td>
                        <td style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; font-family: 'Outfit', sans-serif; padding-left: 10px; vertical-align: middle;">5 Letter Word</td>
                    </tr>
                </table>
                
                <!-- Title -->
                <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin-top: 0; margin-bottom: 12px; line-height: 1.3; font-family: 'Outfit', sans-serif;">Reset Your Password</h1>
                
                <!-- Body Text -->
                <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin-top: 0; margin-bottom: 20px; font-family: 'Outfit', sans-serif;">
                    Hello ${user.display_name || user.username || 'there'},
                    <br/><br/>
                    We received a request to reset the password for your 5 Letter Word account. Click the button below to choose a new password. This link is valid for 1 hour.
                </p>
                
                <!-- Call To Action Button -->
                <div style="margin-top: 30px; margin-bottom: 30px; text-align: left;">
                    <a href="${resetUrl}" style="background-color: #10b981; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; font-family: 'Outfit', sans-serif; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">
                        Reset Password
                    </a>
                </div>
                
                <p style="color: #64748b; font-size: 13px; line-height: 1.6; font-family: 'Outfit', sans-serif;">
                    If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                </p>

                <!-- Divider -->
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 30px 0;" />
                
                <!-- Footer -->
                <p style="font-size: 11px; color: #4b5563; line-height: 1.6; margin-top: 0; margin-bottom: 0; font-family: 'Outfit', sans-serif;">
                    5 Letter Word Recovery Assistant
                </p>
                
            </div>
        </body>
        </html>
      `;

      await resend.emails.send({
        from: fromField,
        to: user.email,
        subject: "Reset your 5 Letter Word password",
        html: emailHtml
      });
    }

    res.json({ success: true, message: "If an account matches that email, a reset link has been sent." });

  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to process forgot password request." });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });

  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required." });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const userRes = await pool.query(`
      SELECT google_id, email, username, display_name, picture, is_dev, history, email_consent, skip_email_prompt, reset_password_expires
      FROM users
      WHERE reset_password_token = $1
    `, [token]);

    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired reset token." });
    }

    const user = userRes.rows[0];

    const now = new Date();
    const expires = new Date(user.reset_password_expires);
    if (now > expires) {
      return res.status(400).json({ error: "Reset token has expired." });
    }

    const hashedPassword = hashPassword(newPassword);

    await pool.query(`
      UPDATE users 
      SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL 
      WHERE google_id = $2
    `, [hashedPassword, user.google_id]);

    const sessionToken = crypto.randomBytes(32).toString('hex');
    await pool.query(`
      INSERT INTO sessions (session_token, google_id)
      VALUES ($1, $2)
    `, [sessionToken, user.google_id]);

    res.json({
      token: sessionToken,
      history: sanitizeHistory(user.history),
      username: user.username,
      isDev: user.is_dev,
      emailConsent: user.email_consent,
      skipEmailPrompt: user.skip_email_prompt,
      user: { name: user.display_name, picture: user.picture, email: user.email }
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password." });
  }
});

function getDailySequenceIndex(history, levelIndex, date) {
    if (!history) return 0;
    const sameDateIndexes = Object.entries(history)
        .filter(([idx, g]) => g && g.date === date && parseInt(idx) !== levelIndex)
        .map(([idx]) => parseInt(idx));
    
    const smallerSameDate = sameDateIndexes.filter(idx => idx < levelIndex).length;
    return smallerSameDate;
}

app.post('/api/guess', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;
 
  const { index, guess, date } = req.body;
  const levelIndex = parseInt(index);
  if (isNaN(levelIndex) || levelIndex < 0) {
    return res.status(400).json({ error: "Invalid level index" });
  }
 
  const cleanGuess = guess?.trim().toLowerCase();
  if (!cleanGuess || cleanGuess.length !== 5 || !/^[a-z]+$/.test(cleanGuess)) {
    return res.status(400).json({ error: "Invalid guess format" });
  }
 
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Invalid date format" });
  }
 
  const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
  if (date !== centralTimeDateStr) {
    return res.status(400).json({ error: "Guesses can only be made for today's levels." });
  }
 
  if (!validWordsSet.has(cleanGuess)) {
    return res.status(400).json({ error: "Word not in dictionary" });
  }
 
  try {
    const history = user.history || {};
 
    const seqIndex = getDailySequenceIndex(history, levelIndex, date);
    const targetWord = getTargetWord(date, seqIndex);
 
    if (!history[levelIndex]) {
      history[levelIndex] = {
        guesses: [],
        status: 'playing',
        date: date,
        targetWord: targetWord
      };
    }
 
    const game = history[levelIndex];
    if (game.status === 'won' || game.status === 'lost') {
      return res.status(400).json({ error: "Level already completed" });
    }

    if (!game.guesses) game.guesses = [];
    game.guesses.push(cleanGuess);

    if (cleanGuess === targetWord) {
      game.status = 'won';
    } else if (game.guesses.length >= 6) {
      game.status = 'lost';
    } else {
      game.status = 'playing';
    }

    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), user.google_id]);

    res.json({
      index: levelIndex,
      gameState: {
        guesses: game.guesses,
        status: game.status,
        date: game.date,
        ...(game.status !== 'playing' ? { targetWord: game.targetWord } : {})
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Set or update a unique username
app.post('/api/user/username', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const username = req.body.username?.trim().toLowerCase();
  if (!username || username.length < 3 || username.length > 20 || !/^[a-z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: "username must be 3-20 characters and contain only lowercase letters, numbers, or underscores." });
  }

  try {
    await pool.query(`
      UPDATE users SET username = $1 WHERE google_id = $2
    `, [username, user.google_id]);
    
    res.json({ success: true, username });
  } catch (e) {
    if (e.code === '23505') { // Unique constraint violation (duplicate key)
      return res.status(400).json({ error: "username is already taken." });
    }
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Search users by username (lowercase, partial matching)
app.post('/api/users/search', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const searchQuery = req.body.query?.trim().toLowerCase();
  if (!searchQuery) return res.json({ users: [] });

  try {
    const result = await pool.query(`
      SELECT u.google_id, u.username, u.display_name, u.picture,
             EXISTS(
               SELECT 1 FROM friendships f 
               WHERE (f.user_id_1 = $2 AND f.user_id_2 = u.google_id)
                  OR (f.user_id_1 = u.google_id AND f.user_id_2 = $2)
             ) AS is_friend
      FROM users u
      WHERE u.username LIKE $1 AND u.google_id != $2 AND u.username IS NOT NULL
      LIMIT 10
    `, [`%${searchQuery}%`, user.google_id]);
    
    res.json({ users: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Add a friend by username or by user ID
app.post('/api/friends/add', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const { friend_username, friend_id } = req.body;
  
  try {
    let friendResult;
    if (friend_username) {
      friendResult = await pool.query('SELECT google_id, username FROM users WHERE username = $1', [friend_username.trim().toLowerCase()]);
    } else if (friend_id) {
      friendResult = await pool.query('SELECT google_id, username FROM users WHERE google_id = $1', [friend_id]);
    } else {
      return res.status(400).json({ error: "missing friend username or id." });
    }

    if (friendResult.rows.length === 0) {
      return res.status(404).json({ error: "user not found." });
    }

    const targetFriendId = friendResult.rows[0].google_id;
    const targetFriendUsername = friendResult.rows[0].username;

    if (targetFriendId === user.google_id) {
      return res.status(400).json({ error: "you cannot friend yourself." });
    }

    // Check if friendship already exists in either direction to prevent duplicate rows
    const existing = await pool.query(`
      SELECT 1 FROM friendships 
      WHERE (user_id_1 = $1 AND user_id_2 = $2)
         OR (user_id_1 = $2 AND user_id_2 = $1)
    `, [user.google_id, targetFriendId]);

    if (existing.rows.length === 0) {
      // Order user IDs to ensure a single unique pair representation (user_id_1 < user_id_2)
      const id1 = user.google_id < targetFriendId ? user.google_id : targetFriendId;
      const id2 = user.google_id < targetFriendId ? targetFriendId : user.google_id;

      await pool.query(`
        INSERT INTO friendships (user_id_1, user_id_2)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `, [id1, id2]);
    }

    res.json({ success: true, friend: { google_id: targetFriendId, username: targetFriendUsername } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Unfriend / Remove a mutual friend
app.post('/api/friends/remove', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  const { friend_id } = req.body;
  if (!friend_id) return res.status(400).json({ error: "missing friend id." });

  try {
    // Delete the friendship in either direction to support both ordering styles
    await pool.query(`
      DELETE FROM friendships 
      WHERE (user_id_1 = $1 AND user_id_2 = $2)
         OR (user_id_1 = $2 AND user_id_2 = $1)
    `, [user.google_id, friend_id]);

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// List all friends along with their usernames, profile details, and histories/stats
app.post('/api/friends/list', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  const { user } = result;

  try {
    // Retrieve friends symmetrically, using UNION to prevent duplicate records if they exist in both directions
    const result = await pool.query(`
      SELECT u.google_id AS google_id, u.username, u.display_name, u.picture, u.history
      FROM users u
      WHERE u.google_id IN (
        SELECT user_id_2 FROM friendships WHERE user_id_1 = $1
        UNION
        SELECT user_id_1 FROM friendships WHERE user_id_2 = $1
      )
    `, [user.google_id]);
    
    const sanitizedFriends = result.rows.map(row => ({
      ...row,
      history: sanitizeHistory(row.history)
    }));
    
    res.json({ friends: sanitizedFriends });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

// Common words used as daily answers (top-2000 by frequency)
const targetWordsPath = path.join(__dirname, 'targetWords.json');
const targetWords = JSON.parse(fs.readFileSync(targetWordsPath, 'utf8'));

const targetWordsLegacyPath = path.join(__dirname, 'targetWordsLegacy.json');
const targetWordsLegacy = JSON.parse(fs.readFileSync(targetWordsLegacyPath, 'utf8'));

// Full word list used to validate guesses
const validWordsPath = path.join(__dirname, 'words.json');
const validWords = JSON.parse(fs.readFileSync(validWordsPath, 'utf8'));
const validWordsSet = new Set(validWords);

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

const SWITCHOVER_DATE = '2026-07-03';

function getTargetWord(date, seqIndex) {
    const seedString = `${date}-${seqIndex}`;
    const seedNumber = hashString(seedString);
    const rng = mulberry32(seedNumber);
    
    const list = (date < SWITCHOVER_DATE) ? targetWordsLegacy : targetWords;
    const randIndex = Math.floor(rng() * list.length);
    return list[randIndex];
}

function xorObfuscate(str, key) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const charCode = str.charCodeAt(i) ^ key.charCodeAt(i % key.length);
        result += String.fromCharCode(charCode);
    }
    return Buffer.from(result, 'binary').toString('hex');
}

// Compute user win streak stats
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

// Send a prebuilt email using Resend
async function sendPrebuiltEmail(user, emailType, todayDateStr) {
    if (!resend) {
        return { success: false, error: "Resend client not initialized" };
    }
    const sender = process.env.SENDER_EMAIL || 'reminders@yourdomain.com';
    const appUrl = `https://${process.env.RAILWAY_STATIC_URL || '5letterword.up.railway.app'}`;

    // Get streak stats as of today
    const { currentStreak } = getStreakStats(user.history, todayDateStr);

    let subject = "";
    let emailTitle = "";
    let emailDescription = "";
    let actionButtonText = "Play Today's Word";
    let actionButtonUrl = appUrl;
    let extraHtml = "";

    if (emailType === 'live_streak') {
        if (currentStreak > 0) {
            subject = `Keep your ${currentStreak}-day streak alive! 🚀`;
            emailTitle = "Keep Your Streak Going!";
            emailDescription = `You currently have a live <strong>${currentStreak}-day streak</strong>! Don't let it slip away. Play today's 5 Letter Word puzzle before midnight to keep it active.`;
            actionButtonText = "Keep My Streak Active";
        } else {
            subject = "Start your daily win streak today! 🚀";
            emailTitle = "Start Your Win Streak!";
            emailDescription = `Today is the perfect day to start a brand new daily win streak on 5 Letter Word! Play today's puzzle before midnight to lock in your first win.`;
            actionButtonText = "Start My Streak";
        }
    } else if (emailType === 'lost_streak') {
        // Calculate the streak that was just lost (which was active 2 days ago)
        const twoDaysAgo = new Date();
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const twoDaysAgoStr = formatInTimeZone(twoDaysAgo, 'America/Chicago', 'yyyy-MM-dd');
        const { currentStreak: lostStreak } = getStreakStats(user.history, twoDaysAgoStr);

        if (lostStreak > 1) {
            subject = `Oh no, your ${lostStreak}-day streak broke! 😢`;
            emailTitle = "Streak Broken, But Not Forgotten!";
            emailDescription = `It looks like you missed yesterday's word, and your amazing <strong>${lostStreak}-day win streak</strong> has come to an end. But don't let that stop you—every champion starts from day one. Today's puzzle is live, start a fresh streak and see how high you can climb this time!`;
            actionButtonText = "Start a Fresh Streak";
        } else {
            subject = "Missed yesterday's word? Start fresh today! 🚀";
            emailTitle = "Time for a Fresh Start!";
            emailDescription = `It looks like you missed yesterday's word, but today is a brand new day! Start a new win streak today and see how many consecutive days you can conquer. Today's puzzle is waiting for you!`;
            actionButtonText = "Start a New Streak";
        }
    } else if (emailType === 'weekly_digest') {
        subject = "Your 5 Letter Word Weekly Update 📊";
        emailTitle = "Weekly Friend Stats Digest";
        emailDescription = "It's been a while since your last game! Solve today's puzzle to start a new streak and see if you can top your friends.";
        actionButtonText = "Play 5 Letter Word";
        
        // Fetch friends
        let friendsList = [];
        if (pool) {
            try {
                const friendsRes = await pool.query(`
                    SELECT u.username, u.display_name, u.history
                    FROM users u
                    WHERE u.google_id IN (
                        SELECT user_id_2 FROM friendships WHERE user_id_1 = $1
                        UNION
                        SELECT user_id_1 FROM friendships WHERE user_id_2 = $1
                    )
                `, [user.google_id]);
                friendsList = friendsRes.rows;
            } catch (dbErr) {
                console.error("Error fetching friends for weekly digest:", dbErr);
            }
        }

        let friendsHtml = "";
        if (friendsList.length > 0) {
            friendsHtml += `
                <div style="margin-top: 25px; margin-bottom: 25px; background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 12px; padding: 20px;">
                    <h3 style="color: #6366f1; margin-top: 0; margin-bottom: 15px; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 800; font-family: 'Outfit', sans-serif;">Friend Leaderboard</h3>
                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
            `;
            for (const friend of friendsList) {
                const { currentStreak: friendStreak } = getStreakStats(friend.history, todayDateStr);
                const name = friend.display_name || friend.username || 'Anonymous Friend';
                const streakText = friendStreak > 0 ? `🔥 ${friendStreak} day streak` : '💤 inactive';
                const streakColor = friendStreak > 0 ? '#10b981' : '#64748b';
                
                friendsHtml += `
                    <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 14px; color: #e2e8f0; font-weight: 600; font-family: 'Outfit', sans-serif;">
                            👤 ${name} <span style="font-size: 11px; color: #64748b;">@${friend.username || 'unknown'}</span>
                        </td>
                        <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; color: ${streakColor}; font-weight: bold; font-family: 'Outfit', sans-serif; text-align: right;">
                            ${streakText}
                        </td>
                    </tr>
                `;
            }
            friendsHtml += `
                    </table>
                </div>
            `;
        } else {
            friendsHtml += `
                <div style="margin-top: 25px; margin-bottom: 25px; background: rgba(0, 0, 0, 0.15); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 20px; text-align: center;">
                    <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5; font-family: 'Outfit', sans-serif;">
                        No friends added yet. Add friends on the Social tab in 5 Letter Word to compare your daily streaks!
                    </p>
                </div>
            `;
        }
        extraHtml = friendsHtml;
    } else if (emailType === 'welcome_reminder') {
        subject = "Welcome to 5 Letter Word! Ready for your first puzzle? 🧩";
        emailTitle = "Welcome to 5 Letter Word!";
        emailDescription = "Thanks for creating your account! We noticed you haven't played your first puzzle yet. Today's 5 Letter Word is waiting for you—play it before midnight to start your first daily win streak!";
        actionButtonText = "Play My First Word";
        actionButtonUrl = appUrl;
    } else if (emailType === 'password_reset') {
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // 1 hour token lifetime

        if (pool) {
            try {
                await pool.query(`
                  UPDATE users 
                  SET reset_password_token = $1, reset_password_expires = $2 
                  WHERE google_id = $3
                `, [token, expires, user.google_id]);
            } catch (dbErr) {
                console.error("Error setting reset token in sendPrebuiltEmail:", dbErr);
                return { success: false, error: "Database error setting token" };
            }
        }

        subject = "Reset your 5 Letter Word password";
        emailTitle = "Reset Your Password";
        emailDescription = `We received a request to reset the password for your 5 Letter Word account. Click the button below to choose a new password. This link is valid for 1 hour.`;
        actionButtonText = "Reset Password";
        actionButtonUrl = `${appUrl}/reset-password?token=${token}`;
    } else {
        return { success: false, error: "Invalid email type" };
    }

    const unsubscribeUrl = `${appUrl}/api/unsubscribe?id=${user.google_id}`;

    // Premium Dark-Themed Email Layout matching the site
    const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${subject}</title>
            <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
            <style>
                @media only screen and (max-width: 600px) {
                    .container {
                        padding: 24px !important;
                        border-radius: 16px !important;
                    }
                }
            </style>
        </head>
        <body style="background-color: #0f172a; margin: 0; padding: 40px 20px; font-family: 'Outfit', sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; box-sizing: border-box;">
            <div class="container" style="max-width: 560px; margin: 0 auto; background-color: #1e293b; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 24px; padding: 40px; box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4); text-align: left; box-sizing: border-box;">
                
                <!-- Logo -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                    <tr>
                        <td style="background-color: #10b981; color: white; width: 36px; height: 36px; border-radius: 10px; text-align: center; font-weight: 800; font-size: 18px; font-family: 'Outfit', sans-serif;">5</td>
                        <td style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; font-family: 'Outfit', sans-serif; padding-left: 10px; vertical-align: middle;">5 Letter Word</td>
                    </tr>
                </table>
                
                <!-- Title -->
                <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin-top: 0; margin-bottom: 12px; line-height: 1.3; font-family: 'Outfit', sans-serif;">${emailTitle}</h1>
                
                <!-- Body Text -->
                <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin-top: 0; margin-bottom: 20px; font-family: 'Outfit', sans-serif;">${emailDescription}</p>
                
                <!-- Custom extra sections (e.g. friends table) -->
                ${extraHtml}
                
                <!-- Call To Action Button -->
                <div style="margin-top: 30px; margin-bottom: 30px; text-align: left;">
                    <a href="${actionButtonUrl}" style="background-color: #10b981; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 15px; display: inline-block; font-family: 'Outfit', sans-serif; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);">
                        ${actionButtonText}
                    </a>
                </div>
                
                <!-- Divider -->
                <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 30px 0;" />
                
                <!-- Footer -->
                <p style="font-size: 11px; color: #4b5563; line-height: 1.6; margin-top: 0; margin-bottom: 0; font-family: 'Outfit', sans-serif;">
                    You are receiving this because you signed up for streak reminders on 5 Letter Word.
                    <br />
                    <a href="${unsubscribeUrl}" style="color: #10b981; text-decoration: underline; font-weight: 600;">Unsubscribe from these emails</a>.
                </p>
                
            </div>
        </body>
        </html>
    `;

    try {
        const fromField = sender.includes('<') && sender.includes('>') 
            ? sender 
            : `"5 Letter Word" <${sender}>`;

        await resend.emails.send({
            from: fromField,
            to: user.email,
            subject: subject,
            html: emailHtml
        });
        return { success: true };
    } catch (e) {
        console.error(`Failed to send email to ${user.email} via Resend:`, e);
        return { success: false, error: e.message };
    }
}

// Endpoint to get the target word for the given index
app.get('/api/word', (req, res) => {
    const index = parseInt(req.query.index) || 0;
    const seq = parseInt(req.query.seq) || 0;
    
    // Get current date in US Central Time (America/Chicago)
    const centralTimeDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
    const targetDate = req.query.date || centralTimeDateStr;
    
    const word = getTargetWord(targetDate, seq);
    
    const obfuscated = xorObfuscate(word, targetDate);
    
    res.json({ word: obfuscated, date: targetDate, index });
});

// Optionally, provide an endpoint to check if a word is valid.
// For a Wordle clone, it's easier to just allow the client to download the full valid list
// or we can just let the client validate against any 5-letter string for simplicity,
// but since we want quality, let's serve the targetWords for validation, or a bigger list.
// To keep the network payload small, we'll validate on the server or send all targetWords.
// Actually, let's just send the whole targetWords list so the client can validate guesses against it.
app.get('/api/valid-words', (req, res) => {
    res.json(validWords);
});

app.post('/api/user/update-consent', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  
  const { user } = result;
  const { consent } = req.body;
  
  try {
    await pool.query(`
      UPDATE users 
      SET email_consent = $1
      WHERE google_id = $2
    `, [consent === true, user.google_id]);
    
    res.json({ success: true, emailConsent: consent === true });
  } catch (e) {
    console.error("Update consent error:", e);
    res.status(500).json({ error: "Database error while updating consent." });
  }
});

app.post('/api/dev/update-consent', async (req, res) => {
  const payload = await requireDev(req, res);
  if (!payload) return;

  const { targetGoogleId, consent } = req.body;
  if (!targetGoogleId) {
    return res.status(400).json({ error: "targetGoogleId required" });
  }

  try {
    await pool.query(`
      UPDATE users 
      SET email_consent = $1
      WHERE google_id = $2
    `, [consent === true, targetGoogleId]);
    
    res.json({ success: true, emailConsent: consent === true });
  } catch (e) {
    console.error("Dev update consent error:", e);
    res.status(500).json({ error: "Database error while updating consent." });
  }
});

app.post('/api/user/link-email', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  
  const { user } = result;
  const { email } = req.body;
  
  const cleanEmail = email?.trim();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  
  try {
    const emailCheck = await pool.query('SELECT google_id FROM users WHERE LOWER(email) = $1 AND google_id <> $2', [cleanEmail.toLowerCase(), user.google_id]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ error: "Email address is already in use." });
    }

    await pool.query(`
      UPDATE users 
      SET email = $1, email_consent = TRUE
      WHERE google_id = $2
    `, [cleanEmail, user.google_id]);
    
    res.json({ success: true, email: cleanEmail });
  } catch (e) {
    console.error("Link email error:", e);
    res.status(500).json({ error: "Database error while linking email." });
  }
});

app.post('/api/user/skip-email-prompt', async (req, res) => {
  if (!pool) return res.status(500).json({ error: "Database not configured" });
  
  const result = await getUserFromToken(req.body.token);
  if (!result) return res.status(401).json({ error: "Invalid token" });
  
  const { user } = result;
  
  try {
    await pool.query(`
      UPDATE users 
      SET skip_email_prompt = TRUE
      WHERE google_id = $1
    `, [user.google_id]);
    
    res.json({ success: true });
  } catch (e) {
    console.error("Skip email prompt error:", e);
    res.status(500).json({ error: "Database error while updating preferences." });
  }
});

async function requireDev(req, res) {
    if (!pool) { res.status(500).json({ error: 'Database not configured' }); return null; }
    const result = await getUserFromToken(req.body.token);
    if (!result) { res.status(401).json({ error: 'Invalid token' }); return null; }
    if (!result.user.is_dev) { res.status(403).json({ error: 'Not authorized' }); return null; }
    return { sub: result.user.google_id };
}

// Dev-only: preview words for consecutive days starting from a given day offset
app.post('/api/dev/words', async (req, res) => {
    if (!await requireDev(req, res)) return;

    const offset = parseInt(req.body.offset) || 0;
    const wordOffset = parseInt(req.body.wordOffset) || 0;
    const count = parseInt(req.body.count) || 5;

    const date = new Date();
    date.setDate(date.getDate() + offset);
    const dateStr = formatInTimeZone(date, 'America/Chicago', 'yyyy-MM-dd');

    const words = [];
    for (let i = 0; i < count; i++) {
        const wordIndex = wordOffset + i;
        words.push(getTargetWord(dateStr, wordIndex));
    }

    res.json({ offset, date: dateStr, wordOffset, words });
});

// Dev-only: list all users (email, username, google_id, history)
app.post('/api/dev/users', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const r = await pool.query(
        'SELECT google_id, email, username, display_name, history, email_consent FROM users ORDER BY display_name'
    );
    res.json({ users: r.rows });
});

// Dev-only: wipe a player's game history
app.post('/api/dev/wipe-history', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId } = req.body;
    if (!targetGoogleId) return res.status(400).json({ error: 'targetGoogleId required' });
    await pool.query("UPDATE users SET history = '{}' WHERE google_id = $1", [targetGoogleId]);
    res.json({ success: true, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: wipe a specific day's history for a player
app.post('/api/dev/wipe-day', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId, date } = req.body;
    if (!targetGoogleId || !date) return res.status(400).json({ error: 'targetGoogleId and date required' });
    
    const userResult = await pool.query('SELECT history FROM users WHERE google_id = $1', [targetGoogleId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const history = userResult.rows[0].history || {};
    let wipedCount = 0;
    for (const [key, game] of Object.entries(history)) {
        if (game && game.date === date) {
            delete history[key];
            wipedCount++;
        }
    }
    
    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), targetGoogleId]);
    res.json({ success: true, wipedCount, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: wipe a specific word (level index) history for a player
app.post('/api/dev/wipe-word', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;
    const { targetGoogleId, index } = req.body;
    if (!targetGoogleId || index === undefined) return res.status(400).json({ error: 'targetGoogleId and level index required' });
    
    const levelIndex = parseInt(index);
    if (isNaN(levelIndex)) return res.status(400).json({ error: 'Invalid level index' });
    
    const userResult = await pool.query('SELECT history FROM users WHERE google_id = $1', [targetGoogleId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const history = userResult.rows[0].history || {};
    if (history[levelIndex]) {
        delete history[levelIndex];
    }
    
    await pool.query('UPDATE users SET history = $1 WHERE google_id = $2', [JSON.stringify(history), targetGoogleId]);
    res.json({ success: true, isSelf: payload.sub === targetGoogleId });
});

// Dev-only: delete a player's account entirely
app.post('/api/dev/delete-account', async (req, res) => {
    if (!await requireDev(req, res)) return;
    const { targetGoogleId } = req.body;
    if (!targetGoogleId) return res.status(400).json({ error: 'targetGoogleId required' });
    await pool.query('DELETE FROM users WHERE google_id = $1', [targetGoogleId]);
    res.json({ success: true });
});

// Endpoint to trigger automated reminder emails (scheduled via external cron or manual triggers)
app.get('/api/cron/reminders', async (req, res) => {
    const authHeader = req.headers.authorization;
    const querySecret = req.query.secret;
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        return res.status(500).json({ error: "CRON_SECRET environment variable is not configured" });
    }

    // Validate CRON_SECRET either from Bearer Token, from query parameter, or via developer token
    let requestSecret = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        requestSecret = authHeader.substring(7);
    } else if (querySecret) {
        requestSecret = querySecret;
    }

    let isAuthorized = (cronSecret && requestSecret === cronSecret);
    
    if (!isAuthorized) {
        const devToken = req.query.token || (req.body && req.body.token);
        if (devToken) {
            const devResult = await getUserFromToken(devToken);
            if (devResult && devResult.user && devResult.user.is_dev) {
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    if (!pool) {
        return res.status(500).json({ error: "Database not configured" });
    }

    if (!resend) {
        return res.status(500).json({ error: "Resend client not initialized (missing RESEND_API_KEY)" });
    }

    try {
        const todayDate = new Date();
        const todayDateStr = formatInTimeZone(todayDate, 'America/Chicago', 'yyyy-MM-dd');
        
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayDateStr = formatInTimeZone(yesterdayDate, 'America/Chicago', 'yyyy-MM-dd');

        // Check if there is an explicit type override (for dev/testing)
        const forceType = req.query.forceType;
        
        // Otherwise determine action based on US Central Time hour
        const currentHourStr = formatInTimeZone(todayDate, 'America/Chicago', 'HH');
        const currentHour = parseInt(currentHourStr, 10);
        const isSunday = (formatInTimeZone(todayDate, 'America/Chicago', 'eeee') === 'Sunday');

        let actionType = null;
        if (forceType) {
            actionType = forceType;
        } else if (currentHour === 10) {
            actionType = 'lost_streak';
        } else if (currentHour === 22) {
            actionType = 'live_streak_or_digest';
        }

        if (!actionType) {
            return res.json({
                success: true,
                message: `No automated email reminders scheduled for hour ${currentHour} Central Time. (Automated runs occur at 10 AM and 10 PM Central Time).`
            });
        }

        // Query only players who have registered emails AND have consented to emails
        const usersRes = await pool.query('SELECT google_id, email, display_name, history, created_at FROM users WHERE email IS NOT NULL AND email_consent = TRUE');
        const users = usersRes.rows;

        const sentEmails = [];
        const skippedUsers = [];

        for (const user of users) {
            const history = user.history || {};
            
            // Check if played/completed today
            const playedToday = Object.values(history).some(g => g && g.date === todayDateStr && (g.status === 'won' || g.status === 'lost'));
            if (playedToday) {
                skippedUsers.push({ google_id: user.google_id, email: user.email, reason: "Played/completed today" });
                continue;
            }

            // Calculate streak stats as of today
            const { currentStreak } = getStreakStats(history, todayDateStr);

            // Determine if they won yesterday
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
                // Send only if streak just broke today (diffDays === 2) and they did not play yesterday
                const playedYesterday = Object.values(history).some(g => g && g.date === yesterdayDateStr && (g.status === 'won' || g.status === 'lost'));
                if (diffDays === 2 && !playedYesterday) {
                    shouldSend = true;
                    emailTypeToSend = 'lost_streak';
                }
            } else if (actionType === 'live_streak') {
                // Explicit force of live streak
                shouldSend = true;
                emailTypeToSend = 'live_streak';
            } else if (actionType === 'welcome_reminder') {
                // Explicit force of welcome reminder
                shouldSend = true;
                emailTypeToSend = 'welcome_reminder';
            } else if (actionType === 'weekly_digest') {
                // Explicit force of weekly digest
                shouldSend = true;
                emailTypeToSend = 'weekly_digest';
            } else if (actionType === 'live_streak_or_digest') {
                // Automated 10 PM run
                const finishedGames = Object.values(history).filter(g => g && (g.status === 'won' || g.status === 'lost'));
                const createdDate = user.created_at ? new Date(user.created_at) : null;
                
                let isNewUserWindow = false;
                if (createdDate) {
                    const diffMs = todayDate.getTime() - createdDate.getTime();
                    const diffHours = diffMs / (1000 * 60 * 60);
                    isNewUserWindow = diffHours >= 0 && diffHours < 24;
                }

                if (finishedGames.length === 0 && isNewUserWindow) {
                    // New user who hasn't completed a word yet, send welcome reminder at 10 PM
                    shouldSend = true;
                    emailTypeToSend = 'welcome_reminder';
                } else if (diffDays === 1) {
                    // Won yesterday, active streak, remind them before midnight Chicago time
                    shouldSend = true;
                    emailTypeToSend = 'live_streak';
                } else if ((diffDays >= 3 || winDatesSorted.length === 0) && isSunday) {
                    // Inactive user, send weekly digest on Sundays
                    shouldSend = true;
                    emailTypeToSend = 'weekly_digest';
                }
            }

            if (shouldSend && emailTypeToSend) {
                const mailRes = await sendPrebuiltEmail(user, emailTypeToSend, todayDateStr);
                if (mailRes.success) {
                    sentEmails.push({ google_id: user.google_id, email: user.email, type: emailTypeToSend });
                } else {
                    skippedUsers.push({ google_id: user.google_id, email: user.email, error: mailRes.error });
                }
            } else {
                skippedUsers.push({ google_id: user.google_id, email: user.email, reason: "Does not meet trigger criteria for this run" });
            }
        }

        if (pool) {
            try {
                await pool.query(`
                    INSERT INTO cron_logs (action_type, success, sent_count, skipped_count, details)
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    actionType,
                    true,
                    sentEmails.length,
                    skippedUsers.length,
                    JSON.stringify({ sentEmails, skippedUsers })
                ]);
            } catch (dbLogErr) {
                console.error("Failed to write successful cron log to DB:", dbLogErr);
            }
        }

        res.json({
            success: true,
            actionType,
            date: todayDateStr,
            hour: currentHour,
            isSunday,
            emailsSentCount: sentEmails.length,
            emailsSent: sentEmails,
            skippedUsers
        });

    } catch (error) {
        console.error("Error running reminder cron job:", error);
        if (pool) {
            try {
                await pool.query(`
                    INSERT INTO cron_logs (action_type, success, details)
                    VALUES ($1, $2, $3)
                `, [
                    req.query.forceType || 'automated_cron',
                    false,
                    JSON.stringify({ error: error.message || String(error) })
                ]);
            } catch (dbLogErr) {
                console.error("Failed to write failed cron log to DB:", dbLogErr);
            }
        }
        res.status(500).json({ error: "Failed to run reminder cron job" });
    }
});

// Unsubscribe GET endpoint
app.get('/api/unsubscribe', async (req, res) => {
    const { id } = req.query;
    if (!id) {
        return res.status(400).send("<h1>Error</h1><p>Missing user ID.</p>");
    }

    if (!pool) {
        return res.status(500).send("<h1>Error</h1><p>Database not configured.</p>");
    }

    try {
        await pool.query('UPDATE users SET email_consent = FALSE WHERE google_id = $1', [id]);
        
        // Render a beautiful themed unsubscribe landing page matching the site theme
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Unsubscribed - 5 Letter Word</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
                <style>
                    body {
                        background-color: #0f172a;
                        color: #f8fafc;
                        font-family: 'Outfit', sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container {
                        background: #1e293b;
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        padding: 40px;
                        border-radius: 24px;
                        max-width: 480px;
                        width: 100%;
                        text-align: center;
                        box-shadow: 0 15px 35px rgba(0, 0, 0, 0.5);
                    }
                    .logo-td {
                        background-color: #10b981; 
                        color: white; 
                        width: 48px; 
                        height: 48px; 
                        border-radius: 12px; 
                        text-align: center; 
                        font-weight: 800; 
                        font-size: 24px; 
                        font-family: 'Outfit', sans-serif;
                    }
                    h1 {
                        font-size: 24px;
                        margin-top: 24px;
                        margin-bottom: 12px;
                        font-weight: 800;
                        color: #ffffff;
                    }
                    p {
                        color: #94a3b8;
                        font-size: 15px;
                        line-height: 1.5;
                        margin-bottom: 30px;
                    }
                    .btn {
                        background-color: #10b981;
                        color: white;
                        padding: 12px 28px;
                        text-decoration: none;
                        border-radius: 12px;
                        font-weight: bold;
                        display: inline-block;
                        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
                        font-size: 15px;
                    }
                    .btn:hover {
                        background-color: #059669;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                        <tr>
                            <td class="logo-td">5</td>
                        </tr>
                    </table>
                    <h1>Unsubscribed Successfully</h1>
                    <p>You have been unsubscribed from 5 Letter Word email reminders. You will no longer receive daily streak or weekly update emails.</p>
                    <a href="https://${process.env.RAILWAY_STATIC_URL || '5letterword.up.railway.app'}" class="btn">Back to Game</a>
                </div>
            </body>
            </html>
        `);
    } catch (e) {
        console.error("Unsubscribe error:", e);
        res.status(500).send("<h1>Error</h1><p>Database error during unsubscribe.</p>");
    }
});

// Dev-only: manually send a prebuilt email to a user
app.post('/api/dev/send-email', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;

    const { targetGoogleId, emailType } = req.body;
    if (!targetGoogleId || !emailType) {
        return res.status(400).json({ error: "targetGoogleId and emailType required" });
    }

    if (!resend) {
        return res.status(500).json({ error: "Resend client not initialized (missing RESEND_API_KEY)" });
    }

    try {
        // Query user info
        const userRes = await pool.query('SELECT google_id, email, display_name, history, password_hash FROM users WHERE google_id = $1', [targetGoogleId]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }
        
        const user = userRes.rows[0];
        if (!user.email) {
            return res.status(400).json({ error: "User does not have an email address" });
        }

        if (emailType === 'password_reset' && !user.password_hash) {
            return res.status(400).json({ error: "Cannot send password reset: User is registered via Google and does not have a local password." });
        }

        const todayDateStr = formatInTimeZone(new Date(), 'America/Chicago', 'yyyy-MM-dd');
        const mailRes = await sendPrebuiltEmail(user, emailType, todayDateStr);

        if (mailRes.success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: mailRes.error });
        }
    } catch (error) {
        console.error("Error manually sending email:", error);
        res.status(500).json({ error: "Failed to send email" });
    }
});

// Dev-only: get recent cron execution logs
app.get('/api/dev/cron-logs', async (req, res) => {
    const payload = await requireDev(req, res);
    if (!payload) return;

    if (!pool) {
        return res.status(500).json({ error: "Database not configured" });
    }

    try {
        const result = await pool.query('SELECT * FROM cron_logs ORDER BY run_at DESC LIMIT 50');
        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching cron logs:", error);
        res.status(500).json({ error: "Failed to fetch cron logs" });
    }
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
