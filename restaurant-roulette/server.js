const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'restaurants.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { restaurants: [], history: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    return { restaurants: [], history: [] };
  }
}

function saveData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/restaurants', (req, res) => {
  res.json({ restaurants: db.restaurants, history: db.history.slice(-10) });
});

app.post('/api/restaurants', (req, res) => {
  const { name, addedBy } = req.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const trimmedOwner = typeof addedBy === 'string' ? addedBy.trim() : '';

  if (!trimmedName || !trimmedOwner) {
    return res.status(400).json({ error: 'name과 addedBy는 필수입니다.' });
  }
  if (trimmedName.length > 40 || trimmedOwner.length > 20) {
    return res.status(400).json({ error: '이름이 너무 깁니다.' });
  }

  const restaurant = {
    id: crypto.randomUUID(),
    name: trimmedName,
    addedBy: trimmedOwner,
    createdAt: new Date().toISOString(),
  };

  db.restaurants.push(restaurant);
  saveData(db);
  io.emit('restaurants:update', db.restaurants);
  res.status(201).json(restaurant);
});

app.delete('/api/restaurants/:id', (req, res) => {
  const before = db.restaurants.length;
  db.restaurants = db.restaurants.filter((r) => r.id !== req.params.id);

  if (db.restaurants.length === before) {
    return res.status(404).json({ error: '해당 식당을 찾을 수 없습니다.' });
  }

  saveData(db);
  io.emit('restaurants:update', db.restaurants);
  res.status(204).end();
});

app.post('/api/spin', (req, res) => {
  const { spunBy } = req.body || {};

  if (db.restaurants.length === 0) {
    return res.status(400).json({ error: '식당이 하나도 없습니다.' });
  }

  const winnerIndex = crypto.randomInt(db.restaurants.length);
  const winner = db.restaurants[winnerIndex];
  const spin = {
    winnerId: winner.id,
    winnerName: winner.name,
    spunBy: typeof spunBy === 'string' && spunBy.trim() ? spunBy.trim() : '누군가',
    at: new Date().toISOString(),
  };

  db.history.push(spin);
  saveData(db);
  io.emit('spin:result', spin);
  res.json(spin);
});

io.on('connection', (socket) => {
  socket.emit('restaurants:update', db.restaurants);
});

server.listen(PORT, () => {
  console.log(`Restaurant roulette server running on port ${PORT}`);
});
