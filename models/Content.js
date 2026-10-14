const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '' },
    buttonText: { type: String, default: '' },
    buttonUrl: { type: String, default: '' },
    desktopImage: { type: String, default: '' },
    mobileImage: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    qualification: { type: String, default: '' },
    experience: { type: Number, default: 0, min: 0 },
    bio: { type: String, default: '' },
    image: { type: String, default: '' },
    email: { type: String, lowercase: true, trim: true, default: '' },
    phone: { type: String, default: '' },
    consultationFee: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, default: 'site' },
    websiteName: { type: String, default: '' },
    logo: { type: String, default: '' },
    favicon: { type: String, default: '' },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    email: { type: String, default: '' },
    address: { type: String, default: '' },
    googleMapsEmbed: { type: String, default: '' },
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    shippingInfo: { type: String, default: '' },
    returnPolicy: { type: String, default: '' },
    privacyPolicy: { type: String, default: '' },
    termsConditions: { type: String, default: '' },
  },
  { timestamps: true }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  Banner: model('Banner', bannerSchema),
  Doctor: model('Doctor', doctorSchema),
  Settings: model('Settings', settingsSchema),
};
