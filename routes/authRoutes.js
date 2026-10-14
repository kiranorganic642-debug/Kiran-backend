const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const findUserByEmail = (email) => {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } });
};

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Check if admin exists
// @route   GET /api/auth/check-admin
// @access  Public
router.get('/check-admin', async (req, res) => {
  try {
    // Check DB Connection
    if (mongoose.connection.readyState !== 1) {
      return res.json({ 
        adminExists: false, 
        dbConnected: false,
        message: 'Database connection is still initializing or failed.' 
      });
    }
    const adminExists = await User.findOne({ role: 'admin' });
    res.json({ adminExists: !!adminExists, dbConnected: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Please provide name, email and password' });
  }

  try {
    // Check DB Connection - Detailed check
    const state = mongoose.connection.readyState;
    if (state !== 1) {
      let statusMsg = 'Database not connected';
      if (state === 0) statusMsg = 'Database disconnected';
      if (state === 2) statusMsg = 'Database is connecting...';
      if (state === 3) statusMsg = 'Database is disconnecting';
      
      console.error(`Signup failed: ${statusMsg} (State: ${state})`);
      return res.status(503).json({ 
        message: `Server busy: ${statusMsg}. Please wait a few seconds and try again. If the issue persists, check MongoDB Atlas IP Whitelist.` 
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const userExists = await findUserByEmail(normalizedEmail);

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: 'user',
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Registration failed' });
  }
});

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check DB Connection - Allow connecting (2) as well
    if (mongoose.connection.readyState !== 1 && mongoose.connection.readyState !== 2) {
      return res.status(503).json({ message: 'Database not connected. Please check IP Whitelist in MongoDB Atlas.' });
    }
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const user = await findUserByEmail(normalizedEmail);

    if (user && user.status !== 'blocked' && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Login failed' });
  }
});

module.exports = router;
