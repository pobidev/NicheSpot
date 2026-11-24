import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';

const router = Router();

router.post('/register', (req, res) => {
  try {
    const { username, password, display_name } = req.body;

    if (!username || !password || !display_name) {
      return res.status(400).json({ error: 'username, password, and display_name are required' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)'
    ).run(username, passwordHash, display_name);

    const user = { id: result.lastInsertRowid, username, display_name };
    const token = generateToken(user);

    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        lastfm_username: user.lastfm_username,
      },
    });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, username, display_name, lastfm_username, created_at FROM users WHERE id = ?'
    ).get(req.user.id);

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
