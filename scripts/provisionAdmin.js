require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const connectDB = require('../config/db');

const provisionAdmin = async () => {
  const email = (process.env.SEED_ADMIN_EMAIL || 'Kiransorganic19@gmail.com').trim().toLowerCase();
  const resetPassword = process.env.RESET_ADMIN_PASSWORD === 'true';
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (resetPassword && !password) {
    throw new Error('Set SEED_ADMIN_PASSWORD in the backend environment to explicitly reset the admin password.');
  }

  await connectDB();
  const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await User.findOne({ email: { $regex: `^${escapedEmail}$`, $options: 'i' } });
  if (user) {
    let changed = false;
    if (user.role !== 'admin') {
      user.role = 'admin';
      changed = true;
    }
    if (resetPassword) {
      user.password = password;
      changed = true;
    }
    if (changed) await user.save();
    console.log(changed
      ? 'Existing account provisioned as admin; password was preserved unless an explicit reset was requested.'
      : 'Admin account already provisioned; no account changes made.');
  } else {
    if (!password) {
      throw new Error('The admin account does not exist. Set SEED_ADMIN_PASSWORD in the backend environment before creating it.');
    }
    await User.create({ name: 'Kiran Admin', email, password, role: 'admin' });
    console.log('Admin account created with a hashed password.');
  }
};

provisionAdmin()
  .catch((error) => {
    const category = error.category || 'admin provisioning failure';
    const message = error.category
      ? error.message
      : 'Check the admin seed configuration and MongoDB connection.';
    console.error(`Admin provisioning failed [${category}]: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
