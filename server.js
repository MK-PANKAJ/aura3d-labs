const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
// Auto-load .env file if it exists (zero-dependency for Node.js)
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  } catch (e) {
    console.warn('Could not read .env file:', e.message);
  }
}

const PORT = process.env.PORT || 3000;

// Cloud Database & Local Datasets Helper
const db = require('./services/firebase');
const DATA_DIR = path.join(process.cwd(), 'data');

function getReviews() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8'));
}
function getGuides() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'guides.json'), 'utf8'));
}
function getFaqs() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'faqs.json'), 'utf8'));
}

// ==============================================================================
// PRODUCTION-READY ADMIN SECURITY & AUTHENTICATION
// ==============================================================================
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || process.env.ADMIN_ID || 'admin').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'aura3d@2026').trim();

// Security check notification
if (ADMIN_PASSWORD === 'aura3d@2026') {
  console.log('⚠️  [SECURITY NOTICE] Running with default admin password. For production deployments, set ADMIN_PASSWORD in environment variables.');
}

/**
 * Constant-time string equality check to eliminate side-channel timing attacks
 */
function safeCompare(inputStr, targetStr) {
  if (typeof inputStr !== 'string' || typeof targetStr !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(inputStr).digest();
  const hashB = crypto.createHash('sha256').update(targetStr).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// Brute-force protection: Max 5 failed attempts per 15-minute window per IP
const loginAttempts = new Map(); // ip -> { count, firstAttempt, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 mins
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };

  if (record.lockedUntil && now < record.lockedUntil) {
    const waitSec = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, waitSec, locked: true };
  }

  if (now - record.firstAttempt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS };
  }

  const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
  return { allowed: true, remaining };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  let record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > ATTEMPT_WINDOW_MS) {
    record = { count: 1, firstAttempt: now, lockedUntil: 0 };
  } else {
    record.count++;
  }

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(ip, record);

  const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - record.count);
  return {
    locked: record.count >= MAX_LOGIN_ATTEMPTS,
    remaining,
    waitSec: Math.ceil(LOCKOUT_DURATION_MS / 1000)
  };
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Active session token store: token -> { username, ip, expiresAt }
const activeAdminTokens = new Map();

function generateAdminToken(username, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  activeAdminTokens.set(token, {
    username,
    ip,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });
  return token;
}

// Periodic cleanup of expired tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of activeAdminTokens.entries()) {
    if (now > data.expiresAt) {
      activeAdminTokens.delete(token);
    }
  }
}, 30 * 60 * 1000).unref();

function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Admin authentication token required' });
  }
  const token = authHeader.split(' ')[1];
  const session = activeAdminTokens.get(token);
  if (!session || Date.now() > session.expiresAt) {
    if (session) activeAdminTokens.delete(token);
    return res.status(401).json({ success: false, error: 'Unauthorized: Session expired or invalid. Please log in again.' });
  }
  req.adminUser = session.username;
  next();
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// API Routes
app.get('/api/products', async (req, res) => {
  try {
    let filtered = await db.getAllProducts();
    const { category, brand, search, featured, sort } = req.query;

    if (category && category !== 'all') {
      filtered = filtered.filter(p => p.category.toLowerCase() === category.toLowerCase());
    }

    if (brand && brand !== 'all') {
      filtered = filtered.filter(p => p.brand.toLowerCase() === brand.toLowerCase());
    }

    if (featured === 'true') {
      filtered = filtered.filter(p => p.featured);
    }

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q)
      );
    }

    if (sort === 'price-low') {
      filtered.sort((a, b) => a.price - b.price);
    } else if (sort === 'price-high') {
      filtered.sort((a, b) => b.price - a.price);
    } else if (sort === 'rating') {
      filtered.sort((a, b) => b.rating - a.rating);
    }

    res.json({
      total: filtered.length,
      products: filtered
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Failed to retrieve products' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const products = await db.getAllProducts();
    const item = products.find(p => p.id === req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(item);
  } catch (err) {
    console.error('Error fetching product:', err);
    res.status(500).json({ error: 'Failed to retrieve product' });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const prods = await db.getAllProducts();
    const categories = [
      { id: 'all', name: 'All Products', count: prods.length },
      { id: 'printers', name: '3D Printers', count: prods.filter(p => p.category === 'printers').length },
      { id: 'filaments', name: 'Filaments', count: prods.filter(p => p.category === 'filaments').length },
      { id: 'resins', name: 'UV Resins', count: prods.filter(p => p.category === 'resins').length },
      { id: 'spares', name: 'Spares & Upgrades', count: prods.filter(p => p.category === 'spares').length },
      { id: 'pens', name: '3D Pens & Art', count: prods.filter(p => p.category === 'pens').length }
    ];
    res.json(categories);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
});

app.get('/api/reviews', async (req, res) => {
  try {
    const list = await db.getAllReviews();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// Product-specific reviews
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    const list = await db.getAllReviews();
    const pid = req.params.id;
    // Returns reviews matching this productId and marked approved (or all matching if approved field is unset)
    const filtered = list.filter(r => (r.productId === pid || r.product === pid) && r.approved !== false);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load product reviews' });
  }
});

// Post a review after purchase (Customer Submission)
app.post('/api/products/:id/reviews', async (req, res) => {
  try {
    const { name, rating, review, role, orderRef } = req.body || {};
    if (!name || !review || rating === undefined) {
      return res.status(400).json({ success: false, error: 'Name, rating (1-5), and review text are required.' });
    }

    const numRating = Math.max(1, Math.min(5, Math.round(Number(rating))));
    if (isNaN(numRating)) {
      return res.status(400).json({ success: false, error: 'Rating must be a number between 1 and 5.' });
    }

    const products = await db.getAllProducts();
    const product = products.find(p => p.id === req.params.id);

    const initials = name.trim().split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'VB';
    const newReview = {
      id: 'rev-' + Date.now(),
      productId: req.params.id,
      product: product ? product.name : req.params.id,
      name: name.trim(),
      role: role ? role.trim() : 'Verified Buyer',
      rating: numRating,
      review: review.trim(),
      orderRef: orderRef ? String(orderRef).trim() : null,
      verified: true,
      approved: false, // Default: Pending admin moderation/approval
      avatar: initials,
      createdAt: new Date().toISOString()
    };

    const result = await db.createReview(newReview);
    res.status(201).json({
      success: true,
      message: 'Review submitted successfully! It has been forwarded to store administrators for verification.',
      review: newReview,
      database: result.provider
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    res.status(500).json({ success: false, error: 'Failed to submit review: ' + err.message });
  }
});

app.get('/api/guides', (req, res) => {
  res.json(getGuides());
});

app.get('/api/faqs', (req, res) => {
  res.json(getFaqs());
});

// Dynamic SEO Sitemap
app.get('/sitemap.xml', async (req, res) => {
  const host = req.protocol + '://' + req.get('host');
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${host}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${host}/catalog.html</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${host}/spares.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${host}/guides.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;

  try {
    const prods = await db.getAllProducts();
    prods.forEach(p => {
      xml += `  <url>
    <loc>${host}/catalog.html?product=${p.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    });
  } catch (e) {
    // ignore
  }

  xml += `</urlset>`;
  res.header('Content-Type', 'application/xml');
  res.send(xml);
});

// Robots.txt
app.get('/robots.txt', (req, res) => {
  const host = req.protocol + '://' + req.get('host');
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Sitemap: ${host}/sitemap.xml
`);
});

// --- Secure Admin Authentication Routes ---
app.post('/api/admin/login', (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
  const { username, adminId, id, password } = req.body || {};
  const userToVerify = (username || adminId || id || '').trim();
  const passToVerify = (password || '').trim();

  // Rate limit check
  const rateStatus = checkRateLimit(ip);
  if (!rateStatus.allowed) {
    return res.status(429).json({
      success: false,
      error: `Too many failed attempts. Terminal locked for ${Math.ceil(rateStatus.waitSec / 60)} minutes.`,
      waitSec: rateStatus.waitSec
    });
  }

  if (!userToVerify || !passToVerify) {
    return res.status(400).json({
      success: false,
      error: 'Both Admin ID and Master Password are required.'
    });
  }

  // Constant-time cryptographic comparison
  const userMatch = safeCompare(userToVerify, ADMIN_USERNAME);
  const passMatch = safeCompare(passToVerify, ADMIN_PASSWORD);

  if (!userMatch || !passMatch) {
    const failStatus = recordFailedAttempt(ip);
    if (failStatus.locked) {
      return res.status(429).json({
        success: false,
        error: `Account locked due to ${MAX_LOGIN_ATTEMPTS} consecutive failed attempts. Please retry in 15 minutes.`,
        waitSec: failStatus.waitSec
      });
    }
    return res.status(401).json({
      success: false,
      error: `Invalid Admin ID or Password. ${failStatus.remaining} attempts remaining before temporary lockout.`,
      remainingAttempts: failStatus.remaining
    });
  }

  // Authentication succeeded: clear rate limit and issue token
  clearRateLimit(ip);
  const token = generateAdminToken(ADMIN_USERNAME, ip);

  res.json({
    success: true,
    token,
    user: ADMIN_USERNAME,
    message: 'Access granted. Welcome to Aura3D Operations Terminal.',
    expiresIn: 86400
  });
});

app.post('/api/admin/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    activeAdminTokens.delete(token);
  }
  res.json({ success: true, message: 'Session revoked successfully.' });
});

app.get('/api/admin/verify', verifyAdmin, (req, res) => {
  res.json({ success: true, verified: true, user: req.adminUser });
});

// --- Secure Admin Product Management Routes ---
app.post('/api/admin/products', verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      brand,
      category,
      type,
      price,
      originalPrice,
      badge,
      image,
      specs,
      description,
      featured,
      inStock
    } = req.body;

    if (!name || !brand || !category || price === undefined || !image) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, brand, category, price, and image are mandatory.'
      });
    }

    const numPrice = Number(price);
    const numOrig = originalPrice ? Number(originalPrice) : null;

    if (isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Price must be a valid positive number.' });
    }

    // Auto calculate discount percentage
    let discount = '';
    if (numOrig && numOrig > numPrice) {
      const pct = Math.round(((numOrig - numPrice) / numOrig) * 100);
      discount = `${pct}% OFF`;
    }

    // Generate unique slug
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug || 'product';
    const products = await db.getAllProducts();
    let counter = 1;
    while (products.some(p => p.id === slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    const newProduct = {
      id: slug,
      name: name.trim(),
      brand: brand.trim(),
      category: category.toLowerCase().trim(),
      type: type ? type.trim() : (category === 'printers' ? '3D Printer' : 'Precision Hardware'),
      price: numPrice,
      originalPrice: numOrig || null,
      discount: discount || null,
      rating: req.body.rating !== undefined && req.body.rating !== '' ? Math.max(1, Math.min(5, Number(req.body.rating))) : 5.0,
      reviewsCount: req.body.reviewsCount !== undefined && req.body.reviewsCount !== '' ? Math.max(0, parseInt(req.body.reviewsCount, 10)) : 1,
      inStock: inStock !== false,
      featured: Boolean(featured),
      badge: badge ? badge.trim() : null,
      image: image.trim(),
      specs: (specs && typeof specs === 'object') ? specs : {},
      description: description ? description.trim() : `High-precision authentic ${name} engineered for consistent additive manufacturing performance.`
    };

    const result = await db.createProduct(newProduct);

    res.status(201).json({
      success: true,
      message: 'Product successfully added to catalog',
      product: newProduct,
      database: result.provider,
      cloudSynced: result.cloudSuccess
    });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ success: false, error: 'Failed to persist product: ' + err.message });
  }
});

// Update Existing Product (Allows admin to edit title, pricing, specs, and Client-Facing Average Rating)
app.put('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  try {
    const products = await db.getAllProducts();
    const existing = products.find(p => p.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found in registry.' });
    }

    const {
      name,
      brand,
      category,
      type,
      price,
      originalPrice,
      badge,
      image,
      specs,
      description,
      featured,
      inStock,
      rating,
      reviewsCount
    } = req.body;

    if (!name || !brand || !category || price === undefined || !image) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: name, brand, category, price, and image are mandatory.'
      });
    }

    const numPrice = Number(price);
    const numOrig = originalPrice ? Number(originalPrice) : null;

    if (isNaN(numPrice) || numPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Price must be a valid positive number.' });
    }

    // Auto calculate discount percentage
    let discount = '';
    if (numOrig && numOrig > numPrice) {
      const pct = Math.round(((numOrig - numPrice) / numOrig) * 100);
      discount = `${pct}% OFF`;
    }

    const updatedProduct = {
      ...existing,
      name: name.trim(),
      brand: brand.trim(),
      category: category.toLowerCase().trim(),
      type: type ? type.trim() : existing.type,
      price: numPrice,
      originalPrice: numOrig || null,
      discount: discount || null,
      rating: (rating !== undefined && rating !== null && rating !== '') ? Math.max(1, Math.min(5, Number(rating))) : (existing.rating || 5.0),
      reviewsCount: (reviewsCount !== undefined && reviewsCount !== null && reviewsCount !== '') ? Math.max(0, parseInt(reviewsCount, 10)) : (existing.reviewsCount || 0),
      inStock: inStock !== false,
      featured: Boolean(featured),
      badge: badge ? badge.trim() : null,
      image: image.trim(),
      specs: (specs && typeof specs === 'object') ? specs : existing.specs || {},
      description: description ? description.trim() : existing.description
    };

    const result = await db.updateProduct(req.params.id, updatedProduct);

    res.json({
      success: true,
      message: `Product "${updatedProduct.name}" updated successfully`,
      product: updatedProduct,
      database: result.provider,
      cloudSynced: result.cloudSuccess
    });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ success: false, error: 'Failed to update product: ' + err.message });
  }
});

// Delete Product
app.delete('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  try {
    const products = await db.getAllProducts();
    const existing = products.find(p => p.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const result = await db.deleteProduct(req.params.id);

    res.json({
      success: true,
      message: `Product "${existing.name}" deleted successfully`,
      deletedId: req.params.id,
      database: result.provider,
      cloudSynced: result.cloudSuccess
    });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, error: 'Failed to delete product: ' + err.message });
  }
});

// --- Secure Admin Review Moderation Routes ---
app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
  try {
    const reviews = await db.getAllReviews();
    res.json({ success: true, total: reviews.length, reviews });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to retrieve reviews' });
  }
});

app.put('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  try {
    const reviews = await db.getAllReviews();
    const existing = reviews.find(r => String(r.id) === String(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    const { approved, rating, review, name, role } = req.body;
    const updated = {
      ...existing,
      approved: approved !== undefined ? Boolean(approved) : existing.approved,
      rating: rating !== undefined ? Math.max(1, Math.min(5, Number(rating))) : existing.rating,
      review: review !== undefined ? String(review).trim() : existing.review,
      name: name !== undefined ? String(name).trim() : existing.name,
      role: role !== undefined ? String(role).trim() : existing.role
    };

    const result = await db.updateReview(req.params.id, updated);
    res.json({ success: true, message: 'Review updated successfully', review: updated, database: result.provider });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update review: ' + err.message });
  }
});

app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  try {
    const reviews = await db.getAllReviews();
    const existing = reviews.find(r => String(r.id) === String(req.params.id));
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Review not found' });
    }

    const result = await db.deleteReview(req.params.id);
    res.json({ success: true, message: 'Review deleted successfully', deletedId: req.params.id, database: result.provider });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete review: ' + err.message });
  }
});

// Firebase Cloud Sync & Status Endpoints
app.get('/api/admin/firebase/status', verifyAdmin, (req, res) => {
  res.json({
    success: true,
    configured: db.isFirebaseConfigured(),
    provider: db.getProviderType()
  });
});

app.post('/api/admin/firebase/sync', verifyAdmin, async (req, res) => {
  try {
    const result = await db.seedCatalogToFirebase();
    res.json({
      success: true,
      message: `Successfully seeded ${result.seededCount} products to ${result.provider}.`,
      ...result
    });
  } catch (err) {
    console.error('Firebase sync error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ==============================================================================
// CUSTOMER PORTAL & AUTHENTICATION ENGINE
// ==============================================================================
const activeCustomerTokens = new Map(); // token -> { id, email, expiresAt }
const CUSTOMER_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days

function verifyCustomer(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Customer sign-in required' });
  }
  const token = authHeader.split(' ')[1];
  const session = activeCustomerTokens.get(token);
  if (!session || Date.now() > session.expiresAt) {
    activeCustomerTokens.delete(token);
    return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
  }
  req.customerId = session.id;
  req.customerEmail = session.email;
  next();
}

// Register Customer
app.post('/api/customer/register', async (req, res) => {
  try {
    const { name, email, phone, password, address, city, state, pincode } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await db.getCustomerByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists. Please sign in.' });
    }

    const newCustomer = {
      id: 'cust-' + Date.now(),
      name: name.trim(),
      email: cleanEmail,
      phone: (phone || '').trim(),
      password: password.trim(), // In production, password hash is stored
      address: (address || '').trim(),
      city: (city || '').trim(),
      state: (state || '').trim(),
      pincode: (pincode || '').trim(),
      orders: [],
      createdAt: new Date().toISOString()
    };

    await db.createCustomer(newCustomer);

    // Issue session token
    const token = crypto.randomBytes(32).toString('hex');
    activeCustomerTokens.set(token, {
      id: newCustomer.id,
      email: newCustomer.email,
      expiresAt: Date.now() + CUSTOMER_SESSION_DURATION_MS
    });

    const { password: _, ...customerSafe } = newCustomer;
    res.status(201).json({
      success: true,
      message: 'Account created successfully. Welcome to Aura3D Labs.',
      token,
      customer: customerSafe
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, error: 'Failed to create account: ' + err.message });
  }
});

// Customer Sign In
app.post('/api/customer/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const customer = await db.getCustomerByEmail(cleanEmail);
    if (!customer || customer.password !== password.trim()) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeCustomerTokens.set(token, {
      id: customer.id,
      email: customer.email,
      expiresAt: Date.now() + CUSTOMER_SESSION_DURATION_MS
    });

    const { password: _, ...customerSafe } = customer;
    res.json({
      success: true,
      message: 'Welcome back, ' + customer.name,
      token,
      customer: customerSafe
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Sign in failed.' });
  }
});

// Customer Profile & Order History
app.get('/api/customer/me', verifyCustomer, async (req, res) => {
  try {
    const customers = await db.getAllCustomers();
    const customer = customers.find(c => c.id === req.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const allOrders = await db.getAllOrders();
    const myOrders = allOrders.filter(o => 
      (o.customer && o.customer.email && o.customer.email.toLowerCase() === req.customerEmail.toLowerCase()) ||
      (customer.orders && customer.orders.includes(o.id))
    );

    const { password: _, ...customerSafe } = customer;
    res.json({
      success: true,
      customer: customerSafe,
      orders: myOrders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to retrieve customer profile' });
  }
});

// Customer Profile Update
app.put('/api/customer/profile', verifyCustomer, async (req, res) => {
  try {
    const customers = await db.getAllCustomers();
    const customer = customers.find(c => c.id === req.customerId);
    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const { name, phone, address, city, state, pincode } = req.body || {};
    const updated = {
      ...customer,
      name: name ? name.trim() : customer.name,
      phone: phone ? phone.trim() : customer.phone,
      address: address ? address.trim() : customer.address,
      city: city ? city.trim() : customer.city,
      state: state ? state.trim() : customer.state,
      pincode: pincode ? pincode.trim() : customer.pincode
    };

    await db.updateCustomer(customer.id, updated);
    const { password: _, ...customerSafe } = updated;
    res.json({ success: true, message: 'Profile updated successfully', customer: customerSafe });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// ==============================================================================
// E-COMMERCE CHECKOUT & ORDER PLACEMENT
// ==============================================================================
app.post('/api/orders', async (req, res) => {
  try {
    const { items, customer, paymentMethod, notes } = req.body || {};
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'Your bag is empty.' });
    }
    if (!customer || !customer.name || !customer.phone || !customer.address || !customer.city || !customer.pincode) {
      return res.status(400).json({ success: false, error: 'Full delivery address, phone, and name are required.' });
    }

    const subtotal = items.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty || 1)), 0);
    const gst = Math.round(subtotal * 0.18);
    const shipping = subtotal >= 1499 ? 0 : 149;
    const total = subtotal + gst + shipping;

    const orderId = `AUR-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const nowIso = new Date().toISOString();
    const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
    const estDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const estimatedDelivery = estDate.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });

    const newOrder = {
      id: orderId,
      deliveryOtp,
      estimatedDelivery,
      customer: {
        name: customer.name.trim(),
        email: (customer.email || '').toLowerCase().trim(),
        phone: customer.phone.trim(),
        address: customer.address.trim(),
        city: customer.city.trim(),
        state: (customer.state || 'Maharashtra').trim(),
        pincode: customer.pincode.trim(),
        gstin: customer.gstin ? customer.gstin.trim() : null
      },
      items: items.map(i => ({
        id: i.id,
        name: i.name,
        price: Number(i.price),
        qty: Number(i.qty || 1),
        image: i.image,
        hsn: i.id?.includes('filament') ? '3916' : (i.id?.includes('resin') ? '3907' : '8477')
      })),
      subtotal,
      gst,
      shipping,
      total,
      status: 'PLACED',
      paymentMethod: paymentMethod || 'Prepaid UPI / Card',
      paymentStatus: paymentMethod === 'Cash on Delivery' ? 'PENDING' : 'PAID',
      courier: {
        partner: 'BlueDart / Delhivery Air',
        awb: 'PENDING-ALLOCATION',
        trackingUrl: ''
      },
      timeline: [
        {
          status: 'PLACED',
          label: 'Order Confirmed & Placed',
          timestamp: nowIso,
          note: `Payment mode: ${paymentMethod || 'Prepaid UPI'}. GST Tax invoice registered with ITC.`
        }
      ],
      notes: notes ? notes.trim() : '',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const result = await db.createOrder(newOrder);

    // If customer email exists in registered accounts, link order
    if (newOrder.customer.email) {
      try {
        const cust = await db.getCustomerByEmail(newOrder.customer.email);
        if (cust) {
          cust.orders = cust.orders || [];
          if (!cust.orders.includes(orderId)) {
            cust.orders.push(orderId);
            await db.updateCustomer(cust.id, cust);
          }
        }
      } catch (e) {
        // non-blocking
      }
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully! Official Order ID: ' + orderId,
      order: newOrder,
      database: result.provider
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: 'Checkout failed: ' + err.message });
  }
});

// Single Order Detail (For Printable Tax Invoice & Standalone Views)
app.get('/api/orders/:id', async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    const existing = orders.find(o => o.id.toLowerCase() === req.params.id.toLowerCase());
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, order: existing });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch order details' });
  }
});

// Customer Cancel Order (Permitted if status is PLACED or PROCESSING)
app.put('/api/orders/:id/cancel', async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    const existing = orders.find(o => o.id.toLowerCase() === req.params.id.toLowerCase());
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (['DISPATCHED', 'IN_TRANSIT', 'DELIVERED'].includes(existing.status)) {
      return res.status(400).json({
        success: false,
        error: `Order cannot be cancelled as it is already ${existing.status}. Please contact Direct Desk for returns.`
      });
    }

    if (existing.status === 'CANCELLED') {
      return res.status(400).json({ success: false, error: 'Order has already been cancelled.' });
    }

    const { reason } = req.body || {};
    const nowIso = new Date().toISOString();

    existing.status = 'CANCELLED';
    existing.updatedAt = nowIso;
    existing.timeline = existing.timeline || [];
    existing.timeline.push({
      status: 'CANCELLED',
      label: 'Order Cancelled by Customer',
      timestamp: nowIso,
      note: reason ? reason.trim() : 'Customer requested order cancellation prior to dispatch.'
    });

    await db.updateOrder(existing.id, existing);
    res.json({ success: true, message: 'Order cancelled successfully', order: existing });
  } catch (err) {
    console.error('Order cancellation error:', err);
    res.status(500).json({ success: false, error: 'Failed to cancel order: ' + err.message });
  }
});

// Public Order Tracking by Order ID or Phone Number
app.get('/api/orders/track/:query', async (req, res) => {
  try {
    const rawQuery = req.params.query.trim().toLowerCase();
    const orders = await db.getAllOrders();

    // Match by Order ID or Phone
    const matched = orders.filter(o => 
      o.id.toLowerCase() === rawQuery ||
      (o.customer && o.customer.phone && o.customer.phone.replace(/\D/g, '').endsWith(rawQuery.replace(/\D/g, '')))
    );

    if (matched.length === 0) {
      return res.status(404).json({ success: false, error: 'No order found matching "' + req.params.query + '". Please verify your Order ID or Phone.' });
    }

    // Return the latest matching order or all matches
    res.json({
      success: true,
      order: matched[0],
      totalMatched: matched.length,
      allOrders: matched
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Tracking service error' });
  }
});

// ==============================================================================
// SECURE ADMIN ORDER MANAGEMENT & DISPATCH TRACKING
// ==============================================================================
app.get('/api/admin/orders', verifyAdmin, async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    res.json({ success: true, total: orders.length, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to retrieve orders' });
  }
});

app.put('/api/admin/orders/:id/status', verifyAdmin, async (req, res) => {
  try {
    const orders = await db.getAllOrders();
    const existing = orders.find(o => o.id.toLowerCase() === req.params.id.toLowerCase());
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const { status, courierPartner, awb, note, paymentStatus } = req.body || {};
    const validStatuses = ['PLACED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
    const newStatus = status ? status.toUpperCase() : existing.status;

    if (!validStatuses.includes(newStatus)) {
      return res.status(400).json({ success: false, error: 'Invalid order status: ' + status });
    }

    const statusLabels = {
      'PLACED': 'Order Confirmed',
      'PROCESSING': 'Verified & Packed at Fulfillment Hub',
      'DISPATCHED': 'Handed over to Courier Partner',
      'IN_TRANSIT': 'In Transit (Out for Delivery)',
      'DELIVERED': 'Successfully Delivered to Customer',
      'CANCELLED': 'Order Cancelled'
    };

    const nowIso = new Date().toISOString();

    existing.status = newStatus;
    if (paymentStatus) existing.paymentStatus = paymentStatus;
    if (courierPartner) existing.courier.partner = courierPartner;
    if (awb) existing.courier.awb = awb;
    existing.updatedAt = nowIso;

    // Append to timeline
    existing.timeline = existing.timeline || [];
    existing.timeline.push({
      status: newStatus,
      label: statusLabels[newStatus] || newStatus,
      timestamp: nowIso,
      note: note ? note.trim() : `Order updated to ${newStatus} by Aura3D Operations.`
    });

    const result = await db.updateOrder(existing.id, existing);

    res.json({
      success: true,
      message: `Order ${existing.id} updated to ${newStatus}`,
      order: existing,
      database: result.provider
    });
  } catch (err) {
    console.error('Order status update error:', err);
    res.status(500).json({ success: false, error: 'Failed to update order status: ' + err.message });
  }
});

// Page route aliases for clean URLs
const PUBLIC_DIR = path.join(process.cwd(), 'public');
app.get('/catalog', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'catalog.html')));
app.get('/spares', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spares.html')));
app.get('/guides', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'guides.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/track', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'track.html')));
app.get('/account', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'account.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'account.html')));
app.get('/invoice', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'invoice.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Aura3D Labs Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
