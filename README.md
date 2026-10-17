# Aura3D Labs — Additive Precision & 3D Digital Ecosystem

Ultra-premium 3D printing e-commerce platform featuring an interactive Three.js WebGL kinetic experience, genuine OEM factory spares registry, technical polymer documentation, and instant WhatsApp ordering.

---

## 🚀 Instant Deployment to Vercel

This repository is pre-configured for zero-configuration deployment to **Vercel**.

### Option A: Deploy via GitHub / GitLab / Bitbucket (Recommended)
1. Push this directory to your GitHub repository.
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **"Add New..."** &rarr; **"Project"**.
4. Import your GitHub repository.
5. Keep all default build settings (Framework Preset: **Other**).
6. Click **"Deploy"**.

Vercel will automatically:
- Serve all static pages (`/`, `/spares.html`, `/guides.html`, `/admin.html`, CSS, JS) over global Edge CDN.
- Route all REST endpoints (`/api/products`, `/api/categories`, `/api/admin/*`, `/sitemap.xml`, `/robots.txt`) through the serverless function defined in `api/index.js`.

---

## 🔐 Production-Ready Admin Terminal

The store includes an enterprise-grade, dual-credential Admin Dashboard for creating, managing, and deleting inventory items in real time.

- **Access URL:** `http://localhost:3000/admin` (or `https://your-domain.vercel.app/admin`)
- **Default Credentials:**
  - **Admin ID:** `admin`
  - **Password:** `aura3d@2026`

### ⚙️ Production Environment Variables
Configure your credentials in `.env` (locally) or in **Vercel Project Settings &rarr; Environment Variables**:
```bash
# Admin username/handle
ADMIN_USERNAME=your_admin_id

# Master security key (recommended: 16+ characters)
ADMIN_PASSWORD=your_super_strong_password
```
*(Reference: see `.env.example` in the project root)*

### 🛡️ Production Security Architecture:
1. **Dual-Credential Verification:** Both Admin ID and Password are validated using constant-time cryptographic digests (`crypto.timingSafeEqual`) to eliminate timing-attack vulnerabilities.
2. **Brute-Force Rate Limiting:** Maximum 5 failed attempts per IP address within a 15-minute rolling window. Automatic 15-minute lockout with live countdown upon violation (HTTP 429).
3. **Session Hardening & Revocation:** Cryptographically generated 64-character bearer tokens (`crypto.randomBytes(32)`) with 24-hour expiration and server-side `/api/admin/logout` revocation.
4. **Client Hardening:** Show/Hide password toggle, optional "Remember ID" stored in local browser state (passwords are never cached), and auto-focus security.

### 📦 Catalog Management Capabilities:
1. **+ Add New Product:**
   - Full product metadata: Brand, Category, Type, Title, Badge, Pricing, Stock status, Featured toggle.
   - **Auto Discount Engine:** Computes `% OFF` dynamically when entering retail vs. original price.
   - **Live Card Preview:** Real-time visual mockup showing how the item appears on the storefront before publishing.
   - **Dynamic Tech Specs Matrix:** Add custom technical key/value pairs (e.g. *Build Volume*, *Max Speed*, *Nozzle Temp*) with automatic category defaults.
2. **Edit Existing Products:**
   - 1-click **Edit** button on any inventory row opens the modification studio.
   - Pre-populates all pricing, descriptions, images, tags, and dynamic technical specifications.
   - Real-time live card preview updates as fields are adjusted.
   - Saves updates atomically via `PUT /api/admin/products/:id` with instant synchronization across all storefront pages.
3. **Inventory Registry & Actions:**
   - View all catalog items with thumbnail, category, price, and stock status.
   - Search/filter across products in real time.
   - 1-click product deletion with confirmation dialog.

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Start local server
npm start
# or
npm run dev
```

Visit: `http://localhost:3000`  
Admin: `http://localhost:3000/admin`

---

## 📁 Project Structure

```text
├── api/
│   └── index.js             # Vercel serverless entrypoint
├── data/
│   ├── products.json        # 22 verified hardware, filament & spare SKUs
│   ├── reviews.json         # Customer reviews dataset
│   ├── guides.json          # Technical monographs
│   └── faqs.json            # Support FAQs
├── public/
│   ├── css/style.css        # Luxury editorial typography & tokens
│   ├── js/canvas3d.js       # Three.js 60FPS WebGL interactive core
│   ├── js/app.js            # Shopping cart engine & filtering
│   ├── index.html           # Main store & 3D hero stage
│   ├── spares.html          # OEM factory spares registry
│   ├── guides.html          # Technical papers & polymer matrix
│   └── admin.html           # Secure Admin Terminal for catalog management
├── server.js                # Express REST backend & authenticated admin APIs
├── vercel.json              # Vercel routing & rewrites configuration
├── .gitignore               # Git exclusions
└── package.json             # Project dependencies and start scripts
```
