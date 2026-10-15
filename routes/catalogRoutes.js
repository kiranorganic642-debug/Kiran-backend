const express = require('express');
const fs = require('fs');
const path = require('path');
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/adminMiddleware');
const { upload } = require('../middleware/uploadMiddleware');
const Product = require('../models/Product');
const Category = require('../models/Category');

const publicProducts = express.Router();
const adminProducts = express.Router();
const publicCategories = express.Router();
const adminCategories = express.Router();
const productAssetsDirectory = path.resolve(__dirname, '../../frontend/src/assets/Product');

const slugify = (value) => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const asProduct = (product, origin) => {
  const record = product.toObject ? product.toObject() : product;
  const primary = record.images?.find((image) => image.isPrimary) || record.images?.[0];
  const localImageUrl = (url) => (
    url && url.startsWith('/src/assets/Product/')
      ? `${origin}/api/catalog-assets/${encodeURIComponent(decodeURIComponent(path.basename(url)))}`
      : url && url.startsWith('/uploads/')
      ? `${origin}${url}`
      : url
  );

  return {
    ...record,
    id: String(record._id),
    category: record.categoryId && typeof record.categoryId === 'object'
      ? {
          id: String(record.categoryId._id),
          name: record.categoryId.name,
          slug: record.categoryId.slug,
        }
      : record.categoryName,
    categoryId: record.categoryId && typeof record.categoryId === 'object'
      ? String(record.categoryId._id)
      : record.categoryId ? String(record.categoryId) : '',
    image: localImageUrl(record.thumbnail || primary?.url || ''),
    thumbnail: localImageUrl(record.thumbnail || primary?.url || ''),
    images: (record.images || []).map((image) => ({
      ...image,
      id: String(image._id),
      url: localImageUrl(image.url),
    })),
    variants: (record.variants || []).map((variant) => ({
      ...variant,
      id: String(variant._id),
      size: variant.name,
    })),
  };
};

const serveProductAsset = (req, res, next) => {
  const filename = path.basename(req.params.filename);
  if (filename !== req.params.filename || !/\.(?:png|jpe?g|webp|gif)$/i.test(filename)) {
    return res.status(400).json({ message: 'Invalid product asset path' });
  }
  const filePath = path.join(productAssetsDirectory, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Product image is unavailable' });
  res.sendFile(filePath, (error) => {
    if (error) next(error);
  });
};

const categoryOutput = (category, productCount = 0) => {
  const record = category.toObject ? category.toObject() : category;
  return {
    ...record,
    id: String(record._id),
    active: record.active !== false,
    productCount,
    parentId: record.parentId ? String(record.parentId) : '',
  };
};

const getListParams = (req) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
  const filter = {};

  if (!req.user || req.user.role !== 'admin' || req.query.status === 'active') filter.active = true;
  if (req.query.status === 'inactive') filter.active = false;
  if (req.query.availability === 'available') {
    filter.$and = [{ $or: [{ stock: { $gt: 0 } }, { stock: null }] }];
  }
  if (req.query.availability === 'unavailable') filter.stock = { $lte: 0 };

  const search = String(req.query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: escaped, $options: 'i' } },
      { sku: { $regex: escaped, $options: 'i' } },
      { categoryName: { $regex: escaped, $options: 'i' } },
    ];
  }
  if (req.query.categoryId) filter.categoryId = req.query.categoryId;

  const sorts = {
    newest: { createdAt: -1, _id: -1 },
    oldest: { createdAt: 1, _id: 1 },
    'name-asc': { name: 1 },
    'name-desc': { name: -1 },
    'price-asc': { price: 1 },
    'price-desc': { price: -1 },
    'stock-asc': { stock: 1 },
  };
  return { page, limit, filter, sort: sorts[req.query.sort] || sorts.newest };
};

const listProducts = async (req, res, next) => {
  try {
    const { page, limit, filter, sort } = getListParams(req);
    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('categoryId', 'name slug')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
    ]);

    const result = products.map((product) => asProduct(product, `${req.protocol}://${req.get('host')}`));
    res.json({
      products: result,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

const getProduct = async (req, res, next) => {
  try {
    const legacyId = Number(req.params.id);
    const byId = /^[a-f\d]{24}$/i.test(req.params.id)
      ? { _id: req.params.id }
      : {
          $or: [
            { slug: req.params.id },
            ...(Number.isSafeInteger(legacyId) ? [{ legacyId }] : []),
          ],
        };
    const product = await Product.findOne(byId).populate('categoryId', 'name slug');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(asProduct(product, `${req.protocol}://${req.get('host')}`));
  } catch (error) {
    next(error);
  }
};

const validateProduct = (body, partial = false) => {
  const data = {};
  const textFields = [
    'name', 'slug', 'sku', 'shortDescription', 'description', 'ingredients',
    'benefits', 'howToUse', 'seoTitle', 'seoDescription', 'defaultSize',
  ];
  for (const field of textFields) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') throw new Error(`${field} must be text`);
      data[field] = body[field].trim();
    }
  }
  if (!partial && !data.name) throw new Error('Product name is required');
  if (body.name !== undefined && !data.name) throw new Error('Product name is required');
  if (body.slug !== undefined || (!partial && !data.slug)) {
    data.slug = slugify(data.slug || data.name || '');
  }
  for (const field of ['price', 'mrp', 'originalPrice', 'discount', 'stock', 'rating', 'reviews']) {
    if (body[field] !== undefined && body[field] !== '') {
      const value = Number(body[field]);
      if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`);
      data[field] = value;
    } else if (body[field] === '' && ['mrp', 'originalPrice', 'discount'].includes(field)) {
      data[field] = null;
    }
  }
  if (!partial && data.price === undefined) throw new Error('A valid product price is required');
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.featured !== undefined) data.featured = Boolean(body.featured);
  if (body.isComingSoon !== undefined) data.isComingSoon = Boolean(body.isComingSoon);
  if (body.categoryId !== undefined) data.categoryId = body.categoryId || null;
  if (Array.isArray(body.variants)) {
    data.variants = body.variants.map((variant) => {
      const name = String(variant.name || variant.size || '').trim();
      const price = Number(variant.price);
      if (!name || !Number.isFinite(price) || price < 0) {
        throw new Error('Every variant must have a name and a valid price');
      }
      return {
        name,
        price,
        stock: variant.stock == null || variant.stock === '' ? null : Number(variant.stock),
        outOfStock: Boolean(variant.outOfStock),
      };
    });
  }
  return data;
};

const saveProduct = async (req, res, next) => {
  try {
    const isNew = req.method === 'POST';
    const data = validateProduct(req.body, !isNew);
    if (data.categoryId) {
      const category = await Category.findById(data.categoryId).select('name');
      if (!category) return res.status(400).json({ message: 'Selected category does not exist' });
      data.categoryName = category.name;
    }
    if (isNew) {
      const product = await Product.create(data);
      return res.status(201).json(asProduct(await product.populate('categoryId', 'name slug'), `${req.protocol}://${req.get('host')}`));
    }
    const product = await Product.findByIdAndUpdate(req.params.id, data, {
      new: true,
      runValidators: true,
    }).populate('categoryId', 'name slug');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(asProduct(product, `${req.protocol}://${req.get('host')}`));
  } catch (error) {
    if (error.name === 'ValidationError' || error.code === 11000 || error.message) {
      return res.status(error.code === 11000 ? 409 : 400).json({ message: error.message });
    }
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (error) {
    next(error);
  }
};

const uploadProductImages = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const files = [...(req.files?.images || []), ...(req.files?.mainImage || [])];
    if (!files.length) return res.status(400).json({ message: 'Select at least one image' });
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(503).json({ message: 'Image uploads require Cloudinary credentials in the backend environment' });
    }

    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const uploaded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'kirans-organic/products', resource_type: 'image' },
        (error, result) => {
          if (error) return reject(error);
          if (!result?.secure_url) return reject(new Error('Image host returned no secure URL'));
          resolve(result.secure_url);
        }
      );
      stream.end(file.buffer);
    })));

    const incoming = uploaded.map((url) => ({
      url,
      altText: product.name,
      isPrimary: product.images.length === 0,
      sortOrder: product.images.length,
    }));
    product.images.push(...incoming);
    if (!product.thumbnail) product.thumbnail = incoming[0].url;
    await product.save();
    res.status(201).json(incoming.map((image, index) => ({
      ...image,
      id: String(product.images[product.images.length - incoming.length + index]._id),
      url: image.url,
    })));
  } catch (error) {
    next(error);
  }
};

const deleteProductImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const image = product.images.id(req.params.imageId);
    if (!image) return res.status(404).json({ message: 'Image not found' });
    const wasPrimary = image.isPrimary || product.thumbnail === image.url;
    image.deleteOne();
    if (wasPrimary) {
      const nextImage = product.images[0];
      if (nextImage) nextImage.isPrimary = true;
      product.thumbnail = nextImage?.url || '';
    }
    await product.save();
    res.json({ message: 'Image reference removed' });
  } catch (error) {
    next(error);
  }
};

const setPrimaryImage = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const selected = product.images.id(req.params.imageId);
    if (!selected) return res.status(404).json({ message: 'Image not found' });
    product.images.forEach((image) => { image.isPrimary = image.id === selected.id; });
    product.thumbnail = selected.url;
    await product.save();
    res.json({ message: 'Primary image updated' });
  } catch (error) {
    next(error);
  }
};

const reorderImages = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    for (const item of req.body.reorders || []) {
      const image = product.images.id(item.imageId);
      if (image) image.sortOrder = Number(item.sortOrder);
    }
    product.images.sort((a, b) => a.sortOrder - b.sortOrder);
    await product.save();
    res.json({ message: 'Image order updated' });
  } catch (error) {
    next(error);
  }
};

const listCategories = async (req, res, next) => {
  try {
    const filter = req.user?.role === 'admin' ? {} : { active: true };
    const categories = await Category.find(filter).sort({ sortOrder: 1, name: 1 }).lean();
    const counts = await Product.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$categoryId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((item) => [String(item._id), item.count]));
    const result = categories.map((category) => categoryOutput(category, countMap.get(String(category._id)) || 0));
    res.json(req.admin ? result : { categories: result });
  } catch (error) {
    next(error);
  }
};

const saveCategory = async (req, res, next) => {
  try {
    const isNew = req.method === 'POST';
    const name = String(req.body.name || '').trim();
    if ((!isNew && !name && req.body.name !== undefined) || (isNew && !name)) {
      return res.status(400).json({ message: 'Category name is required' });
    }
    const data = {};
    if (req.body.name !== undefined) data.name = name;
    if (req.body.slug !== undefined || (isNew && name)) data.slug = slugify(req.body.slug || name);
    for (const field of ['description', 'image']) {
      if (req.body[field] !== undefined) data[field] = String(req.body[field]);
    }
    if (req.body.active !== undefined) data.active = Boolean(req.body.active);
    if (req.body.sortOrder !== undefined) {
      const sortOrder = Number(req.body.sortOrder);
      if (!Number.isFinite(sortOrder)) return res.status(400).json({ message: 'Sort order must be numeric' });
      data.sortOrder = sortOrder;
    }
    if (req.body.parentId !== undefined) {
      if (req.body.parentId && !await Category.exists({ _id: req.body.parentId })) {
        return res.status(400).json({ message: 'Parent category does not exist' });
      }
      data.parentId = req.body.parentId || null;
    }
    const category = isNew
      ? await Category.create(data)
      : await Category.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!category) return res.status(404).json({ message: 'Category not found' });
    if (req.method !== 'POST' && data.name) {
      await Product.updateMany({ categoryId: category._id }, { $set: { categoryName: category.name } });
    }
    res.status(isNew ? 201 : 200).json(categoryOutput(category));
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ message: error.message });
  }
};

const deleteCategory = async (req, res, next) => {
  try {
    if (await Product.exists({ categoryId: req.params.id })) {
      return res.status(409).json({ message: 'Category has products; reassign them before deleting it' });
    }
    if (await Category.exists({ parentId: req.params.id })) {
      return res.status(409).json({ message: 'Category has subcategories; move or remove them before deleting it' });
    }
    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });
    res.json({ message: 'Category deleted' });
  } catch (error) {
    next(error);
  }
};

publicProducts.get('/', listProducts);
publicProducts.get('/:id', getProduct);
adminProducts.use(protect, admin);
adminProducts.get('/', listProducts);
adminProducts.get('/:id', getProduct);
adminProducts.post('/', saveProduct);
adminProducts.put('/:id', saveProduct);
adminProducts.patch('/:id/active', (req, res, next) => {
  req.body.active = Boolean(req.body.active);
  saveProduct(req, res, next);
});
adminProducts.patch('/:id/featured', (req, res, next) => {
  req.body.featured = Boolean(req.body.featured);
  saveProduct(req, res, next);
});
adminProducts.delete('/:id', deleteProduct);
adminProducts.post('/:id/images', upload.fields([{ name: 'images', maxCount: 8 }, { name: 'mainImage', maxCount: 1 }]), uploadProductImages);
adminProducts.delete('/:id/images/:imageId', deleteProductImage);
adminProducts.patch('/:id/images/:imageId/primary', setPrimaryImage);
adminProducts.patch('/:id/images/reorder', reorderImages);
publicCategories.get('/', listCategories);
adminCategories.use(protect, admin);
adminCategories.get('/', listCategories);
adminCategories.post('/', saveCategory);
adminCategories.put('/:id', saveCategory);
adminCategories.patch('/:id', saveCategory);
adminCategories.delete('/:id', deleteCategory);

module.exports = {
  publicProducts,
  adminProducts,
  publicCategories,
  adminCategories,
  serveProductAsset,
};
