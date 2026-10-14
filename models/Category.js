const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    legacyName: { type: String, default: '' },
  },
  { timestamps: true }
);

categorySchema.index({ parentId: 1, sortOrder: 1 });
categorySchema.index({ slug: 1 });

module.exports = mongoose.model('Category', categorySchema);
