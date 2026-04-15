import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './db.js';
import authRoutes from './routes/auth.js';
import syncRoutes from './routes/sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try loading server/.env first; if unavailable, fallback to project-root .env.local.
const envResult = dotenv.config();
if (envResult.error) {
  dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
}

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow FRONTEND_ORIGIN in production (e.g. https://your-app.onrender.com). When unset, allow all origins.
const frontendOrigin = process.env.FRONTEND_ORIGIN;
const corsOptions = frontendOrigin
  ? { origin: frontendOrigin.split(',').map((o) => o.trim()).filter(Boolean), credentials: true }
  : { origin: true }; // allow any origin when unset so mobile/deployed frontends work
app.use(cors(corsOptions));
app.use(express.json());



// Routes
app.use('/auth', authRoutes);
app.use('/sync', syncRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connect to database and start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
