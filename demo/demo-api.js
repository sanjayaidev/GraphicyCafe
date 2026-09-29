/* ─────────────────────────────────────────────────────────────
   GraphicyCafe DEMO MODE
   Fakes the GET /api/... endpoints in the browser so every page
   works with no database and no server.

   • Edit PRODUCTS below to change what shows up.
   • Put your .glb files in /models/ and set `model` on a product.
   • When your real DB is ready: set DEMO_MODE = false (or delete
     the <script src="demo/demo-api.js"> line from the pages).
   ───────────────────────────────────────────────────────────── */
(function () {
  const DEMO_MODE = true;
  if (!DEMO_MODE) return;

  const img = (seed, w = 600, h = 450) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

  const CATEGORIES = [
    { id: 'c1', name: 'Mains',    slug: 'mains',    description: 'Grill and hearty plates', parent_id: null, display_order: 1 },
    { id: 'c2', name: 'Starters', slug: 'starters', description: 'Small plates to share',   parent_id: null, display_order: 2 },
    { id: 'c3', name: 'Desserts', slug: 'desserts', description: 'Sweet finishes',          parent_id: null, display_order: 3 },
    { id: 'c4', name: 'Drinks',   slug: 'drinks',   description: 'Coffee, tea and coolers', parent_id: null, display_order: 4 },
  ];

  // `model` = filename inside /models/ (leave out for products with no 3D view).
  // Rename the dishes to match the 5 models you upload.
  const PRODUCTS = [
    { id: 'p1', name: 'Charred Miso Salmon', cat: 'c1', price: 28, stock: 20, tags: ['gluten-free'],       best: true,  chef: false, model: 'model-1.glb', desc: 'Cedar-charred salmon glazed with white miso and citrus.' },
    { id: 'p2', name: 'Ember Short Rib',     cat: 'c1', price: 32, stock: 15, tags: [],                    best: false, chef: true,  model: 'model-2.glb', desc: 'Slow-braised short rib finished over open flame.' },
    { id: 'p3', name: 'Smoked Eggplant',     cat: 'c2', price: 14, stock: 30, tags: ['vegetarian','vegan'], best: false, chef: true,  model: 'model-3.glb', desc: 'Fire-smoked eggplant with tahini, herbs and chili oil.' },
    { id: 'p4', name: 'Burrata & Peach',     cat: 'c2', price: 16, stock: 25, tags: ['vegetarian'],        best: true,  chef: false, model: 'model-4.glb', desc: 'Creamy burrata, grilled peach, basil and honey.' },
    { id: 'p5', name: 'Layer Cake',          cat: 'c3', price: 18, stock: 12, tags: ['vegetarian'],        best: true,  chef: false, model: 'model-5.glb', desc: 'Six-layer chocolate cake with salted caramel.' },
    { id: 'p6', name: 'Cold Brew Tonic',     cat: 'c4', price: 7,  stock: 50, tags: ['vegan'],             best: false, chef: false,                     desc: 'Cold brew over tonic with orange peel.' },
    { id: 'p7', name: 'Citrus Olive Oil Tart', cat: 'c3', price: 12, stock: 18, tags: ['vegetarian'],      best: false, chef: false,                     desc: 'Buttery tart with lemon curd and olive oil.' },
    { id: 'p8', name: 'Charred Corn Ribs',   cat: 'c2', price: 11, stock: 0,  tags: ['vegetarian'],        best: false, chef: false,                     desc: 'Smoky corn ribs with lime butter and cotija.' },
  ];

  const now = new Date().toISOString();
  const catName = id => (CATEGORIES.find(c => c.id === id) || {}).name || null;

  const products = PRODUCTS.map((p, i) => ({
    id: p.id, name: p.name,
    slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    description: p.desc, price: p.price,
    category_id: p.cat, category_name: catName(p.cat),
    stock_quantity: p.stock,
    images: [img(p.id), img(p.id + 'b')],
    dietary_tags: p.tags,
    is_active: true, is_3d_featured: !!p.model,
    is_chef_pick: p.chef, is_best_seller: p.best,
    created_at: new Date(Date.now() - i * 864e5).toISOString(),
  }));

  const models = PRODUCTS.filter(p => p.model).map(p => ({
    id: 'm-' + p.id,
    filename: p.model,
    file_url: '/models/' + p.model,
    file_size: null,
    model_type: 'glb',
    assigned_product_id: p.id,
    product_name: p.name,
    metadata: {},
    created_at: now,
  }));

  const heroSlides = [
    { id: 'h1', image_url: img('hero-fire', 1600, 800),  eyebrow: 'Welcome',    title: 'Fire, smoke, and the dishes worth it', subtitle: 'Charred mains and seasonal small plates.', cta_text: 'Order now →', cta_link: 'products.html', display_order: 1, is_active: true },
    { id: 'h2', image_url: img('hero-3d', 1600, 800),    eyebrow: 'See it first', title: 'Every dish, in 3D',                  subtitle: 'Rotate it. Place it on your table in AR.', cta_text: 'Browse menu →', cta_link: 'products.html', display_order: 2, is_active: true },
  ];

  const testimonials = [
    { id: 't1', name: 'Aisha K.',  initials: 'AK', role: 'Verified order', stars: 5, quote: 'The 3D preview made ordering fun, and the short rib was unreal.' },
    { id: 't2', name: 'Daniel R.', initials: 'DR', role: 'Verified order', stars: 5, quote: 'Fast delivery, everything arrived hot. The layer cake is dangerous.' },
    { id: 't3', name: 'Meera S.',  initials: 'MS', role: 'Verified order', stars: 4, quote: 'Loved the smoked eggplant. Would love more vegan options.' },
  ];

  const siteSettings = { site_name: 'GraphicyCafe', tagline: 'Fresh brewed, 3D viewed', logo_url: null, featured_title: "The chef's table" };
  const contact = {
    phone: '+1 (214) 555-0134', email: 'hello@graphicycafe.com',
    address: '4118 Ember Row, Dallas, TX 75201', google_maps_url: 'https://maps.google.com/?q=GraphicyCafe+Dallas',
    hours_weekdays: '5:00 PM – 11:00 PM', hours_weekends: '12:00 PM – 1:00 AM',
  };

  const routes = {
    products, models, categories: CATEGORIES,
    'hero-slides': heroSlides, testimonials,
    'site-settings': siteSettings, contact,
    'theme-settings': {},      // {} = keep the CSS defaults
    'featured-sections': [],
  };

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const raw = typeof input === 'string' ? input : input.url;
      const path = new URL(raw, location.href).pathname;
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

      if (path.startsWith('/api/')) {
        if (method !== 'GET') return Promise.resolve(json({ error: 'Demo mode: read-only' }, 405));
        if (path.startsWith('/api/auth/')) return Promise.resolve(json({ error: 'Not authenticated' }, 401));

        const m = path.match(/^\/api\/(?:admin|public)\/([^/]+)(?:\/([^/]+))?$/);
        if (m) {
          const [, name, id] = m;
          if (name === 'content') return Promise.resolve(json({}));          // page defaults
          if (name in routes) {
            const list = routes[name];
            if (id && Array.isArray(list)) {
              const item = list.find(x => x.id === id);
              return Promise.resolve(item ? json(item) : json({ error: 'Not found' }, 404));
            }
            return Promise.resolve(json(list));
          }
        }
        return Promise.resolve(json({ error: 'Not available in demo mode' }, 404));
      }
    } catch (e) { /* fall through to the real fetch */ }
    return realFetch(input, init);
  };

  console.info('%cGraphicyCafe demo mode: using built-in sample data', 'color:#e0a040');
})();
