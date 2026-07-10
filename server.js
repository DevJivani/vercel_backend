
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

const app = express();
const server = http.createServer(app);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// Socket.io setup
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Root route for testing
app.get('/', (req, res) => {
  res.json({ message: '🚀 Chat App Backend is running!' });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rooms', require('./routes/rooms'));

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  res.json({
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    url: `http://localhost:5005/uploads/${req.file.filename}`
  });
});

// In-memory storage
const roomMessages = {};
let messageIdCounter = 1;
const activeUsers = {}; // key: roomId, value: array of { id, username }

// Socket - only one connection handler!
io.on('connection', (socket) => {
  console.log('User connected', socket.id);
  
  socket.on('join', (data) => {
    const { roomId, username } = data;
    socket.join(roomId);
    console.log(username, 'joined', roomId);
    
    // Add user to active users
    if (!activeUsers[roomId]) activeUsers[roomId] = [];
    // Check if user already exists (in case of reconnection)
    const existingUserIndex = activeUsers[roomId].findIndex(u => u.id === socket.id);
    if (existingUserIndex !== -1) {
      activeUsers[roomId][existingUserIndex].username = username;
    } else {
      activeUsers[roomId].push({ id: socket.id, username });
    }
    
    // Notify others
    socket.to(roomId).emit('user-joined', username);
    // Send active users list to everyone in the room
    io.to(roomId).emit('active-users', activeUsers[roomId]);
    
    // Send existing messages to new user
    if (roomMessages[roomId]) {
      socket.emit('initial-messages', roomMessages[roomId]);
    }
  });

  socket.on('send', (data) => {
    console.log('Got message', data);
    const msg = {
      id: messageIdCounter++,
      username: data.username,
      text: data.text || '',
      file: data.file || null,
      deletedFor: [],
      timestamp: new Date().toISOString(),
      status: 'sent' // sent, delivered, read
    };
    if (!roomMessages[data.roomId]) roomMessages[data.roomId] = [];
    roomMessages[data.roomId].push(msg);
    io.to(data.roomId).emit('receive', msg);
    // Send message back to sender as "sent" immediately
    socket.emit('messageStatus', { messageId: msg.id, status: 'sent' });
  });

  socket.on('messageDelivered', (data) => {
    const { messageId, roomId, username } = data;
    const roomMsgs = roomMessages[roomId];
    if (roomMsgs) {
      const msg = roomMsgs.find(m => m.id === messageId);
      if (msg && msg.status !== 'read') {
        msg.status = 'delivered';
        io.to(roomId).emit('messageStatus', { messageId, status: 'delivered', username: msg.username });
      }
    }
  });

  socket.on('messageRead', (data) => {
    const { messageId, roomId } = data;
    const roomMsgs = roomMessages[roomId];
    if (roomMsgs) {
      const msg = roomMsgs.find(m => m.id === messageId);
      if (msg) {
        msg.status = 'read';
        io.to(roomId).emit('messageStatus', { messageId, status: 'read', username: msg.username });
      }
    }
  });

  socket.on('delete-for-me', (data) => {
    const { messageId, username, roomId } = data;
    const roomMsgs = roomMessages[roomId];
    if (roomMsgs) {
      const msg = roomMsgs.find(m => m.id === messageId);
      if (msg && !msg.deletedFor.includes(username)) {
        msg.deletedFor.push(username);
        socket.emit('message-deleted-for-me', { messageId });
      }
    }
  });

  socket.on('delete-for-everyone', (data) => {
    const { messageId, roomId } = data;
    const roomMsgs = roomMessages[roomId];
    if (roomMsgs) {
      const msgIdx = roomMsgs.findIndex(m => m.id === messageId);
      if (msgIdx !== -1) {
        roomMsgs[msgIdx].deletedForEveryone = true;
        io.to(roomId).emit('message-deleted-for-everyone', { messageId });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User left', socket.id);
    // Remove user from all active rooms
    for (const roomId in activeUsers) {
      const userIndex = activeUsers[roomId].findIndex(u => u.id === socket.id);
      if (userIndex !== -1) {
        const username = activeUsers[roomId][userIndex].username;
        activeUsers[roomId].splice(userIndex, 1);
        // Notify room
        io.to(roomId).emit('user-left', username);
        io.to(roomId).emit('active-users', activeUsers[roomId]);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5005;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// module.exports = app;
