import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4567;

// Route for landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/landing.html'));
});

// Route for login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

// Route for app
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/editor.html'));
});

// Serve static files from public directory (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, '../public')));

// API routes would go here (predict, generate-image, etc.)
// For now, they'll return 501 Not Implemented

app.listen(PORT, () => {
  console.log(`🟣 Purple Valley dev server running at http://localhost:${PORT}`);
  console.log(`   Landing page: http://localhost:${PORT}/`);
  console.log(`   App: http://localhost:${PORT}/app`);
});
