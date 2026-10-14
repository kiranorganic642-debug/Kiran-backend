const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: null, min: 0 },
    outOfStock: { type: Boolean, default: false },
  },
  { _id: true }
);

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    altText: { type: String, default: '' },
    isPrimary: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const productSchema = new mongoose.Schema(
  {
    legacyId: { type: Number, default: null },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    sku: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, default: null, min: 0 },
    originalPrice: { type: Number, default: null, min: 0 },
    discount: { type: Number, default: null, min: 0 },
    stock: { type: Number, default: null, min: 0 },
    shortDescription: { type: String, default: '' },
    description: { type: String, default: '' },
    ingredients: { type: String, default: '' },
    benefits: { type: String, default: '' },
    howToUse: { type: String, default: '' },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviews: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    defaultSize: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    images: { type: [imageSchema], default: [] },
    variants: { type: [variantSchema], default: [] },
    seoTitle: { type: String, default: '' },
    seoDescription: { type: String, default: '' },
    isComingSoon: { type: Boolean, default: false },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', sku: 'text', categoryName: 'text' });
productSchema.index({ categoryId: 1, active: 1 });
productSchema.index({ legacyId: 1 });
productSchema.index({ slug: 1 });
productSchema.index({ sku: 1 });

module.exports = mongoose.model('Product', productSchema);
