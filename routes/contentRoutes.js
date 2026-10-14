const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');
const { Banner, Doctor, Settings } = require('../models/Content');

const banners = express.Router();
const doctors = express.Router();
const settings = express.Router();
const withId = (document) => {
  const value = document.toObject ? document.toObject() : document;
  return { ...value, id: String(value._id) };
};

const textFields = (body, fields) => {
  const result = {};
  for (const field of fields) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') throw new Error(`${field} must be text`);
      result[field] = body[field].trim();
    }
  }
  return result;
};

const numericFields = (body, fields) => {
  const result = {};
  for (const field of fields) {
    if (body[field] === undefined || body[field] === '') continue;
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`);
    result[field] = value;
  }
  return result;
};

const booleanFields = (body, fields) => {
  const result = {};
  for (const field of fields) {
    if (body[field] !== undefined) result[field] = Boolean(body[field]);
  }
  return result;
};

const protectedRouter = (router) => router.use(protect, admin);
protectedRouter(banners);
protectedRouter(doctors);
protectedRouter(settings);

const resourceRoutes = (router, Model, { text, numbers = [], booleans = [], required = [] }) => {
  const validate = (body, partial) => {
    const value = {
      ...textFields(body, text),
      ...numericFields(body, numbers),
      ...booleanFields(body, booleans),
    };
    if (!partial) {
      for (const field of required) {
        if (!String(value[field] || '').trim()) throw new Error(`${field} is required`);
      }
    }
    return value;
  };

  router.get('/', async (_req, res, next) => {
    try {
      const items = await Model.find().sort({ sortOrder: 1, createdAt: -1 });
      res.json(items.map(withId));
    } catch (error) {
      next(error);
    }
  });
  router.get('/:id', async (req, res, next) => {
    try {
      const item = await Model.findById(req.params.id);
      if (!item) return res.status(404).json({ message: 'Record not found' });
      res.json(withId(item));
    } catch (error) {
      next(error);
    }
  });
  router.post('/', async (req, res, next) => {
    try {
      const item = await Model.create(validate(req.body, false));
      res.status(201).json(withId(item));
    } catch (error) {
      if (error.message?.includes('is required') || error.message?.includes('must be')) {
        return res.status(400).json({ message: error.message });
      }
      next(error);
    }
  });
  router.put('/:id', async (req, res, next) => {
    try {
      const item = await Model.findByIdAndUpdate(
        req.params.id,
        validate(req.body, true),
        { new: true, runValidators: true }
      );
      if (!item) return res.status(404).json({ message: 'Record not found' });
      res.json(withId(item));
    } catch (error) {
      if (error.message?.includes('must be')) return res.status(400).json({ message: error.message });
      next(error);
    }
  });
  router.delete('/:id', async (req, res, next) => {
    try {
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ message: 'Record not found' });
      res.json({ message: 'Record deleted' });
    } catch (error) {
      next(error);
    }
  });
};

resourceRoutes(banners, Banner, {
  text: ['title', 'subtitle', 'buttonText', 'buttonUrl', 'desktopImage', 'mobileImage'],
  numbers: ['sortOrder'],
  booleans: ['active'],
  required: ['title'],
});
resourceRoutes(doctors, Doctor, {
  text: ['name', 'specialization', 'qualification', 'bio', 'image', 'email', 'phone'],
  numbers: ['experience', 'consultationFee', 'sortOrder'],
  booleans: ['active'],
  required: ['name', 'specialization'],
});
doctors.patch('/:id/active', async (req, res, next) => {
  try {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'active must be a boolean' });
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, { active: req.body.active }, { new: true });
    if (!doctor) return res.status(404).json({ message: 'Doctor not found' });
    res.json(withId(doctor));
  } catch (error) {
    next(error);
  }
});

const settingsFields = [
  'websiteName', 'logo', 'favicon', 'phone', 'whatsapp', 'email', 'address',
  'googleMapsEmbed', 'facebook', 'instagram', 'twitter', 'linkedin',
  'shippingInfo', 'returnPolicy', 'privacyPolicy', 'termsConditions',
];
settings.get('/', async (_req, res, next) => {
  try {
    const record = await Settings.findOne({ key: 'site' }).lean();
    if (!record) return res.json({});
    const { key: _key, _id: _id, __v: _version, ...values } = record;
    res.json(values);
  } catch (error) {
    next(error);
  }
});
settings.put('/', async (req, res, next) => {
  try {
    const values = textFields(req.body, settingsFields);
    const record = await Settings.findOneAndUpdate(
      { key: 'site' },
      { $set: values, $setOnInsert: { key: 'site' } },
      { upsert: true, new: true, runValidators: true }
    ).lean();
    const { key: _key, _id: _id, __v: _version, ...output } = record;
    res.json(output);
  } catch (error) {
    if (error.message?.includes('must be')) return res.status(400).json({ message: error.message });
    next(error);
  }
});

module.exports = { banners, doctors, settings };
