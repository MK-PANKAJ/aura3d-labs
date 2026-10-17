/* ==========================================================================
   Aura3D Labs - Interactive Client Logic & E-Commerce Cart Engine
   ========================================================================== */

let allProducts = [];
let activeCategory = 'all';
let cart = JSON.parse(localStorage.getItem('aura3d_cart')) || [];

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initCart();
  initEventListeners();
});

async function initApp() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    allProducts = data.products || [];
    renderProducts(allProducts);
    updateCartBadge();
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

// Render Products Grid
function renderProducts(items) {
  const container = document.getElementById('productsContainer');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <h3 style="font-family: var(--font-display); font-size: 1.4rem; margin-bottom: 8px;">No matching specifications found</h3>
        <p style="color: var(--color-muted);">Try adjusting your category filter or search keywords.</p>
        <button onclick="resetFilters()" class="btn-magnetic" style="margin-top: 20px; display: inline-flex;"><span class="btn-dot"></span> View All Products</button>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(product => `
    <article class="product-card" data-id="${product.id}">
      <div class="product-image-wrap">
        <img src="${product.image}" alt="${product.name}" loading="lazy">
        ${product.badge ? `<span class="badge-tag">${product.badge}</span>` : ''}
        ${product.discount ? `<span class="badge-discount">${product.discount}</span>` : ''}
      </div>
      <div class="product-details">
        <span class="product-brand">${product.brand} • ${product.type}</span>
        <h3 class="product-name" title="${product.name}">${product.name}</h3>
        <div class="product-rating">
          ★ ${product.rating.toFixed(1)} <span>(${product.reviewsCount} reviews)</span>
        </div>
        <div class="product-price-row">
          <span class="product-price">₹${product.price.toLocaleString('en-IN')}</span>
          ${product.originalPrice ? `<span class="product-price-orig">₹${product.originalPrice.toLocaleString('en-IN')}</span>` : ''}
        </div>
        <div class="product-actions">
          <button class="btn-add-cart" onclick="addToCart('${product.id}')" aria-label="Add ${product.name} to bag">
            Add to Bag
          </button>
          <button class="btn-quick-view" onclick="openQuickView('${product.id}')" aria-label="Quick view details for ${product.name}">
            Specs
          </button>
        </div>
      </div>
    </article>
  `).join('');
}

// Category and Filter Handling
function filterCategory(cat, element) {
  activeCategory = cat;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (element) element.classList.add('active');

  applyFilters();
}

function handleSort(sortVal) {
  applyFilters(sortVal);
}

function applyFilters(sortOverride) {
  let filtered = [...allProducts];

  if (activeCategory !== 'all') {
    filtered = filtered.filter(p => p.category === activeCategory);
  }

  const searchInput = document.getElementById('catalogSearch');
  if (searchInput && searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.type.toLowerCase().includes(q)
    );
  }

  const sortSelect = document.getElementById('catalogSort');
  const sortVal = sortOverride || (sortSelect ? sortSelect.value : 'default');

  if (sortVal === 'price-low') {
    filtered.sort((a, b) => a.price - b.price);
  } else if (sortVal === 'price-high') {
    filtered.sort((a, b) => b.price - a.price);
  } else if (sortVal === 'rating') {
    filtered.sort((a, b) => b.rating - a.rating);
  }

  renderProducts(filtered);
}

function resetFilters() {
  activeCategory = 'all';
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === 'all');
  });
  const searchInput = document.getElementById('catalogSearch');
  if (searchInput) searchInput.value = '';
  applyFilters();
}

// Quick View Modal
function openQuickView(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const modal = document.getElementById('quickViewModal');
  const body = document.getElementById('quickViewBody');

  const specsRows = Object.entries(product.specs || {}).map(([key, val]) => `
    <tr>
      <td>${key}</td>
      <td>${val}</td>
    </tr>
  `).join('');

  body.innerHTML = `
    <div class="modal-content-grid">
      <div class="modal-img-wrap">
        <img src="${product.image}" alt="${product.name}">
      </div>
      <div>
        <span class="product-brand">${product.brand} • ${product.type}</span>
        <h2 style="font-family: var(--font-heading); font-size: 1.4rem; margin: 6px 0 12px; line-height: 1.3;">${product.name}</h2>
        <div class="product-rating" style="margin-bottom: 12px;">
          ★ ${product.rating.toFixed(1)} (${product.reviewsCount} verified customer reviews)
        </div>
        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">${product.description}</p>
        
        <table class="modal-specs-table">
          <tbody>
            ${specsRows}
          </tbody>
        </table>

        <div class="product-price-row" style="margin: 20px 0;">
          <span class="product-price" style="font-size: 1.6rem;">₹${product.price.toLocaleString('en-IN')}</span>
          ${product.originalPrice ? `<span class="product-price-orig">₹${product.originalPrice.toLocaleString('en-IN')}</span>` : ''}
          ${product.discount ? `<span class="badge-discount" style="position: static;">${product.discount}</span>` : ''}
        </div>

        <div style="display: flex; gap: 14px; margin-top: 24px;">
          <button class="btn-magnetic" style="flex: 1; justify-content: center;" onclick="addToCart('${product.id}'); closeModal();">
            <span class="btn-dot"></span> Add to Bag
          </button>
          <a class="btn-secondary-architectural" style="padding: 14px 20px;" href="https://wa.me/919599523434?text=Hi%2C%20I%20am%20interested%20in%20${encodeURIComponent(product.name)}" target="_blank" rel="noopener">
            WhatsApp Desk
          </a>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('open');
}

function closeModal() {
  const modal = document.getElementById('quickViewModal');
  if (modal) modal.classList.remove('open');
}

// Cart Management
function initCart() {
  updateCartBadge();
  renderCartDrawer();
}

function addToCart(productId) {
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const existing = cart.find(item => item.id === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      qty: 1
    });
  }

  saveCart();
  updateCartBadge();
  renderCartDrawer();
  showToast(`Added ${product.name.slice(0, 24)}... to cart!`);
  openCartDrawer();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.id === productId);
  if (!item) return;

  item.qty += delta;
  if (item.qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }

  saveCart();
  updateCartBadge();
  renderCartDrawer();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.id !== productId);
  saveCart();
  updateCartBadge();
  renderCartDrawer();
  showToast('Item removed from cart');
}

function saveCart() {
  localStorage.setItem('aura3d_cart', JSON.stringify(cart));
}

function updateCartBadge() {
  const totalCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const badges = document.querySelectorAll('.cart-count-badge');
  badges.forEach(b => {
    b.textContent = totalCount;
    b.style.display = totalCount > 0 ? 'flex' : 'none';
  });
}

function renderCartDrawer() {
  const container = document.getElementById('cartItemsList');
  const subtotalEl = document.getElementById('cartSubtotal');
  const gstEl = document.getElementById('cartGst');
  const totalEl = document.getElementById('cartTotal');
  const meterFill = document.getElementById('meterFill');
  const meterText = document.getElementById('meterText');

  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted);">
        <p style="font-size: 1.1rem; margin-bottom: 8px;">Your cart is empty</p>
        <p style="font-size: 0.85rem;">Discover our 3D printers, filaments, and OEM spares.</p>
      </div>
    `;
    if (subtotalEl) subtotalEl.textContent = '₹0';
    if (gstEl) gstEl.textContent = '₹0';
    if (totalEl) totalEl.textContent = '₹0';
    if (meterFill) meterFill.style.width = '0%';
    if (meterText) meterText.textContent = 'Add items worth ₹1,499 for FREE Pan-India shipping';
    return;
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const gst = Math.round(subtotal * 0.18);
  const total = subtotal + gst;

  // Free shipping threshold: ₹1499
  const threshold = 1499;
  const progress = Math.min(100, Math.round((subtotal / threshold) * 100));

  if (meterFill) meterFill.style.width = `${progress}%`;
  if (meterText) {
    if (subtotal >= threshold) {
      meterText.innerHTML = '🎉 You unlocked <strong>FREE Pan-India Express Shipping!</strong>';
    } else {
      meterText.innerHTML = `Add <strong>₹${(threshold - subtotal).toLocaleString('en-IN')}</strong> more for FREE Pan-India Shipping`;
    }
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <img src="${item.image}" alt="${item.name}">
      <div class="cart-item-info">
        <h4 class="cart-item-title">${item.name}</h4>
        <div class="cart-item-price">₹${(item.price * item.qty).toLocaleString('en-IN')}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="updateQty('${item.id}', -1)" aria-label="Decrease quantity">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" onclick="updateQty('${item.id}', 1)" aria-label="Increase quantity">+</button>
          <button class="btn-remove-item" onclick="removeFromCart('${item.id}')">Remove</button>
        </div>
      </div>
    </div>
  `).join('');

  if (subtotalEl) subtotalEl.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  if (gstEl) gstEl.textContent = `₹${gst.toLocaleString('en-IN')}`;
  if (totalEl) totalEl.textContent = `₹${total.toLocaleString('en-IN')}`;
}

function openCartDrawer() {
  const drawer = document.getElementById('cartBackdrop');
  if (drawer) drawer.classList.add('open');
}

function closeCartDrawer() {
  const drawer = document.getElementById('cartBackdrop');
  if (drawer) drawer.classList.remove('open');
}

function checkout() {
  if (cart.length === 0) {
    showToast('Your cart is empty!');
    return;
  }
  const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  alert(`Proceeding to Secure Checkout (GST Compliant)\nSubtotal: ₹${total.toLocaleString('en-IN')}\n\nOur payment gateway & WhatsApp order confirmation will initiate.`);
}

// Toast Alert
function showToast(message) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

// Event Listeners
function initEventListeners() {
  const searchInput = document.getElementById('catalogSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => applyFilters());
  }

  // Close modals and mobile nav on Esc key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeCartDrawer();
      closeMobileNav();
    }
  });
}

// Mobile Navigation Drawer Helpers
function toggleMobileNav() {
  const panel = document.getElementById('mobileNavBackdrop');
  if (panel) {
    panel.classList.toggle('open');
    document.body.style.overflow = panel.classList.contains('open') ? 'hidden' : '';
  }
}

function closeMobileNav() {
  const panel = document.getElementById('mobileNavBackdrop');
  if (panel) {
    panel.classList.remove('open');
    document.body.style.overflow = '';
  }
}
