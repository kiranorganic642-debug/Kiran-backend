const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');

// @desc    Get all orders (Sample)
// @route   GET /api/admin/orders
// @access  Private/Admin
router.get('/orders', protect, admin, (req, res) => {
  res.json({ message: 'Welcome Admin - Orders List' });
});

// @desc    Get all users (Sample)
// @route   GET /api/admin/users
// @access  Private/Admin
router.get('/users', protect, admin, (req, res) => {
  res.json({ message: 'Welcome Admin - Users List' });
});

// @desc    Doctor panel (Sample)
// @route   GET /api/admin/doctor
// @access  Private/Admin
router.get('/doctor', protect, admin, (req, res) => {
  res.json({ message: 'Welcome Admin - Doctor Panel' });
});

module.exports = router;
