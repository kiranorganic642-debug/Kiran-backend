const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true },
    customer: {
      fullName: { type: String, required: true },
      email: { type: String, lowercase: true, trim: true, default: '' },
      phone: { type: String, required: true },
      address: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      pinCode: { type: String, default: '' },
    },
    items: [{
      productId: { type: String, default: '' },
      nameSnapshot: { type: String, required: true },
      priceAtSale: { type: Number, required: true, min: 0 },
      quantity: { type: Number, required: true, min: 1 },
      variantName: { type: String, default: '' },
      thumbnail: { type: String, default: '' },
    }],
    subtotal: { type: Number, required: true, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, default: 'COD' },
    paymentStatus: { type: String, enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'], default: 'PENDING' },
    orderStatus: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
      default: 'PENDING',
    },
    trackingNumber: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);
orderSchema.index({ 'customer.email': 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });

const enquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, default: '' },
    product: { type: String, default: '' },
    productName: { type: String, default: '' },
    message: { type: String, required: true, trim: true },
    source: { type: String, default: 'website' },
    status: { type: String, enum: ['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'CLOSED'], default: 'NEW' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const appointmentSchema = new mongoose.Schema(
  {
    patientName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true, default: '' },
    date: { type: String, default: '' },
    timeSlot: { type: String, default: '' },
    doctorId: { type: String, default: '' },
    doctorName: { type: String, default: '' },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  Order: model('Order', orderSchema),
  Enquiry: model('Enquiry', enquirySchema),
  Appointment: model('Appointment', appointmentSchema),
};
