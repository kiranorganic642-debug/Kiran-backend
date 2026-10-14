require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');

const backendDir = path.resolve(__dirname, '..');
const frontendDir = path.resolve(backendDir, '..', 'frontend');
const slugify = (value) => value
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const loadCatalog = async () => {
  const frontendRequire = createRequire(path.join(frontendDir, 'package.json'));
  const vitePath = frontendRequire.resolve('vite');
  const { createServer } = await import(require('url').pathToFileURL(vitePath).href);
  const server = await createServer({
    root: frontendDir,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await server.ssrLoadModule('/src/utils/products.js');
  } finally {
    await server.close();
  }
};

const serialize = (value) => JSON.stringify(value, (_key, field) => (
  field && typeof field === 'object' && typeof field.toJSON === 'function'
    ? field.toJSON()
    : field
), 2);

const run = async () => {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--backup')) {
    throw new Error('Applying changes requires --backup so current product and category documents are saved first.');
  }

  const { allProducts } = await loadCatalog();
  const categoryNames = [...new Set(allProducts.map((item) => String(item.category || '').trim()).filter(Boolean))];
  const missingImages = allProducts.flatMap((product) => {
    const imagePath = String(product.image || '');
    if (!imagePath.startsWith('/src/assets/Product/')) {
      return [{ legacyId: product.id, name: product.name, image: imagePath }];
    }
    const filename = decodeURIComponent(imagePath.slice('/src/assets/Product/'.length));
    const imageFile = path.resolve(frontendDir, 'src', 'assets', 'Product', filename);
    const assetDirectory = path.resolve(frontendDir, 'src', 'assets', 'Product') + path.sep;
    return imageFile.startsWith(assetDirectory) && fs.existsSync(imageFile)
      ? []
      : [{ legacyId: product.id, name: product.name, image: imagePath }];
  });
  const manualReview = allProducts
    .filter((product) => product.id === 42 && decodeURIComponent(String(product.image || '')).includes('organic-sea-buckthorn-juice'))
    .map((product) => ({
      legacyId: product.id,
      name: product.name,
      reason: 'Frontend catalog explicitly reuses the sea buckthorn juice image for capsules.',
      image: product.image,
    }));

  if (process.argv.includes('--catalog-only')) {
    console.log(JSON.stringify({
      frontendProductCount: allProducts.length,
      frontendCategoryCount: categoryNames.length,
      categories: categoryNames,
      duplicateIds: allProducts.map((product) => product.id).filter((id, index, ids) => ids.indexOf(id) !== index),
      missingImages,
      manualReview,
    }, null, 2));
    return;
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  const before = await Promise.all([
    Product.find({}).lean(),
    Category.find({}).lean(),
  ]);
  const [existingProducts, existingCategories] = before;
  const backupDir = path.join(backendDir, 'backups');
  let backupFiles = [];
  if (apply) {
    fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const productBackup = path.join(backupDir, `products-${timestamp}.json`);
    const categoryBackup = path.join(backupDir, `categories-${timestamp}.json`);
    fs.writeFileSync(productBackup, serialize(existingProducts), { flag: 'wx' });
    fs.writeFileSync(categoryBackup, serialize(existingCategories), { flag: 'wx' });
    backupFiles = [productBackup, categoryBackup];
  }

  const report = {
    mode: apply ? 'apply' : 'dry-run',
    frontendProductCount: allProducts.length,
    databaseProductCountBefore: existingProducts.length,
    databaseCategoryCountBefore: existingCategories.length,
    categoriesToAdd: [],
    productsToAdd: [],
    duplicatesSkipped: [],
    updated: 0,
    missingImages,
    manualReview,
    errors: [],
    backupFiles,
  };

  const knownCategories = new Set(existingCategories.map((category) => category.slug));
  const categoryByName = new Map();
  for (const name of categoryNames) {
    const slug = slugify(name);
    let category = existingCategories.find((item) => item.slug === slug || item.legacyName === name);
    if (!category && !knownCategories.has(slug)) {
      report.categoriesToAdd.push({ name, slug });
      if (apply) {
        category = await Category.findOneAndUpdate(
          { slug },
          { $setOnInsert: { name, slug, legacyName: name, active: true } },
          { upsert: true, new: true }
        );
        knownCategories.add(slug);
      }
    }
    if (category) categoryByName.set(name, category);
  }

  const knownSlugs = new Set(existingProducts.map((product) => product.slug));
  for (const source of allProducts) {
    try {
      const imagePath = String(source.image || '');
      const relativeAsset = imagePath.startsWith('/src/assets/Product/')
        ? decodeURIComponent(imagePath.slice('/src/assets/Product/'.length))
        : '';
      const imageFile = relativeAsset
        ? path.resolve(frontendDir, 'src', 'assets', 'Product', relativeAsset)
        : '';
      const imageExists = Boolean(imageFile && imageFile.startsWith(path.resolve(frontendDir, 'src', 'assets', 'Product') + path.sep) && fs.existsSync(imageFile));
      const categoryName = String(source.category || '').trim();
      const categorySlug = slugify(categoryName);
      let category = categoryByName.get(categoryName);
      if (!category && apply) category = await Category.findOne({ slug: categorySlug });
      let slug = slugify(source.name);
      if (knownSlugs.has(slug)) slug = `${slug}-${source.id}`;

      const variantData = (source.variants || []).map((variant) => ({
        name: String(variant.size || variant.name || '').trim(),
        price: Number(variant.price ?? source.price),
        stock: variant.outOfStock ? 0 : null,
        outOfStock: Boolean(variant.outOfStock),
      }));
      const matchFilter = {
        $or: [
          { legacyId: Number(source.id) },
          { slug: slugify(source.name) },
          ...(source.sku ? [{ sku: source.sku }] : []),
        ],
      };
      const existing = existingProducts.find((product) => (
        product.legacyId === Number(source.id)
        || product.slug === slugify(source.name)
        || (source.sku && product.sku === source.sku)
      ));
      if (existing) {
        report.duplicatesSkipped.push({
          legacyId: source.id,
          name: source.name,
          existingId: String(existing._id),
          existingLegacyId: existing.legacyId ?? null,
          reason: existing.legacyId === Number(source.id) ? 'legacy-id' : 'slug-or-sku',
        });
        continue;
      }

      const payload = {
        legacyId: Number(source.id),
        name: source.name,
        slug,
        sku: source.sku || undefined,
        categoryId: category?._id || null,
        categoryName,
        price: Number(source.price || 0),
        mrp: Number(source.originalPrice ?? source.price ?? 0),
        originalPrice: Number(source.originalPrice ?? source.price ?? 0),
        stock: variantData.length && variantData.every((variant) => variant.outOfStock) ? 0 : null,
        shortDescription: '',
        description: source.description || '',
        benefits: Array.isArray(source.benefits) ? source.benefits.join('\n') : String(source.benefits || ''),
        rating: Number(source.rating || 0),
        reviews: Number(source.reviews || 0),
        active: true,
        featured: false,
        defaultSize: source.defaultSize || '',
        thumbnail: imageExists ? imagePath : '',
        images: imageExists ? [{ url: imagePath, altText: source.name, isPrimary: true, sortOrder: 0 }] : [],
        variants: variantData,
        isComingSoon: Boolean(source.isComingSoon),
      };
      report.productsToAdd.push({ legacyId: source.id, name: source.name, category: categoryName });
      if (apply) {
        await Product.findOneAndUpdate(
          matchFilter,
          { $setOnInsert: payload },
          { upsert: true, new: true, runValidators: true }
        );
        knownSlugs.add(slug);
      }
    } catch (error) {
      report.errors.push({ legacyId: source.id, name: source.name, message: error.message });
    }
  }

  report.wouldImport = report.productsToAdd.length;
  report.imported = apply ? report.productsToAdd.length - report.errors.length : 0;
  report.duplicatesSkippedCount = report.duplicatesSkipped.length;
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
};

run()
  .catch((error) => {
    console.error(`Product synchronization failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
