const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

process.env.JWT_SECRET = 'order-route-test-secret';

const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const { Order } = require('../models/Commerce');

const customerId = '64b000000000000000000001';
const adminId = '64b000000000000000000002';
const otherCustomerId = '64b000000000000000000003';
const users = new Map([
  [customerId, { _id: customerId, role: 'user', email: 'rahul@example.test', status: 'active' }],
  [adminId, { _id: adminId, role: 'admin', email: 'admin@example.test', status: 'active' }],
  [otherCustomerId, { _id: otherCustomerId, role: 'user', email: 'other@example.test', status: 'active' }],
]);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await mongoose.disconnect();
});

const authHeader = (id) => ({
  Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`,
});

test('an authenticated customer order is returned by order number and reflects admin status updates', async (t) => {
  const originals = {
    findById: User.findById,
    productFindOne: Product.findOne,
    orderCreate: Order.create,
    orderFind: Order.find,
    orderFindByIdAndUpdate: Order.findByIdAndUpdate,
  };
  let savedOrder = null;
  let lastUpdateFilter;
  let lastUpdate;
  let lastCustomerFilter;

  User.findById = (id) => ({
    select: async () => users.get(String(id)) || null,
  });
  Product.findOne = async () => ({
    _id: '64b000000000000000000010',
    name: 'Catalog item',
    price: 180,
    active: true,
    stock: null,
    variants: [],
    thumbnail: '/product-images/catalog-item.png',
    images: [],
  });
  Order.create = async (data) => {
    savedOrder = {
      ...data,
      _id: '64b000000000000000000020',
      orderNumber: 'KIR-TEST-000001',
      paymentStatus: 'PENDING',
      orderStatus: 'PENDING',
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
      updatedAt: new Date('2026-10-15T00:00:00.000Z'),
    };
    return savedOrder;
  };
  Order.find = (filter) => {
    lastCustomerFilter = filter;
    return {
      sort: async () => {
        const isOwner = filter.$or.some((part) => (
          part.userId === savedOrder?.userId
          || (part.userId === null && part['customer.email'] === savedOrder?.customer.email)
        ));
        return isOwner && savedOrder ? [savedOrder] : [];
      },
    };
  };
  Order.findByIdAndUpdate = async (id, update, options) => {
    lastUpdateFilter = id;
    lastUpdate = { update, options };
    if (!savedOrder || id !== String(savedOrder._id)) return null;
    Object.assign(savedOrder, update, { updatedAt: new Date('2026-10-15T01:00:00.000Z') });
    return savedOrder;
  };
  t.after(() => {
    User.findById = originals.findById;
    Product.findOne = originals.productFindOne;
    Order.create = originals.orderCreate;
    Order.find = originals.orderFind;
    Order.findByIdAndUpdate = originals.orderFindByIdAndUpdate;
  });

  const unauthenticatedCreate = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticatedCreate.status, 401);
  assert.equal(savedOrder, null);

  const unauthenticatedList = await fetch(`${baseUrl}/api/orders`);
  assert.equal(unauthenticatedList.status, 401);
  assert.equal((await unauthenticatedList.json()).message, 'Not authorized, no token');

  const createResponse = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { ...authHeader(customerId), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: {
        fullName: 'Rahul Chauhan',
        email: 'attacker@example.test',
        phone: '9000000000',
      },
      items: [{ productId: 3, quantity: 1 }],
      shipping: 50,
      tax: 9,
      paymentMethod: 'COD',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).order;
  assert.equal(created.id, String(savedOrder._id));
  assert.equal(created.orderNumber, 'KIR-TEST-000001');
  assert.equal(created.total, 239);
  assert.equal(savedOrder.userId, customerId);
  assert.equal(savedOrder.customer.email, users.get(customerId).email);

  const ownerOrdersResponse = await fetch(`${baseUrl}/api/orders`, {
    headers: authHeader(customerId),
  });
  assert.equal(ownerOrdersResponse.status, 200);
  assert.equal(ownerOrdersResponse.headers.get('cache-control'), 'no-store');
  const ownerOrders = (await ownerOrdersResponse.json()).orders;
  assert.equal(ownerOrders.length, 1);
  assert.equal(ownerOrders[0].orderNumber, created.orderNumber);
  assert.equal(lastCustomerFilter.$or[0].userId, customerId);
  assert.equal(lastCustomerFilter.$or[1]['customer.email'], users.get(customerId).email);

  const invalidStatusResponse = await fetch(`${baseUrl}/api/admin/orders/${created.id}/status`, {
    method: 'PATCH',
    headers: { ...authHeader(adminId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'NOT_A_STATUS' }),
  });
  assert.equal(invalidStatusResponse.status, 400);
  assert.equal(savedOrder.orderStatus, 'PENDING');
  assert.equal(savedOrder.paymentStatus, 'PENDING');

  const unauthorizedUpdate = await fetch(`${baseUrl}/api/admin/orders/${created.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DELIVERED' }),
  });
  assert.equal(unauthorizedUpdate.status, 401);
  assert.equal(savedOrder.orderStatus, 'PENDING');

  const otherOrdersResponse = await fetch(`${baseUrl}/api/orders`, {
    headers: authHeader(otherCustomerId),
  });
  assert.equal(otherOrdersResponse.status, 200);
  assert.deepEqual((await otherOrdersResponse.json()).orders, []);

  const updateResponse = await fetch(`${baseUrl}/api/admin/orders/${created.id}/status`, {
    method: 'PATCH',
    headers: { ...authHeader(adminId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'DELIVERED' }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = await updateResponse.json();
  assert.equal(lastUpdateFilter, created.id);
  assert.deepEqual(lastUpdate.update, { orderStatus: 'DELIVERED' });
  assert.equal(lastUpdate.options.new, true);
  assert.equal(updated.orderStatus, 'DELIVERED');
  assert.equal(updated.paymentStatus, 'PENDING');

  const refreshedResponse = await fetch(`${baseUrl}/api/orders`, {
    headers: authHeader(customerId),
  });
  const refreshedOrder = (await refreshedResponse.json()).orders[0];
  assert.equal(refreshedOrder.id, created.id);
  assert.equal(refreshedOrder.orderNumber, created.orderNumber);
  assert.equal(refreshedOrder.orderStatus, 'DELIVERED');
  assert.equal(refreshedOrder.total, 239);
});
