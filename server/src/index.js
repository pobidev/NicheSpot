import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import db from './db.js';
import authRoutes from './routes/auth.js';
import albumRoutes from './routes/albums.js';
import friendRoutes from './routes/friends.js';
import profileRoutes from './routes/profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/albums', albumRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/profile', profileRoutes);

if (process.env.NODE_ENV === 'production') {
  const localDist = path.join(__dirname, '../../client/dist');
  const dockerDist = path.join(__dirname, '../client/dist');
  const clientDist = fs.existsSync(dockerDist) ? dockerDist : localDist;

  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`NichoSpot server running on port ${PORT}`);
});
