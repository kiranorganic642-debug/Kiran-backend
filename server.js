const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const { randomUUID } = require('crypto');
const cors = require('cors');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const catalogRoutes = require('./routes/catalogRoutes');
const contentRoutes = require('./routes/contentRoutes');
const { protect } = require('./middleware/authMiddleware');
const { admin } = require('./middleware/adminMiddleware');
const User = require('./models/User');
const Product = require('./models/Product');
const Category = require('./models/Category');
const { Order, Enquiry, Appointment } = require('./models/Commerce');
const commerceRoutes = require('./routes/commerceRoutes');

// Load env vars
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Middleware
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// CORS Configuration
const allowedOrigins = new Set([
  'https://kiransorganic.com',
  'https://www.kiransorganic.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  process.env.FRONTEND_URL,
  process.env.ADMIN_URL,
].filter(Boolean));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (!allowedOrigins.has(origin)) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/', (req, res) => {
  res.send('API is running...');
});

app.get('/health', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? 'ok' : 'unavailable',
    database: databaseConnected ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', catalogRoutes.publicProducts);
app.get('/api/catalog-assets/:filename', catalogRoutes.serveProductAsset);
app.use('/api/categories', catalogRoutes.publicCategories);
app.use('/api/orders', commerceRoutes.publicOrders);
app.use('/api/enquiries', commerceRoutes.publicEnquiries);
app.use('/api/appointments', commerceRoutes.publicAppointments);
app.use('/api/admin/products', catalogRoutes.adminProducts);
app.use('/api/admin/categories', catalogRoutes.adminCategories);
app.use('/api/admin/auth', require('./routes/adminAuthRoutes'));
app.use('/api/admin/orders', commerceRoutes.adminOrders);
app.use('/api/admin/enquiries', commerceRoutes.adminEnquiries);
app.use('/api/admin/appointments', commerceRoutes.adminAppointments);
app.use('/api/admin/customers', commerceRoutes.adminCustomers);
app.use('/api/admin/banners', contentRoutes.banners);
app.use('/api/admin/doctors', contentRoutes.doctors);
app.use('/api/admin/settings', contentRoutes.settings);
app.get('/api/admin/dashboard', protect, admin, async (req, res, next) => {
  try {
    const [
      totalProducts,
      activeProducts,
      totalCategories,
      lowStockProducts,
      totalOrders,
      totalCustomers,
      totalEnquiries,
      totalAppointments,
      recentOrders,
      recentEnquiries,
    ] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ active: true }),
      Category.countDocuments(),
      Product.countDocuments({ stock: { $ne: null, $lt: 5 } }),
      Order.countDocuments(),
      User.countDocuments({ role: 'user' }),
      Enquiry.countDocuments(),
      Appointment.countDocuments(),
      Order.find().sort({ createdAt: -1 }).limit(5),
      Enquiry.find().sort({ createdAt: -1 }).limit(5),
    ]);
    res.json({
      totalProducts,
      activeProducts,
      categories: totalCategories,
      lowStockProducts,
      orders: totalOrders,
      customers: totalCustomers,
      enquiries: totalEnquiries,
      appointments: totalAppointments,
      recentOrders: recentOrders.map((order) => ({
        ...order.toObject(),
        id: String(order._id),
        customerName: order.customer?.fullName || '',
        status: order.orderStatus,
      })),
      recentEnquiries: recentEnquiries.map((enquiry) => ({ ...enquiry.toObject(), id: String(enquiry._id) })),
    });
  } catch (error) {
    next(error);
  }
});
app.use('/api/admin', adminRoutes);

app.use((error, req, res, next) => {
  const requestPath = (req.originalUrl || req.path).split('?')[0];
  const isProductCatalogRequest = requestPath === '/api/products' || requestPath.startsWith('/api/products/');
  const isCategoryCatalogRequest = requestPath === '/api/categories' || requestPath.startsWith('/api/categories/');
  const errorCode = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code
    : typeof error.code === 'number'
      ? error.code
      : undefined;
  const errorPath = typeof error.path === 'string' && /^[A-Za-z0-9_.]+$/.test(error.path)
    ? error.path
    : undefined;
  const status = error.status || 500;
  if (isProductCatalogRequest || isCategoryCatalogRequest) {
    const safeMessage = status < 500
      ? error.message
      : 'Catalog request failed; inspect the server stack trace for the failing operation.';
    const stackTrace = typeof error.stack === 'string'
      ? error.stack.split('\n').slice(1)
        .filter((line) => /^\s*at\s/.test(line))
        .map((line) => line.trim())
        .slice(0, 20)
      : [];
    console.error(JSON.stringify({
      event: 'catalog_request_failed',
      requestId: req.requestId,
      path: requestPath,
      method: req.method,
      status,
      errorName: error.name || 'Error',
      message: safeMessage,
      stackTrace,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorPath ? { errorPath } : {}),
      collection: isProductCatalogRequest ? Product.collection.name : Category.collection.name,
    }));
  } else {
    console.error(JSON.stringify({
      event: 'request_failed',
      requestId: req.requestId,
      method: req.method,
      route: requestPath,
      status,
      errorName: error.name || 'Error',
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(errorPath ? { errorPath } : {}),
    }));
  }
  res.status(error.status || 500).json({
    message: error.status ? error.message : 'Internal server error',
    requestId: req.requestId,
  });
});

const PORT = process.env.PORT || 5000;

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

connectDB()
  .then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Server failed to listen: port ${PORT} is already in use. Check for another backend instance before starting a new one.`);
      } else {
        console.error(`Server failed to listen [${error.code || 'unknown'}].`);
      }

      mongoose.disconnect().then(
        () => { process.exitCode = 1; },
        () => {
          console.error('MongoDB cleanup failed after the server listener error.');
          process.exitCode = 1;
        }
      );
    });
  })
  .catch((error) => {
    const category = error.category || 'backend startup failure';
    const message = error.category
      ? error.message
      : 'Check the backend environment and startup configuration.';
    console.error(`Server startup failed [${category}]. ${message}`);
    process.exitCode = 1;
  });
