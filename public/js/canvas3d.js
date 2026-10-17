/* ==========================================================================
   Aura3D Labs - Interactive 3D WebGL Hero Engine (Three.js)
   Realistic lighting, kinetic mesh physics, cursor raycasting & particles
   ========================================================================== */

(function () {
  'use strict';

  // Wait until Three.js is loaded
  function init3D() {
    if (typeof THREE === 'undefined') {
      setTimeout(init3D, 50);
      return;
    }

    const container = document.getElementById('webglHeroContainer');
    if (!container) return;

    // Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050608, 0.04);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 0, 7.5);

    // Renderer with Graceful WebGL Fallback
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('webglHeroCanvas'),
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
    } catch (e) {
      console.warn('WebGL context unavailable, falling back to static visual:', e);
      return;
    }

    // --- High-End Kinetic Sculpture: Additive Monolith ---
    const sculptureGroup = new THREE.Group();
    // Shift slightly to right to balance asymmetrical editorial text on left
    sculptureGroup.position.set(1.4, 0.1, 0);
    scene.add(sculptureGroup);

    // 1. Core Physical Geometry (Torus Knot with high radial segments)
    const coreGeometry = new THREE.TorusKnotGeometry(1.45, 0.42, 180, 36, 2, 3);
    const coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x1a1c24,
      emissive: 0x050608,
      roughness: 0.18,
      metalness: 0.92,
      clearcoat: 0.95,
      clearcoatRoughness: 0.08,
      reflectivity: 0.95
    });
    const coreMesh = new THREE.Mesh(coreGeometry, coreMaterial);
    sculptureGroup.add(coreMesh);

    // 2. Outer Wireframe Architectural Cage (Precision Galvanometer Grid)
    const wireframeGeometry = new THREE.IcosahedronGeometry(2.35, 2);
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0xd4af37,
      wireframe: true,
      transparent: true,
      opacity: 0.15
    });
    const wireframeMesh = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
    sculptureGroup.add(wireframeMesh);

    // 3. Orbiting Laser Ring (Visualizing Additive Slicing Plane)
    const ringGeometry = new THREE.TorusGeometry(2.1, 0.015, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      transparent: true,
      opacity: 0.55
    });
    const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial);
    ringMesh.rotation.x = Math.PI / 2.3;
    sculptureGroup.add(ringMesh);

    // 4. Volumetric Floating Particulate / Powder Bed Flecks
    const particleCount = 750;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 16;
      positions[i + 1] = (Math.random() - 0.5) * 12;
      positions[i + 2] = (Math.random() - 0.5) * 10;
      scales[i / 3] = Math.random() * 0.04 + 0.01;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const particleMaterial = new THREE.PointsMaterial({
      color: 0xd4af37,
      size: 0.035,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending
    });
    const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particleSystem);

    // --- Dynamic Physically-Based Lighting ---
    const ambientLight = new THREE.AmbientLight(0x181a24, 1.2);
    scene.add(ambientLight);

    // Cursor-Tracking Directional Key Light (Casts dynamic specular highlight)
    const keyLight = new THREE.DirectionalLight(0xfffaed, 3.8);
    keyLight.position.set(3, 4, 5);
    scene.add(keyLight);

    // Dramatic Rim Light (Champagne Titanium sheen)
    const rimLight = new THREE.DirectionalLight(0xd4af37, 2.8);
    rimLight.position.set(-5, -2, -3);
    scene.add(rimLight);

    // Subtle Cool Fill Light (Teal/Cyan laser tint)
    const fillLight = new THREE.PointLight(0x2dd4bf, 1.6, 12);
    fillLight.position.set(0, -3, 2);
    scene.add(fillLight);

    // --- Cursor & Inertia Physics ---
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let dragVelocity = { x: 0, y: 0 };

    window.addEventListener('mousemove', (e) => {
      // Normalized coordinates (-1 to 1)
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = -(e.clientY / window.innerHeight) * 2 + 1;

      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;
        dragVelocity.x = deltaX * 0.005;
        dragVelocity.y = deltaY * 0.005;
        previousMousePosition = { x: e.clientX, y: e.clientY };
      }
    });

    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Touch Support
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        targetX = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
        targetY = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
      }
    }, { passive: true });

    // Scroll-based parallax
    let scrollY = 0;
    window.addEventListener('scroll', () => {
      scrollY = window.scrollY;
    }, { passive: true });

    // Resize Handler
    function onResize() {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;

      // Adjust camera distance for mobile
      if (width < 768) {
        camera.position.z = 9.5;
        sculptureGroup.position.set(0, 0.4, 0); // Center on mobile
      } else {
        camera.position.z = 7.5;
        sculptureGroup.position.set(1.4, 0.1, 0); // Asymmetrical right offset
      }

      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }
    window.addEventListener('resize', onResize);
    onResize();

    // --- 60FPS Render Loop with Damping ---
    const clock = new THREE.Clock();

    function animate() {
      requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();

      // Smooth Lerp toward cursor
      mouseX += (targetX - mouseX) * 0.05;
      mouseY += (targetY - mouseY) * 0.05;

      // Drag Inertia Decay
      if (!isDragging) {
        dragVelocity.x *= 0.94;
        dragVelocity.y *= 0.94;
      }
      sculptureGroup.rotation.y += dragVelocity.x;
      sculptureGroup.rotation.x += dragVelocity.y;

      // Autonomous Kinetic Movement
      coreMesh.rotation.x = elapsedTime * 0.22 + mouseY * 0.4;
      coreMesh.rotation.y = elapsedTime * 0.28 + mouseX * 0.6;

      wireframeMesh.rotation.x = -elapsedTime * 0.15;
      wireframeMesh.rotation.y = elapsedTime * 0.18;

      ringMesh.rotation.z = elapsedTime * 0.4;
      ringMesh.position.y = Math.sin(elapsedTime * 1.5) * 0.35;

      // Dynamic Key Light tracks cursor
      keyLight.position.x = 3 + mouseX * 4;
      keyLight.position.y = 4 + mouseY * 3;

      // Camera Parallax & Subtle Scroll Easing
      camera.position.x = mouseX * 0.45;
      camera.position.y = mouseY * 0.35 - (scrollY * 0.0015);
      camera.lookAt(sculptureGroup.position.x * 0.5, 0, 0);

      // Particulate Drift
      particleSystem.rotation.y = elapsedTime * 0.03;
      particleSystem.rotation.x = Math.sin(elapsedTime * 0.05) * 0.05;

      renderer.render(scene, camera);
    }

    animate();
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init3D);
  } else {
    init3D();
  }
})();
