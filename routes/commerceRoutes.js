const express = require('express');
const { randomInt } = require('crypto');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');
const User = require('../models/User');
const Product = require('../models/Product');
const { Order, Enquiry, Appointment } = require('../models/Commerce');

const publicOrders = express.Router();
const publicEnquiries = express.Router();
const publicAppointments = express.Router();
const adminOrders = express.Router();
const adminEnquiries = express.Router();
const adminAppointments = express.Router();
const adminCustomers = express.Router();

const idFields = (record) => {
  const value = record.toObject ? record.toObject() : record;
  return { ...value, id: String(value._id) };
};

const orderOutput = (order) => {
  const value = idFields(order);
  return {
    ...value,
    customerName: value.customer?.fullName || '',
    customerEmail: value.customer?.email || '',
    customerPhone: value.customer?.phone || '',
    customerAddress: value.customer?.address || '',
    customerCity: value.customer?.city || '',
    customerState: value.customer?.state || '',
    customerPincode: value.customer?.pinCode || '',
    orderStatus: value.orderStatus || 'PENDING',
    items: (value.items || []).map((item) => ({
      ...item,
      id: String(item._id || ''),
      productName: item.nameSnapshot,
      price: item.priceAtSale,
    })),
  };
};

const safeNumber = (value, label) => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative number`);
  return number;
};

const makeOrderNumber = () => {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `KIR-${day}-${randomInt(100000, 1000000)}`;
};

publicOrders.post('/', async (req, res, next) => {
  try {
    const customer = req.body.customer || {};
    const fullName = String(customer.fullName || req.body.customerName || '').trim();
    const phone = String(customer.phone || req.body.customerPhone || '').trim();
    const email = String(customer.email || req.body.customerEmail || '').trim().toLowerCase();
    if (!fullName || !phone) return res.status(400).json({ message: 'Customer name and phone are required' });
    if (!Array.isArray(req.body.items) || !req.body.items.length) {
      return res.status(400).json({ message: 'At least one order item is required' });
    }

    const orderItems = [];
    for (const item of req.body.items) {
      const productKey = item.productId ?? item.id;
      const isNumeric = /^\d+$/.test(String(productKey));
      const product = isNumeric
        ? await Product.findOne({ legacyId: Number(productKey), active: true })
        : await Product.findOne({ _id: productKey, active: true }).catch(() => null);
      if (!product) return res.status(400).json({ message: `Product ${productKey} is unavailable` });
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Order item quantity must be a positive integer' });
      }
      const variantName = String(item.variantName || '');
      const variant = product.variants.find((entry) => entry.name === variantName);
      if (variant?.outOfStock || (variant?.stock != null && variant.stock < quantity)) {
        return res.status(409).json({ message: `${product.name} is out of stock for the selected variant` });
      }
      if (product.stock != null && product.stock < quantity) {
        return res.status(409).json({ message: `${product.name} does not have enough stock` });
      }
      const unitPrice = variant?.price ?? product.price;
      orderItems.push({
        productId: String(product._id),
        nameSnapshot: product.name,
        priceAtSale: unitPrice,
        quantity,
        variantName,
        thumbnail: product.thumbnail || product.images.find((image) => image.isPrimary)?.url || '',
      });
    }

    const subtotal = orderItems.reduce((sum, item) => sum + item.priceAtSale * item.quantity, 0);
    const shipping = safeNumber(req.body.shipping, 'Shipping');
    const tax = safeNumber(req.body.tax, 'Tax');
    const discount = safeNumber(req.body.discount, 'Discount');
    const paymentMethod = String(customer.paymentMethod || req.body.paymentMethod || 'COD');
    const order = await Order.create({
      orderNumber: makeOrderNumber(),
      customer: {
        fullName,
        email,
        phone,
        address: String(customer.address || req.body.address || ''),
        city: String(customer.city || req.body.city || ''),
        state: String(customer.state || req.body.state || ''),
        pinCode: String(customer.pinCode || req.body.pinCode || ''),
      },
      items: orderItems,
      subtotal,
      shipping,
      tax,
      discount,
      total: Math.max(0, subtotal + shipping + tax - discount),
      paymentMethod,
    });
    res.status(201).json({ order: orderOutput(order) });
  } catch (error) {
    if (error.message?.includes('must be a non-negative number')) {
      return res.status(400).json({ message: error.message });
    }
    next(error);
  }
});

publicEnquiries.post('/', async (req, res, next) => {
  try {
    const { name, phone, email = '', product = '', message, source = 'website' } = req.body;
    if (!String(name || '').trim() || !String(phone || '').trim() || !String(message || '').trim()) {
      return res.status(400).json({ message: 'Name, phone and message are required' });
    }
    const enquiry = await Enquiry.create({ name, phone, email, product, productName: product, message, source });
    res.status(201).json({ enquiry: idFields(enquiry) });
  } catch (error) {
    next(error);
  }
});

publicAppointments.post('/', async (req, res, next) => {
  try {
    const { patientName, phone, email = '', date = '', timeSlot = '', reason = '', doctorId = '' } = req.body;
    if (!String(patientName || '').trim() || !String(phone || '').trim()) {
      return res.status(400).json({ message: 'Patient name and phone are required' });
    }
    const appointment = await Appointment.create({ patientName, phone, email, date, timeSlot, reason, doctorId });
    res.status(201).json({ appointment: idFields(appointment) });
  } catch (error) {
    next(error);
  }
});

adminOrders.use(protect, admin);
adminOrders.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
    const filter = {};
    if (req.query.status) filter.orderStatus = req.query.status;
    const search = String(req.query.search || '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { orderNumber: { $regex: escaped, $options: 'i' } },
        { 'customer.fullName': { $regex: escaped, $options: 'i' } },
        { 'customer.email': { $regex: escaped, $options: 'i' } },
      ];
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Order.countDocuments(filter),
    ]);
    res.json({ orders: orders.map(orderOutput), total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    next(error);
  }
});
adminOrders.get('/:id', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(orderOutput(order));
  } catch (error) {
    next(error);
  }
});
adminOrders.patch('/:id/status', async (req, res, next) => {
  try {
    const allowed = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ message: 'Invalid order status' });
    const order = await Order.findByIdAndUpdate(req.params.id, { orderStatus: req.body.status }, { new: true, runValidators: true });
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(orderOutput(order));
  } catch (error) {
    next(error);
  }
});

const listSimple = (Model, route, statusField, allowed) => {
  route.use(protect, admin);
  route.get('/', async (req, res, next) => {
    try {
      const records = await Model.find().sort({ createdAt: -1 }).limit(500);
      res.json(records.map(idFields));
    } catch (error) {
      next(error);
    }
  });
  route.get('/:id', async (req, res, next) => {
    try {
      const record = await Model.findById(req.params.id);
      if (!record) return res.status(404).json({ message: 'Record not found' });
      res.json(idFields(record));
    } catch (error) {
      next(error);
    }
  });
  route.patch('/:id/status', async (req, res, next) => {
    try {
      if (!allowed.includes(req.body.status)) return res.status(400).json({ message: 'Invalid status' });
      const record = await Model.findByIdAndUpdate(req.params.id, { [statusField]: req.body.status }, { new: true, runValidators: true });
      if (!record) return res.status(404).json({ message: 'Record not found' });
      res.json(idFields(record));
    } catch (error) {
      next(error);
    }
  });
};

listSimple(Enquiry, adminEnquiries, 'status', ['NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'CLOSED']);
listSimple(Appointment, adminAppointments, 'status', ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED']);

adminCustomers.use(protect, admin);
adminCustomers.get('/', async (req, res, next) => {
  try {
    const [users, orders] = await Promise.all([
      User.find({ role: 'user' }).select('name email status createdAt').lean(),
      Order.aggregate([
        { $group: {
          _id: '$customer.email',
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$total' },
          lastOrderDate: { $max: '$createdAt' },
          phone: { $last: '$customer.phone' },
        } },
      ]),
    ]);
    const history = new Map(orders.filter((order) => order._id).map((order) => [order._id.toLowerCase(), order]));
    const result = users.map((user) => {
      const aggregate = history.get(user.email.toLowerCase());
      return {
        id: String(user._id),
        name: user.name,
        email: user.email,
        phone: aggregate?.phone || '',
        totalOrders: aggregate?.totalOrders || 0,
        totalSpent: aggregate?.totalSpent || 0,
        lastOrderDate: aggregate?.lastOrderDate,
        status: user.status === 'blocked' ? 'Blocked' : 'Active',
        createdAt: user.createdAt,
      };
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});
adminCustomers.get('/:id', async (req, res, next) => {
  try {
    const user = await User.findOne({ _id: req.params.id, role: 'user' }).select('name email status createdAt').lean();
    if (!user) return res.status(404).json({ message: 'Customer not found' });
    const [aggregate] = await Order.aggregate([
      { $match: { 'customer.email': user.email.toLowerCase() } },
      { $group: {
        _id: '$customer.email',
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: '$total' },
        lastOrderDate: { $max: '$createdAt' },
        phone: { $last: '$customer.phone' },
      } },
    ]);
    res.json({
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: aggregate?.phone || '',
      totalOrders: aggregate?.totalOrders || 0,
      totalSpent: aggregate?.totalSpent || 0,
      lastOrderDate: aggregate?.lastOrderDate,
      status: user.status === 'blocked' ? 'Blocked' : 'Active',
      createdAt: user.createdAt,
    });
  } catch (error) {
    next(error);
  }
});
adminCustomers.patch('/:id/status', async (req, res, next) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'user' },
      { status: req.body.blocked ? 'blocked' : 'active' },
      { new: true }
    ).select('-password');
    if (!user) return res.status(404).json({ message: 'Customer not found' });
    res.json({ id: String(user._id), name: user.name, email: user.email, status: user.status === 'blocked' ? 'Blocked' : 'Active' });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  publicOrders,
  publicEnquiries,
  publicAppointments,
  adminOrders,
  adminEnquiries,
  adminAppointments,
  adminCustomers,
};
