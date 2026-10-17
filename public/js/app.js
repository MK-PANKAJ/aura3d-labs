/* ==========================================================================
   Aura3D Labs - Interactive Client Logic & E-Commerce Cart Engine
   ========================================================================== */

let allProducts = [];
let activeCategory = 'all';
let cart = JSON.parse(localStorage.getItem('aura3d_cart')) || [];

let currentCustomer = null;
let lastPlacedOrderId = null;

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initCart();
  initEventListeners();
  checkCustomerSession();

  const hash = window.location.hash;
  if (hash === '#track') {
    openTrackModal();
  } else if (hash === '#account') {
    openCustomerModal();
  }
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
// Quick View Modal & Reviews System
async function openQuickView(productId) {
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

  const safeName = product.name.replace(/'/g, "\\'");

  body.innerHTML = `
    <div class="modal-content-grid">
      <div class="modal-img-wrap">
        <img src="${product.image}" alt="${product.name}">
      </div>
      <div>
        <span class="product-brand">${product.brand} • ${product.type}</span>
        <h2 style="font-family: var(--font-heading); font-size: 1.4rem; margin: 6px 0 10px; line-height: 1.3;">${product.name}</h2>
        
        <div class="product-rating" style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span>★ ${Number(product.rating || 5.0).toFixed(1)} <strong style="font-weight: 400; color: var(--color-muted);">(${product.reviewsCount || 1} verified customer reviews)</strong></span>
          <button onclick="openReviewModal('${product.id}', '${safeName}')" class="btn-nav-action" style="font-size: 0.72rem; padding: 4px 10px; color: var(--color-champagne); border-color: rgba(212,175,55,0.3); background: rgba(212,175,55,0.06); cursor: pointer;">
            ★ Write a Review
          </button>
        </div>

        <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 16px;">${product.description}</p>
        
        <table class="modal-specs-table">
          <tbody>
            ${specsRows}
          </tbody>
        </table>

        <div class="product-price-row" style="margin: 20px 0 16px;">
          <span class="product-price" style="font-size: 1.6rem;">₹${product.price.toLocaleString('en-IN')}</span>
          ${product.originalPrice ? `<span class="product-price-orig">₹${product.originalPrice.toLocaleString('en-IN')}</span>` : ''}
          ${product.discount ? `<span class="badge-discount" style="position: static;">${product.discount}</span>` : ''}
        </div>

        <div style="display: flex; gap: 14px; margin-top: 16px; margin-bottom: 24px;">
          <button class="btn-magnetic" style="flex: 1; justify-content: center;" onclick="addToCart('${product.id}'); closeModal();">
            <span class="btn-dot"></span> Add to Bag
          </button>
          <a class="btn-secondary-architectural" style="padding: 14px 20px;" href="https://wa.me/919599523434?text=Hi%2C%20I%20am%20interested%20in%20${encodeURIComponent(product.name)}" target="_blank" rel="noopener">
            WhatsApp Desk
          </a>
        </div>

        <!-- Verified Customer Reviews Section -->
        <div style="border-top: 1px solid var(--border-hairline); padding-top: 18px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-family: var(--font-mono); font-size: 0.725rem; color: var(--color-champagne); letter-spacing: 0.08em; text-transform: uppercase;">
              Verified Customer Monographs
            </span>
            <button onclick="openReviewModal('${product.id}', '${safeName}')" style="background: none; border: none; color: var(--color-muted); font-size: 0.725rem; cursor: pointer; text-decoration: underline;">
              + Review after buying
            </button>
          </div>
          <div id="quickViewReviewsList" style="max-height: 200px; overflow-y: auto;">
            <div style="font-size: 0.8rem; color: var(--color-dim); padding: 8px 0;">Retrieving customer reviews...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('open');
  loadProductReviews(product.id);
}

// Fetch and render verified reviews for a product in Quick View
async function loadProductReviews(productId) {
  const container = document.getElementById('quickViewReviewsList');
  if (!container) return;

  try {
    const res = await fetch(`/api/products/${productId}/reviews`);
    if (!res.ok) throw new Error('Failed to load reviews');
    const reviews = await res.json();

    if (!reviews || reviews.length === 0) {
      container.innerHTML = `
        <div style="padding: 12px; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-hairline); border-radius: 4px; text-align: center;">
          <p style="font-size: 0.8rem; color: var(--color-muted); margin: 0 0 6px;">No customer reviews submitted yet.</p>
          <button onclick="openReviewModal('${productId}', '')" style="background: none; border: none; color: var(--color-champagne); font-family: var(--font-mono); font-size: 0.725rem; cursor: pointer; text-decoration: underline;">
            Be the first verified buyer to share feedback ★
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = reviews.map(r => `
      <div class="product-review-card">
        <div class="review-header">
          <div class="review-user-wrap">
            <span class="review-avatar">${r.avatar || 'VB'}</span>
            <div>
              <strong style="font-size: 0.825rem; color: #fff; display: block;">${r.name}</strong>
              <span class="review-verified-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                ${r.role || 'Verified Buyer'}
              </span>
            </div>
          </div>
          <span style="color: var(--color-champagne); font-size: 0.85rem; letter-spacing: 2px;">
            ${'★'.repeat(r.rating || 5)}
          </span>
        </div>
        <p style="font-size: 0.825rem; color: var(--color-titanium); line-height: 1.5; margin: 6px 0 0;">
          ${r.review}
        </p>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = `<div style="font-size: 0.8rem; color: var(--color-dim);">Reviews available via verified customer registry.</div>`;
  }
}

// Review Modal Handling
function openReviewModal(productId, productName = '') {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;
  const prodIdInput = document.getElementById('reviewProductId');
  const titleEl = document.getElementById('reviewModalTitle');
  if (prodIdInput) prodIdInput.value = productId;
  if (titleEl && productName) {
    titleEl.textContent = `Review: ${productName}`;
  } else if (titleEl) {
    titleEl.textContent = 'Submit Verified Customer Review';
  }
  setReviewRating(5);
  modal.classList.add('open');
}

function closeReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.remove('open');
}

function setReviewRating(rating) {
  const input = document.getElementById('reviewRatingInput');
  if (input) input.value = rating;
  const stars = document.querySelectorAll('#starPicker .star-btn');
  stars.forEach((s, idx) => {
    s.classList.toggle('active', idx < rating);
  });
}

async function submitCustomerReview(e) {
  e.preventDefault();
  const productId = document.getElementById('reviewProductId').value;
  const name = document.getElementById('reviewCustomerName').value.trim();
  const orderRef = document.getElementById('reviewOrderRef').value.trim();
  const review = document.getElementById('reviewComment').value.trim();
  const rating = Number(document.getElementById('reviewRatingInput').value) || 5;
  const btn = document.getElementById('submitReviewBtn');

  if (!productId || !name || !review) {
    showToast('Please enter your name and review monograph.');
    return;
  }

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'Submitting Monograph...';
    }

    const res = await fetch(`/api/products/${productId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, orderRef, review, rating })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to submit review');
    }

    closeReviewModal();
    document.getElementById('customerReviewForm').reset();
    showToast('★ Review submitted! Forwarded to administrators for verification.');
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-dot"></span> Submit Verified Review';
    }
  }
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

/* ==========================================================================
   Full E-Commerce Checkout System
   ========================================================================== */
let selectedPaymentMethod = 'Prepaid UPI / Card';

function checkout() {
  if (cart.length === 0) {
    showToast('Your bag is empty. Discover our 3D systems first!');
    return;
  }
  closeCartDrawer();
  openCheckoutModal();
}

function openCheckoutModal() {
  const modal = document.getElementById('checkoutModal');
  if (!modal) return;

  const formView = document.getElementById('checkoutFormView');
  const successView = document.getElementById('checkoutSuccessView');
  if (formView) formView.style.display = 'block';
  if (successView) successView.style.display = 'none';

  // Render checkout items
  const itemsContainer = document.getElementById('checkoutItemsList');
  if (itemsContainer) {
    itemsContainer.innerHTML = cart.map(item => `
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
        <img src="${item.image}" alt="${item.name}" style="width: 44px; height: 44px; object-fit: cover; border-radius: 3px;">
        <div style="flex: 1; min-width: 0;">
          <strong style="color: #fff; font-size: 0.8rem; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</strong>
          <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-muted);">Qty: ${item.qty} &times; ₹${item.price.toLocaleString('en-IN')}</span>
        </div>
        <strong style="font-family: var(--font-mono); font-size: 0.825rem; color: #fff;">₹${(item.price * item.qty).toLocaleString('en-IN')}</strong>
      </div>
    `).join('');
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const gst = Math.round(subtotal * 0.18);
  const shipping = subtotal >= 1499 ? 0 : 149;
  const grandTotal = subtotal + gst + shipping;

  const chkSubtotal = document.getElementById('chkSubtotal');
  const chkGst = document.getElementById('chkGst');
  const chkShipping = document.getElementById('chkShipping');
  const chkTotal = document.getElementById('chkTotal');

  if (chkSubtotal) chkSubtotal.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  if (chkGst) chkGst.textContent = `₹${gst.toLocaleString('en-IN')}`;
  if (chkShipping) chkShipping.textContent = shipping === 0 ? 'FREE' : `₹${shipping}`;
  if (chkTotal) chkTotal.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;

  // Auto-fill logged in customer
  const welcomeBanner = document.getElementById('checkoutUserWelcome');
  const welcomeName = document.getElementById('checkoutLoggedInName');
  if (currentCustomer) {
    if (welcomeBanner) welcomeBanner.style.display = 'block';
    if (welcomeName) welcomeName.textContent = currentCustomer.name;
    const nameInput = document.getElementById('chkName');
    const phoneInput = document.getElementById('chkPhone');
    const emailInput = document.getElementById('chkEmail');
    const addrInput = document.getElementById('chkAddress');
    const cityInput = document.getElementById('chkCity');
    const stateInput = document.getElementById('chkState');
    const pinInput = document.getElementById('chkPincode');

    if (nameInput && !nameInput.value) nameInput.value = currentCustomer.name || '';
    if (phoneInput && !phoneInput.value) phoneInput.value = currentCustomer.phone || '';
    if (emailInput && !emailInput.value) emailInput.value = currentCustomer.email || '';
    if (addrInput && !addrInput.value) addrInput.value = currentCustomer.address || '';
    if (cityInput && !cityInput.value) cityInput.value = currentCustomer.city || '';
    if (stateInput && !stateInput.value) stateInput.value = currentCustomer.state || 'Karnataka';
    if (pinInput && !pinInput.value) pinInput.value = currentCustomer.pincode || '';
  } else {
    if (welcomeBanner) welcomeBanner.style.display = 'none';
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCheckoutModal() {
  const modal = document.getElementById('checkoutModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function selectPaymentMethod(type) {
  const upiCard = document.getElementById('optUpi');
  const codCard = document.getElementById('optCod');
  if (type === 'upi') {
    selectedPaymentMethod = 'Prepaid UPI / Card';
    if (upiCard) upiCard.classList.add('selected');
    if (codCard) codCard.classList.remove('selected');
  } else {
    selectedPaymentMethod = 'Cash on Delivery';
    if (codCard) codCard.classList.add('selected');
    if (upiCard) upiCard.classList.remove('selected');
  }
}

async function handlePlaceOrder(e) {
  e.preventDefault();
  const btn = document.getElementById('btnPlaceOrder');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-dot"></span> Transmitting Encrypted Order...';
  }

  const orderPayload = {
    customer: {
      name: document.getElementById('chkName').value.trim(),
      phone: document.getElementById('chkPhone').value.trim(),
      email: document.getElementById('chkEmail').value.trim(),
      address: document.getElementById('chkAddress').value.trim(),
      city: document.getElementById('chkCity').value.trim(),
      state: document.getElementById('chkState').value.trim(),
      pincode: document.getElementById('chkPincode').value.trim(),
      gstin: (document.getElementById('chkGstin').value || '').trim()
    },
    items: cart,
    paymentMethod: selectedPaymentMethod,
    notes: 'Order placed via storefront web checkout.'
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    const data = await res.json();
    if (data.success && data.order) {
      lastPlacedOrderId = data.order.id;

      // Clear cart
      cart = [];
      saveCart();
      updateCartBadge();
      renderCartDrawer();

      // Switch to success view
      document.getElementById('checkoutFormView').style.display = 'none';
      const successView = document.getElementById('checkoutSuccessView');
      successView.style.display = 'block';
      document.getElementById('successOrderId').textContent = data.order.id;

      showToast(`Order ${data.order.id} placed successfully!`);
    } else {
      alert('Checkout error: ' + (data.error || 'Failed to register order'));
    }
  } catch (err) {
    alert('Failed to connect to checkout service. Please check your network.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-dot"></span> Confirm &amp; Place Order &rarr;';
    }
  }
}

function trackPlacedOrder() {
  closeCheckoutModal();
  if (lastPlacedOrderId) {
    openTrackModal(lastPlacedOrderId);
  } else {
    openTrackModal();
  }
}

/* ==========================================================================
   Live Order Tracking & Stepper Engine
   ========================================================================== */
function openTrackModal(orderId) {
  const modal = document.getElementById('trackOrderModal');
  if (modal) modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (orderId) {
    const input = document.getElementById('trackInputQuery');
    if (input) input.value = orderId;
    fetchOrderTracking(orderId);
  }
}

function closeTrackModal() {
  const modal = document.getElementById('trackOrderModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function handleTrackSearch(e) {
  e.preventDefault();
  const query = document.getElementById('trackInputQuery').value.trim();
  if (!query) return;
  fetchOrderTracking(query);
}

async function fetchOrderTracking(query) {
  const container = document.getElementById('trackingResultContainer');
  const btn = document.getElementById('btnTrackSearch');
  if (btn) btn.innerHTML = '<span class="btn-dot"></span> Searching...';
  if (container) {
    container.style.display = 'block';
    container.innerHTML = '<div style="text-align: center; padding: 30px; font-family: var(--font-mono); color: var(--color-muted);">Querying live logistics database...</div>';
  }

  try {
    const res = await fetch(`/api/orders/track/${encodeURIComponent(query)}`);
    const data = await res.json();

    if (!data.success || !data.order) {
      container.innerHTML = `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 4px; padding: 20px; text-align: center; color: #f87171;">
          <h4 style="margin: 0 0 6px; font-size: 1rem; color: #fff;">Consignment Not Located</h4>
          <p style="font-size: 0.825rem; margin: 0;">${data.error || 'No shipment found matching the provided reference number.'}</p>
        </div>
      `;
      return;
    }

    renderTrackingDetails(data.order);
  } catch (err) {
    container.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 4px; padding: 20px; text-align: center; color: #f87171;">
        <p style="font-size: 0.825rem; margin: 0;">Error communicating with tracking servers.</p>
      </div>
    `;
  } finally {
    if (btn) btn.innerHTML = '<span class="btn-dot"></span> Track &rarr;';
  }
}

function renderTrackingDetails(order) {
  const container = document.getElementById('trackingResultContainer');
  if (!container) return;

  const statuses = ['PLACED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'];
  const curIdx = statuses.indexOf((order.status || 'PLACED').toUpperCase());
  const progressPct = curIdx >= 0 ? (curIdx / (statuses.length - 1)) * 100 : 0;

  const statusClassMap = {
    'PLACED': 'status-placed',
    'PROCESSING': 'status-processing',
    'DISPATCHED': 'status-dispatched',
    'IN_TRANSIT': 'status-in_transit',
    'DELIVERED': 'status-delivered',
    'CANCELLED': 'status-cancelled'
  };

  const statusClass = statusClassMap[order.status] || 'status-placed';

  // Date format
  const dateFormatted = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }) : 'Recorded';

  container.innerHTML = `
    <!-- Order Header Info Card -->
    <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-hairline); border-radius: 4px; padding: 18px; margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
        <div>
          <span style="font-family: var(--font-mono); font-size: 0.68rem; color: var(--color-champagne); letter-spacing: 0.08em; display: block;">ORDER CONSIGNMENT</span>
          <strong style="font-family: var(--font-mono); font-size: 1.25rem; color: #fff;">${order.id}</strong>
          <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--color-muted); display: block; margin-top: 2px;">
            Booked: ${dateFormatted}
          </span>
        </div>
        <div>
          <span class="status-pill ${statusClass}">
            ● ${order.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <!-- Stepper Visual -->
      <div class="order-stepper">
        <div class="stepper-progress-bar" style="width: calc(${progressPct}% - 40px);"></div>
        
        <div class="step-node ${curIdx >= 0 ? (curIdx === 0 ? 'active' : 'completed') : ''}">
          <div class="step-circle">${curIdx > 0 ? '✓' : '1'}</div>
          <span class="step-label">Placed</span>
        </div>

        <div class="step-node ${curIdx >= 1 ? (curIdx === 1 ? 'active' : 'completed') : ''}">
          <div class="step-circle">${curIdx > 1 ? '✓' : '2'}</div>
          <span class="step-label">Packed</span>
        </div>

        <div class="step-node ${curIdx >= 2 ? (curIdx === 2 ? 'active' : 'completed') : ''}">
          <div class="step-circle">${curIdx > 2 ? '✓' : '3'}</div>
          <span class="step-label">Dispatched</span>
        </div>

        <div class="step-node ${curIdx >= 3 ? (curIdx === 3 ? 'active' : 'completed') : ''}">
          <div class="step-circle">${curIdx > 3 ? '✓' : '4'}</div>
          <span class="step-label">In Transit</span>
        </div>

        <div class="step-node ${curIdx >= 4 ? 'completed' : ''}">
          <div class="step-circle">${curIdx >= 4 ? '✓' : '5'}</div>
          <span class="step-label">Delivered</span>
        </div>
      </div>

      <!-- Courier Logistics Metadata -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--border-hairline); font-size: 0.8rem;">
        <div>
          <span style="color: var(--color-muted); font-size: 0.7rem; font-family: var(--font-mono); display: block;">COURIER AIR PARTNER</span>
          <strong style="color: #fff;">${order.courier ? order.courier.partner : 'BlueDart Express'}</strong>
        </div>
        <div>
          <span style="color: var(--color-muted); font-size: 0.7rem; font-family: var(--font-mono); display: block;">AIR WAYBILL / AWB</span>
          <strong style="color: var(--color-champagne); font-family: var(--font-mono);">${order.courier && order.courier.awb ? order.courier.awb : 'ALLOCATION IN QUEUE'}</strong>
        </div>
        <div>
          <span style="color: var(--color-muted); font-size: 0.7rem; font-family: var(--font-mono); display: block;">DESTINATION HUB</span>
          <strong style="color: #fff;">${order.customer ? `${order.customer.city}, ${order.customer.pincode}` : 'Pan-India'}</strong>
        </div>
      </div>
    </div>

    <!-- Items In Consignment -->
    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-hairline); border-radius: 4px; padding: 14px 18px; margin-bottom: 20px;">
      <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px; display: block;">CONSIGNMENT MANIFEST</span>
      <div>
        ${(order.items || []).map(item => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); font-size: 0.825rem;">
            <span style="color: #fff;">${item.name} &times; ${item.qty}</span>
            <span style="color: var(--color-titanium); font-family: var(--font-mono);">₹${(item.price * item.qty).toLocaleString('en-IN')}</span>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 0.875rem; font-weight: 700;">
        <span style="color: var(--color-muted);">Consignment Invoice Total:</span>
        <span style="color: var(--color-champagne); font-family: var(--font-mono);">₹${(order.total || 0).toLocaleString('en-IN')} (18% GST Incl.)</span>
      </div>
    </div>

    <!-- Timeline Activity Log -->
    <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-hairline); border-radius: 4px; padding: 18px;">
      <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-champagne); letter-spacing: 0.08em; text-transform: uppercase; display: block; margin-bottom: 6px;">
        DISPATCH TIMELINE &amp; AUDIT LOG
      </span>

      <div class="timeline-list">
        ${(order.timeline || []).slice().reverse().map(event => {
          const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          }) : 'Logged';
          return `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div class="timeline-label">${event.label || event.status}</div>
              <div class="timeline-meta">${timeStr} &bull; Verified Gateway Event</div>
              ${event.note ? `<div class="timeline-note">${event.note}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/* ==========================================================================
   Customer Portal & Account Session Management
   ========================================================================== */
async function checkCustomerSession() {
  const token = localStorage.getItem('aura3d_customer_token');
  if (!token) return;

  try {
    const res = await fetch('/api/customer/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      localStorage.removeItem('aura3d_customer_token');
      return;
    }
    const data = await res.json();
    if (data.success && data.customer) {
      currentCustomer = data.customer;
      updateCustomerNavBadge();
    }
  } catch (err) {
    // network failure
  }
}

function updateCustomerNavBadge() {
  const label = document.getElementById('navAccountLabel');
  if (label && currentCustomer) {
    const firstName = currentCustomer.name.split(' ')[0] || 'Client';
    label.textContent = firstName;
  } else if (label) {
    label.textContent = 'Account';
  }
}

function openCustomerModal() {
  const modal = document.getElementById('customerModal');
  if (!modal) return;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (currentCustomer) {
    renderCustomerDashboard();
  } else {
    document.getElementById('customerAuthView').style.display = 'block';
    document.getElementById('customerDashboardView').style.display = 'none';
  }
}

function closeCustomerModal() {
  const modal = document.getElementById('customerModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}

function switchCustomerAuthTab(tab) {
  const btnLogin = document.getElementById('tabCustomerLogin');
  const btnReg = document.getElementById('tabCustomerRegister');
  const formLogin = document.getElementById('customerLoginForm');
  const formReg = document.getElementById('customerRegisterForm');

  if (tab === 'login') {
    if (btnLogin) btnLogin.classList.add('active');
    if (btnReg) btnReg.classList.remove('active');
    if (formLogin) formLogin.style.display = 'block';
    if (formReg) formReg.style.display = 'none';
  } else {
    if (btnReg) btnReg.classList.add('active');
    if (btnLogin) btnLogin.classList.remove('active');
    if (formLogin) formLogin.style.display = 'none';
    if (formReg) formReg.style.display = 'block';
  }
}

async function handleCustomerLogin(e) {
  e.preventDefault();
  const email = document.getElementById('custLoginEmail').value.trim();
  const password = document.getElementById('custLoginPassword').value.trim();
  const btn = document.getElementById('btnCustomerLogin');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-dot"></span> Authenticating Session...';
  }

  try {
    const res = await fetch('/api/customer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('aura3d_customer_token', data.token);
      currentCustomer = data.customer;
      updateCustomerNavBadge();
      renderCustomerDashboard();
      showToast(`Welcome back, ${currentCustomer.name}!`);
    } else {
      alert(data.error || 'Authentication failed. Please verify credentials.');
    }
  } catch (err) {
    alert('Failed to connect to authentication server');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-dot"></span> Sign In to Customer Portal &rarr;';
    }
  }
}

async function handleCustomerRegister(e) {
  e.preventDefault();
  const name = document.getElementById('custRegName').value.trim();
  const phone = document.getElementById('custRegPhone').value.trim();
  const email = document.getElementById('custRegEmail').value.trim();
  const password = document.getElementById('custRegPassword').value.trim();
  const address = document.getElementById('custRegAddress').value.trim();
  const city = document.getElementById('custRegCity').value.trim();
  const state = (document.getElementById('custRegState').value || 'Karnataka').trim();
  const pincode = document.getElementById('custRegPincode').value.trim();
  const btn = document.getElementById('btnCustomerReg');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-dot"></span> Creating Account Registry...';
  }

  try {
    const res = await fetch('/api/customer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, password, address, city, state, pincode })
    });
    const data = await res.json();
    if (data.success && data.token) {
      localStorage.setItem('aura3d_customer_token', data.token);
      currentCustomer = data.customer;
      updateCustomerNavBadge();
      renderCustomerDashboard();
      showToast(`Welcome to Aura3D Labs, ${currentCustomer.name}!`);
    } else {
      alert(data.error || 'Registration failed');
    }
  } catch (err) {
    alert('Registration service error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span class="btn-dot"></span> Create Account &amp; Proceed &rarr;';
    }
  }
}

function handleCustomerLogout() {
  localStorage.removeItem('aura3d_customer_token');
  currentCustomer = null;
  updateCustomerNavBadge();
  document.getElementById('customerAuthView').style.display = 'block';
  document.getElementById('customerDashboardView').style.display = 'none';
  showToast('Customer session terminated');
}

async function renderCustomerDashboard() {
  document.getElementById('customerAuthView').style.display = 'none';
  document.getElementById('customerDashboardView').style.display = 'block';

  document.getElementById('custPortalName').textContent = currentCustomer.name;
  document.getElementById('custPortalEmail').textContent = `${currentCustomer.email} • ${currentCustomer.phone}`;

  const container = document.getElementById('custOrdersList');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; padding: 20px; font-family: var(--font-mono); color: var(--color-muted);">Retrieving order telemetry...</div>';

  try {
    const token = localStorage.getItem('aura3d_customer_token');
    const res = await fetch('/api/customer/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const orders = data.orders || [];

    if (orders.length === 0) {
      container.innerHTML = `
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border-hairline); border-radius: 4px; padding: 24px; text-align: center; color: var(--color-muted);">
          <div style="font-size: 1.1rem; color: #fff; margin-bottom: 6px;">No Order History Found</div>
          <p style="font-size: 0.8rem; margin: 0 0 16px;">You haven't placed an order yet under this email.</p>
          <button onclick="closeCustomerModal()" class="btn-magnetic" style="display: inline-flex;">
            <span class="btn-dot"></span> Browse Hardware Catalog
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map(ord => {
      const dateStr = ord.createdAt ? new Date(ord.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Recorded';
      const statusClass = {
        'PLACED': 'status-placed',
        'PROCESSING': 'status-processing',
        'DISPATCHED': 'status-dispatched',
        'IN_TRANSIT': 'status-in_transit',
        'DELIVERED': 'status-delivered'
      }[ord.status] || 'status-placed';

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-hairline); border-radius: 4px; padding: 16px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
            <div>
              <strong style="font-family: var(--font-mono); font-size: 0.95rem; color: #fff;">${ord.id}</strong>
              <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--color-muted); display: block;">${dateStr} &bull; ${ord.paymentMethod}</span>
            </div>
            <span class="status-pill ${statusClass}">● ${ord.status}</span>
          </div>

          <div style="font-size: 0.8rem; color: var(--color-titanium); margin-bottom: 12px;">
            ${(ord.items || []).map(i => `${i.name} (${i.qty})`).join(', ')}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px dashed var(--border-hairline); padding-top: 10px; flex-wrap: wrap; gap: 10px;">
            <span style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-champagne); font-weight: 700;">
              ₹${(ord.total || 0).toLocaleString('en-IN')}
            </span>
            <div style="display: flex; gap: 8px;">
              <button onclick="closeCustomerModal(); openTrackModal('${ord.id}')" style="background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.3); color: var(--color-champagne); padding: 6px 12px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.7rem; cursor: pointer;">
                Track Consignment
              </button>
              ${ord.items && ord.items[0] ? `
                <button onclick="closeCustomerModal(); openReviewModal('${ord.items[0].id}', '${ord.items[0].name.replace(/'/g, "\\'")}')" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-hairline); color: #fff; padding: 6px 12px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.7rem; cursor: pointer;">
                  ★ Write Review
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    container.innerHTML = '<div style="color: #f87171; font-size: 0.8rem;">Failed to load order history.</div>';
  }
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
