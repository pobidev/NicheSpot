import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
router.use(authenticateToken);

router.get('/', (req, res) => {
  try {
    const userId = req.user.id;
    const friends = db.prepare(`
      SELECT f.id,
        CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END as friend_user_id,
        u.username, u.display_name
      FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END
      WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    `).all(userId, userId, userId, userId);

    res.json(friends.map((f) => ({
      id: f.friend_user_id,
      friendship_id: f.id,
      username: f.username,
      display_name: f.display_name,
      user: { id: f.friend_user_id, username: f.username, display_name: f.display_name },
    })));
  } catch {
    res.status(500).json({ error: 'Failed to get friends' });
  }
});

router.get('/pending', (req, res) => {
  try {
    const userId = req.user.id;
    const pending = db.prepare(`
      SELECT f.id, f.created_at, u.id as user_id, u.username, u.display_name
      FROM friendships f
      JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = ? AND f.status = 'pending'
    `).all(userId);

    res.json(pending.map((p) => ({
      id: p.id,
      created_at: p.created_at,
      user_id: p.user_id,
      username: p.username,
      display_name: p.display_name,
      user: { id: p.user_id, username: p.username, display_name: p.display_name },
    })));
  } catch {
    res.status(500).json({ error: 'Failed to get pending requests' });
  }
});

router.get('/recommendations', (req, res) => {
  try {
    const userId = req.user.id;
    const recs = db.prepare(`
      SELECT ua.id as user_album_id, ua.updated_at,
             a.id as album_id, a.external_id, a.source, a.title, a.artist, a.year, a.cover_url,
             u.id as recommender_id, u.username as recommender_username, u.display_name as recommender_display_name,
             u.display_name as recommended_by
      FROM user_albums ua
      JOIN albums a ON a.id = ua.album_id
      JOIN users u ON u.id = ua.recommended_by_user_id
      WHERE ua.user_id = ? AND ua.recommended_by_user_id IS NOT NULL AND ua.status = 'to_listen'
      ORDER BY ua.updated_at DESC
    `).all(userId);

    res.json(recs);
  } catch {
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

router.delete('/recommendations/:albumId', (req, res) => {
  try {
    const userId = req.user.id;
    const { albumId } = req.params;
    db.prepare(`
      UPDATE user_albums SET recommended_by_user_id = NULL
      WHERE user_id = ? AND (album_id = ? OR id = ?)
    `).run(userId, albumId, albumId);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to dismiss recommendation' });
  }
});

router.post('/request', (req, res) => {
  try {
    const userId = req.user.id;
    let { friend_id, username } = req.body;

    if (username && !friend_id) {
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!user) return res.status(404).json({ error: 'User not found' });
      friend_id = user.id;
    }

    if (!friend_id) return res.status(400).json({ error: 'friend_id or username is required' });
    if (friend_id === userId) return res.status(400).json({ error: 'Cannot send friend request to yourself' });

    const existing = db.prepare(`
      SELECT id FROM friendships
      WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
    `).get(userId, friend_id, friend_id, userId);

    if (existing) return res.status(409).json({ error: 'Friendship already exists' });

    const result = db.prepare(
      'INSERT INTO friendships (user_id, friend_id) VALUES (?, ?)'
    ).run(userId, friend_id);

    const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(friendship);
  } catch {
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

router.put('/:id/accept', (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = db.prepare(
      "UPDATE friendships SET status = 'accepted' WHERE id = ? AND friend_id = ?"
    ).run(id, userId);

    if (result.changes === 0) return res.status(404).json({ error: 'Friend request not found' });

    const friendship = db.prepare('SELECT * FROM friendships WHERE id = ?').get(id);
    res.json(friendship);
  } catch {
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = db.prepare(
      'DELETE FROM friendships WHERE id = ? AND (user_id = ? OR friend_id = ?)'
    ).run(id, userId, userId);

    if (result.changes === 0) return res.status(404).json({ error: 'Friendship not found' });

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete friendship' });
  }
});

router.get('/search', (req, res) => {
  try {
    const { q } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT u.id, u.username, u.display_name,
             f.id as friendship_id,
             f.status as friendship_status,
             f.user_id as requester_id
      FROM users u
      LEFT JOIN friendships f ON (
        (f.user_id = ? AND f.friend_id = u.id) OR
        (f.friend_id = ? AND f.user_id = u.id)
      )
      WHERE u.id != ?
    `;
    const params = [userId, userId, userId];

    if (q && q.trim()) {
      query += ` AND (u.username LIKE ? OR u.display_name LIKE ?)`;
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }

    query += ` ORDER BY u.display_name COLLATE NOCASE ASC LIMIT 100`;

    const users = db.prepare(query).all(...params);

    res.json(users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      friendship_id: u.friendship_id,
      friendship_status: u.friendship_status || 'none',
      is_requester: u.requester_id === userId,
    })));
  } catch {
    res.status(500).json({ error: 'Failed to search users' });
  }
});

export default router;
