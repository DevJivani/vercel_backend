
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Room = require('../models/Room');
const mongoose = require('mongoose');

router.post('/create', async (req, res) => {
  try {
    const { name, userId } = req.body;
    const code = crypto.randomBytes(4).toString('hex');
    const room = await Room.create({
      name,
      code,
      createdBy: userId,
      users: [userId]
    });
    res.status(201).json(room);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/join', async (req, res) => {
  try {
    const { code, userId } = req.body;
    const room = await Room.findOne({ code });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    const userIdObj = new mongoose.Types.ObjectId(userId);
    if (!room.users.includes(userIdObj)) {
      room.users.push(userIdObj);
      await room.save();
    }
    res.json(room);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const userRooms = await Room.find({ users: userId });
    res.json(userRooms);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:roomId', async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }
    res.json(room);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
