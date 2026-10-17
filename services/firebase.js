/**
 * Aura3D Labs — Zero-Dependency Firebase Cloud Database Service
 * 
 * Supports both Google Cloud Firestore REST API and Firebase Realtime Database
 * with zero heavy npm dependencies (zero disk footprint, instant Vercel cold starts).
 * 
 * Graceful fallback: If Firebase environment variables are not configured,
 * it seamlessly reads and writes to local data/products.json so the application
 * remains 100% operational in any environment.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || process.env.GCP_PROJECT || '').trim();
const API_KEY = (process.env.FIREBASE_API_KEY || '').trim();
const DB_URL = (process.env.FIREBASE_DATABASE_URL || '').trim().replace(/\/$/, '');

// Data directory for local disk fallback
const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Checks if Firebase cloud integration is configured
 */
function isFirebaseConfigured() {
  return Boolean(PROJECT_ID || DB_URL);
}

function getProviderType() {
  if (DB_URL) return 'realtime-database';
  if (PROJECT_ID) return 'firestore';
  return 'local-json';
}

// -----------------------------------------------------------------------------
// FIRESTORE TYPE ENCODING & DECODING (Standard Google Firestore REST v1)
// -----------------------------------------------------------------------------
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue;
    fields[key] = toFirestoreValue(val);
  }
  return fields;
}

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: toFirestoreFields(val) } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const result = {};
  for (const [key, val] of Object.entries(doc.fields)) {
    result[key] = fromFirestoreValue(val);
  }
  // Extract document ID from name path if missing
  if (!result.id && doc.name) {
    result.id = doc.name.split('/').pop();
  }
  return result;
}

function fromFirestoreValue(val) {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return parseFloat(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const res = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = fromFirestoreValue(v);
    }
    return res;
  }
  return null;
}

// -----------------------------------------------------------------------------
// FIRESTORE REST API OPERATIONS
// -----------------------------------------------------------------------------
function getFirestoreBaseUrl() {
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products`;
  if (API_KEY) {
    url += `?key=${API_KEY}`;
  }
  return url;
}

async function fetchFromFirestore() {
  const url = getFirestoreBaseUrl();
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    throw new Error(`Firestore GET failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.documents || !Array.isArray(data.documents)) {
    return [];
  }
  return data.documents.map(fromFirestoreDoc).filter(Boolean);
}

async function writeToFirestore(product) {
  const id = encodeURIComponent(product.id);
  // Using PATCH with document path creates or replaces the document
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products/${id}`;
  if (API_KEY) url += `?key=${API_KEY}`;

  const body = { fields: toFirestoreFields(product) };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore save failed [${res.status}]: ${errText}`);
  }
  return product;
}

async function deleteFromFirestore(id) {
  const docId = encodeURIComponent(id);
  let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products/${docId}`;
  if (API_KEY) url += `?key=${API_KEY}`;

  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Firestore delete failed [${res.status}]: ${errText}`);
  }
  return true;
}

// -----------------------------------------------------------------------------
// REALTIME DATABASE REST API (Alternative zero-config option)
// -----------------------------------------------------------------------------
async function fetchFromRTDB() {
  const res = await fetch(`${DB_URL}/products.json`);
  if (!res.ok) throw new Error(`RTDB fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean);
  return Object.values(data);
}

async function writeToRTDB(product) {
  const res = await fetch(`${DB_URL}/products/${encodeURIComponent(product.id)}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(product)
  });
  if (!res.ok) throw new Error(`RTDB write failed: ${res.status}`);
  return product;
}

async function deleteFromRTDB(id) {
  const res = await fetch(`${DB_URL}/products/${encodeURIComponent(id)}.json`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`RTDB delete failed: ${res.status}`);
  return true;
}

// -----------------------------------------------------------------------------
// PUBLIC EXPORTED DATABASE ADAPTER METHODS
// -----------------------------------------------------------------------------
/**
 * Retrieve all products from Firebase or local JSON fallback
 */
async function getAllProducts() {
  if (PROJECT_ID) {
    try {
      const items = await fetchFromFirestore();
      if (items && items.length > 0) return items;
      console.log('ℹ️  Firestore returned empty. Falling back to local catalog.');
    } catch (err) {
      console.warn('⚠️  Could not read from Firestore, using local fallback:', err.message);
    }
  } else if (DB_URL) {
    try {
      const items = await fetchFromRTDB();
      if (items && items.length > 0) return items;
    } catch (err) {
      console.warn('⚠️  Could not read from Realtime DB, using local fallback:', err.message);
    }
  }

  // Local fallback
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading local products.json:', e);
    return [];
  }
}

/**
 * Save / Create a new product in Firebase & Local file
 */
async function createProduct(product) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      await writeToFirestore(product);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to save product to Firestore:', err.message);
    }
  } else if (DB_URL) {
    try {
      await writeToRTDB(product);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to save product to Realtime DB:', err.message);
    }
  }

  // Update local JSON if accessible (for local development persistence)
  try {
    const localProds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
    localProds.unshift(product);
    fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(localProds, null, 2), 'utf8');
  } catch (e) {
    // Expected on read-only serverless filesystems if cloud succeeded
    if (!cloudSuccess) throw e;
  }

  return { product, cloudSuccess, provider: getProviderType() };
}

/**
 * Update an existing product by ID
 */
async function updateProduct(id, updatedData) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      await writeToFirestore(updatedData);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to update product in Firestore:', err.message);
    }
  } else if (DB_URL) {
    try {
      await writeToRTDB(updatedData);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to update product in Realtime DB:', err.message);
    }
  }

  // Update local file
  try {
    const localProds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
    const idx = localProds.findIndex(p => p.id === id);
    if (idx !== -1) {
      localProds[idx] = updatedData;
      fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(localProds, null, 2), 'utf8');
    }
  } catch (e) {
    if (!cloudSuccess) throw e;
  }

  return { product: updatedData, cloudSuccess, provider: getProviderType() };
}

/**
 * Delete a product by ID
 */
async function deleteProduct(id) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      await deleteFromFirestore(id);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to delete product from Firestore:', err.message);
    }
  } else if (DB_URL) {
    try {
      await deleteFromRTDB(id);
      cloudSuccess = true;
    } catch (err) {
      console.error('⚠️  Failed to delete product from Realtime DB:', err.message);
    }
  }

  // Update local file
  try {
    const localProds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
    const filtered = localProds.filter(p => p.id !== id);
    fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(filtered, null, 2), 'utf8');
  } catch (e) {
    if (!cloudSuccess) throw e;
  }

  return { success: true, cloudSuccess, provider: getProviderType() };
}

/**
 * Seed all local products from data/products.json into Firebase cloud database
 */
async function seedCatalogToFirebase() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Please add FIREBASE_PROJECT_ID or FIREBASE_DATABASE_URL.');
  }

  const localProds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf8'));
  let seeded = 0;
  for (const product of localProds) {
    if (PROJECT_ID) {
      await writeToFirestore(product);
    } else if (DB_URL) {
      await writeToRTDB(product);
    }
    seeded++;
  }
  return { success: true, seededCount: seeded, provider: getProviderType() };
}

// -----------------------------------------------------------------------------
// CUSTOMER REVIEWS CLOUD & LOCAL STORAGE
// -----------------------------------------------------------------------------
async function getAllReviews() {
  if (PROJECT_ID) {
    try {
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/reviews`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.documents && Array.isArray(data.documents)) {
          const list = data.documents.map(fromFirestoreDoc).filter(Boolean);
          if (list.length > 0) return list;
        }
      }
    } catch (e) {
      console.warn('Could not read reviews from Firestore:', e.message);
    }
  }

  // Local fallback
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function createReview(review) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const id = encodeURIComponent(String(review.id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/reviews/${id}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(review) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to save review to Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8'));
    list.unshift(review);
    fs.writeFileSync(path.join(DATA_DIR, 'reviews.json'), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { review, cloudSuccess, provider: getProviderType() };
}

async function updateReview(id, updatedData) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const docId = encodeURIComponent(String(id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/reviews/${docId}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(updatedData) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to update review in Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8'));
    const idx = list.findIndex(r => String(r.id) === String(id));
    if (idx !== -1) {
      list[idx] = updatedData;
      fs.writeFileSync(path.join(DATA_DIR, 'reviews.json'), JSON.stringify(list, null, 2), 'utf8');
    }
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { review: updatedData, cloudSuccess, provider: getProviderType() };
}

async function deleteReview(id) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const docId = encodeURIComponent(String(id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/reviews/${docId}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok || res.status === 404) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to delete review in Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'reviews.json'), 'utf8'));
    const filtered = list.filter(r => String(r.id) !== String(id));
    fs.writeFileSync(path.join(DATA_DIR, 'reviews.json'), JSON.stringify(filtered, null, 2), 'utf8');
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { success: true, cloudSuccess, provider: getProviderType() };
}

// -----------------------------------------------------------------------------
// ORDERS CLOUD & LOCAL STORAGE
// -----------------------------------------------------------------------------
async function getAllOrders() {
  if (PROJECT_ID) {
    try {
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.documents && Array.isArray(data.documents)) {
          const list = data.documents.map(fromFirestoreDoc).filter(Boolean);
          if (list.length > 0) return list;
        }
      }
    } catch (e) {
      console.warn('Could not read orders from Firestore:', e.message);
    }
  }

  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function getOrderById(id) {
  const orders = await getAllOrders();
  return orders.find(o => String(o.id).toLowerCase() === String(id).toLowerCase().trim());
}

async function createOrder(order) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const id = encodeURIComponent(String(order.id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${id}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(order) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to save order to Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8'));
    list.unshift(order);
    fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { order, cloudSuccess, provider: getProviderType() };
}

async function updateOrder(id, updatedData) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const docId = encodeURIComponent(String(id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/orders/${docId}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(updatedData) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to update order in Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'orders.json'), 'utf8'));
    const idx = list.findIndex(o => String(o.id).toLowerCase() === String(id).toLowerCase());
    if (idx !== -1) {
      list[idx] = updatedData;
      fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(list, null, 2), 'utf8');
    }
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { order: updatedData, cloudSuccess, provider: getProviderType() };
}

// -----------------------------------------------------------------------------
// CUSTOMERS CLOUD & LOCAL STORAGE
// -----------------------------------------------------------------------------
async function getAllCustomers() {
  if (PROJECT_ID) {
    try {
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/customers`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.documents && Array.isArray(data.documents)) {
          const list = data.documents.map(fromFirestoreDoc).filter(Boolean);
          if (list.length > 0) return list;
        }
      }
    } catch (e) {
      console.warn('Could not read customers from Firestore:', e.message);
    }
  }

  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'customers.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function getCustomerByEmail(email) {
  const customers = await getAllCustomers();
  return customers.find(c => String(c.email).toLowerCase().trim() === String(email).toLowerCase().trim());
}

async function createCustomer(customer) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const id = encodeURIComponent(String(customer.id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/customers/${id}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(customer) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to save customer to Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'customers.json'), 'utf8'));
    list.push(customer);
    fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { customer, cloudSuccess, provider: getProviderType() };
}

async function updateCustomer(id, updatedData) {
  let cloudSuccess = false;
  if (PROJECT_ID) {
    try {
      const docId = encodeURIComponent(String(id));
      let url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/customers/${docId}`;
      if (API_KEY) url += `?key=${API_KEY}`;
      const body = { fields: toFirestoreFields(updatedData) };
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) cloudSuccess = true;
    } catch (e) {
      console.error('Failed to update customer in Firestore:', e.message);
    }
  }

  try {
    const list = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'customers.json'), 'utf8'));
    const idx = list.findIndex(c => String(c.id) === String(id));
    if (idx !== -1) {
      list[idx] = updatedData;
      fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(list, null, 2), 'utf8');
    }
  } catch (e) {
    if (!cloudSuccess) throw e;
  }
  return { customer: updatedData, cloudSuccess, provider: getProviderType() };
}

module.exports = {
  isFirebaseConfigured,
  getProviderType,
  getAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  seedCatalogToFirebase,
  getAllReviews,
  createReview,
  updateReview,
  deleteReview,
  getAllOrders,
  getOrderById,
  createOrder,
  updateOrder,
  getAllCustomers,
  getCustomerByEmail,
  createCustomer,
  updateCustomer
};
