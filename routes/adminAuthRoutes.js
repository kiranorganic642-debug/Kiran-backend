const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');
const { classifyConnectionError } = require('../config/db');
const findUserByEmail = (email) => {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } });
};

const router = express.Router();

router.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ message: 'Authentication service is unavailable because the database is not connected.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user || user.role !== 'admin' || user.status === 'blocked' || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    const diagnosis = classifyConnectionError(error);
    const errorCode = typeof error?.code === 'string' || typeof error?.code === 'number'
      ? `, code ${error.code}`
      : '';
    console.error(`Admin login failed [${diagnosis.category}] (${error?.name || 'Error'}${errorCode}).`);
    const databaseUnavailable = mongoose.connection.readyState !== 1
      || diagnosis.category !== 'MongoDB connection failure';
    res.status(databaseUnavailable ? 503 : 500).json({
      message: databaseUnavailable
        ? 'Authentication service is temporarily unavailable. Please try again shortly.'
        : 'Login failed because of a server error.',
    });
  }
});

router.get('/me', protect, admin, (req, res) => {
  res.json({
    id: String(req.user._id),
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
  });
});

router.post('/logout', protect, admin, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
