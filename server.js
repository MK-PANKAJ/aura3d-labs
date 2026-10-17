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

// Load Datasets Helper
const DATA_DIR = path.join(process.cwd(), 'data');
function getProducts() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
}
function saveProducts(products) {
  try {
    fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to write products.json to disk:', err);
    return false;
  }
}
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
app.get('/api/products', (req, res) => {
  let filtered = getProducts();
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
});

app.get('/api/products/:id', (req, res) => {
  const item = getProducts().find(p => p.id === req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json(item);
});

app.get('/api/categories', (req, res) => {
  const prods = getProducts();
  const categories = [
    { id: 'all', name: 'All Products', count: prods.length },
    { id: 'printers', name: '3D Printers', count: prods.filter(p => p.category === 'printers').length },
    { id: 'filaments', name: 'Filaments', count: prods.filter(p => p.category === 'filaments').length },
    { id: 'resins', name: 'UV Resins', count: prods.filter(p => p.category === 'resins').length },
    { id: 'spares', name: 'Spares & Upgrades', count: prods.filter(p => p.category === 'spares').length },
    { id: 'pens', name: '3D Pens & Art', count: prods.filter(p => p.category === 'pens').length }
  ];
  res.json(categories);
});

app.get('/api/reviews', (req, res) => {
  res.json(getReviews());
});

app.get('/api/guides', (req, res) => {
  res.json(getGuides());
});

app.get('/api/faqs', (req, res) => {
  res.json(getFaqs());
});

// Dynamic SEO Sitemap
app.get('/sitemap.xml', (req, res) => {
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

  getProducts().forEach(p => {
    xml += `  <url>
    <loc>${host}/catalog.html?product=${p.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
  });

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
app.post('/api/admin/products', verifyAdmin, (req, res) => {
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
    const products = getProducts();
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
      rating: 5.0,
      reviewsCount: 1,
      inStock: inStock !== false,
      featured: Boolean(featured),
      badge: badge ? badge.trim() : null,
      image: image.trim(),
      specs: (specs && typeof specs === 'object') ? specs : {},
      description: description ? description.trim() : `High-precision authentic ${name} engineered for consistent additive manufacturing performance.`
    };

    products.unshift(newProduct);
    saveProducts(products);

    res.status(201).json({
      success: true,
      message: 'Product successfully added to catalog',
      product: newProduct
    });
  } catch (err) {
    console.error('Error adding product:', err);
    res.status(500).json({ success: false, error: 'Failed to persist product.' });
  }
});

// Update Existing Product
app.put('/api/admin/products/:id', verifyAdmin, (req, res) => {
  try {
    const products = getProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Product not found in registry.' });
    }

    const existing = products[index];
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

    const updatedProduct = {
      ...existing,
      name: name.trim(),
      brand: brand.trim(),
      category: category.toLowerCase().trim(),
      type: type ? type.trim() : existing.type,
      price: numPrice,
      originalPrice: numOrig || null,
      discount: discount || null,
      inStock: inStock !== false,
      featured: Boolean(featured),
      badge: badge ? badge.trim() : null,
      image: image.trim(),
      specs: (specs && typeof specs === 'object') ? specs : existing.specs || {},
      description: description ? description.trim() : existing.description
    };

    products[index] = updatedProduct;
    saveProducts(products);

    res.json({
      success: true,
      message: `Product "${updatedProduct.name}" updated successfully`,
      product: updatedProduct
    });
  } catch (err) {
    console.error('Error updating product:', err);
    res.status(500).json({ success: false, error: 'Failed to update product.' });
  }
});

app.delete('/api/admin/products/:id', verifyAdmin, (req, res) => {
  try {
    const products = getProducts();
    const index = products.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const [removed] = products.splice(index, 1);
    saveProducts(products);

    res.json({
      success: true,
      message: `Product "${removed.name}" deleted successfully`,
      deletedId: req.params.id
    });
  } catch (err) {
    console.error('Error deleting product:', err);
    res.status(500).json({ success: false, error: 'Failed to delete product.' });
  }
});

// Page route aliases for clean URLs
const PUBLIC_DIR = path.join(process.cwd(), 'public');
app.get('/catalog', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'catalog.html')));
app.get('/spares', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'spares.html')));
app.get('/guides', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'guides.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Aura3D Labs Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
