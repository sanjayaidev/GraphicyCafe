// ─── GraphicyCafe Admin Server ───
import 'dotenv/config';
import express from "express";
import bcrypt from "bcryptjs";
import cookie from "cookie";
import path from "path";
import { fileURLToPath } from "url";
import sql from "./lib/db.js";
import { createSession, getSessionUser, setSessionCookie, clearSessionCookie } from "./lib/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ─── AUTH MIDDLEWARE ───
// Staff roles that are allowed into the admin panel at all. The `roles` table
// also carries granular `permissions` (products:*, orders:*, site:*, etc) for
// admin/manager/editor - that finer-grained enforcement isn't wired up yet,
// but this at minimum stops a logged-in *customer* account from hitting any
// /api/admin/* route, which previously required nothing but a valid session.
const ADMIN_PANEL_ROLES = ["admin", "manager", "editor"];

const requireAuth = async (req, res, next) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  if (!ADMIN_PANEL_ROLES.includes(user.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }
  req.user = user;
  next();
};

// Extra gate for routes that manage other users/roles - only 'admin' should
// ever be able to change someone else's role or deactivate/delete accounts,
// regardless of the manager/editor content permissions above.
const requireAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};
// ─── HERO SLIDES CRUD ───
app.get("/api/admin/hero-slides", requireAuth, async (req, res) => {
  try {
    const slides = await sql`
      SELECT id, image_url, eyebrow, title, subtitle, cta_text, cta_link, display_order, is_active
      FROM hero_slides
      ORDER BY display_order
    `;
    res.json(slides);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hero slides" });
  }
});

app.get("/api/public/hero-slides", async (req, res) => {
  try {
    const slides = await sql`
      SELECT image_url, eyebrow, title, subtitle, cta_text, cta_link
      FROM hero_slides
      WHERE is_active = true
      ORDER BY display_order
    `;
    res.json(slides);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hero slides" });
  }
});

app.post("/api/admin/hero-slides", requireAuth, async (req, res) => {
  try {
    const { image_url, eyebrow, title, subtitle, cta_text, cta_link, display_order, is_active } = req.body;
    const result = await sql`
      INSERT INTO hero_slides (image_url, eyebrow, title, subtitle, cta_text, cta_link, display_order, is_active)
      VALUES (${image_url}, ${eyebrow || null}, ${title}, ${subtitle || null}, ${cta_text || null}, ${cta_link || null}, ${display_order || 0}, ${is_active !== false})
      RETURNING id, image_url, eyebrow, title, subtitle, cta_text, cta_link, display_order, is_active
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create hero slide" });
  }
});

app.put("/api/admin/hero-slides/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { image_url, eyebrow, title, subtitle, cta_text, cta_link, display_order, is_active } = req.body;
    await sql`
      UPDATE hero_slides
      SET image_url = ${image_url},
          eyebrow = ${eyebrow || null},
          title = ${title},
          subtitle = ${subtitle || null},
          cta_text = ${cta_text || null},
          cta_link = ${cta_link || null},
          display_order = ${display_order || 0},
          is_active = ${is_active !== false},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update hero slide" });
  }
});

app.delete("/api/admin/hero-slides/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM hero_slides WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete hero slide" });
  }
});

app.post("/api/admin/upload-image", requireAuth, async (req, res) => {
  try {
    const { image_data } = req.body;
    if (!image_data) return res.status(400).json({ error: "Image data is required" });

    const formData = new FormData();
    formData.append("key", process.env.IMGBB_API_KEY);
    formData.append("image", image_data);

    const response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (data.success) {
      res.json({ url: data.data.url });
    } else {
      res.status(400).json({ error: data.error?.message || "Upload failed" });
    }
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to upload image" });
  }
});
// ─── AUTH ROUTES ───
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    const users = await sql`SELECT id, name, email, password_hash, is_active FROM users WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (users.length === 0 || !users[0].is_active) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, users[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const { token, expiresAt } = await createSession(users[0].id);
    setSessionCookie(res, token, expiresAt);
    return res.status(200).json({ user: { id: users[0].id, name: users[0].name, email: users[0].email } });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = cookie.parse(req.headers.cookie || "");
    if (cookies.session_token) await sql`DELETE FROM user_sessions WHERE token = ${cookies.session_token}`;
    clearSessionCookie(res);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    return res.status(200).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── ADMIN API ROUTES ───

// 1. Dashboard Stats
app.get("/api/admin/stats", requireAuth, async (req, res) => {
  try {
    const stats = await sql`
      SELECT 
        (SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURRENT_DATE) as orders_today,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE DATE(created_at) = CURRENT_DATE AND payment_status = 'paid') as revenue_today,
        (SELECT COUNT(*) FROM products WHERE is_active = true) as active_products,
        (SELECT COUNT(*) FROM products WHERE stock_quantity <= 5 AND is_active = true) as low_stock
    `;
    res.json(stats[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});
// 9b. Public Featured Sections
app.get("/api/public/featured-sections", async (req, res) => {
  try {
    const sections = await sql`
      SELECT id, section_key, title, display_order, is_visible, config
      FROM featured_sections
      WHERE is_visible = true
      ORDER BY display_order
    `;
    res.json(sections);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch featured sections" });
  }
});
// 2. Site Settings
app.get("/api/admin/site-settings", requireAuth, async (req, res) => {
  try {
    const settings = await sql`SELECT * FROM site_settings LIMIT 1`;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch site settings" });
  }
});
// ─── HOMEPAGE CONTENT ───
app.get("/api/admin/homepage", requireAuth, async (req, res) => {
  try {
    const content = await sql`SELECT * FROM homepage_content LIMIT 1`;
    res.json(content[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch homepage content" });
  }
});

app.put("/api/admin/homepage", requireAuth, async (req, res) => {
  try {
    const { featured_title, featured_description, featured_cta_text, featured_cta_link, offers_title } = req.body;
    await sql`
      INSERT INTO homepage_content (id, featured_title, featured_description, featured_cta_text, featured_cta_link, offers_title)
      VALUES ((SELECT id FROM homepage_content LIMIT 1), ${featured_title}, ${featured_description}, ${featured_cta_text}, ${featured_cta_link}, ${offers_title})
      ON CONFLICT (id) DO UPDATE SET 
        featured_title = EXCLUDED.featured_title,
        featured_description = EXCLUDED.featured_description,
        featured_cta_text = EXCLUDED.featured_cta_text,
        featured_cta_link = EXCLUDED.featured_cta_link,
        offers_title = EXCLUDED.offers_title,
        updated_at = CURRENT_TIMESTAMP
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save homepage content" });
  }
});

app.get("/api/public/homepage", async (req, res) => {
  try {
    const content = await sql`SELECT hero_title, hero_subtitle, hero_cta_text, hero_cta_link, featured_title, featured_description, featured_cta_text, featured_cta_link, offers_title FROM homepage_content LIMIT 1`;
    res.json(content[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch homepage content" });
  }
});
app.put("/api/admin/site-settings", requireAuth, async (req, res) => {
  try {
    const { site_name, tagline, logo_url, featured_title } = req.body;
    await sql`
      INSERT INTO site_settings (id, site_name, tagline, logo_url, featured_title)
      VALUES ((SELECT id FROM site_settings LIMIT 1), ${site_name}, ${tagline}, ${logo_url}, ${featured_title})
      ON CONFLICT (id) DO UPDATE SET 
        site_name = EXCLUDED.site_name, 
        tagline = EXCLUDED.tagline, 
        logo_url = EXCLUDED.logo_url,
        featured_title = EXCLUDED.featured_title
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save site settings" });
  }
});

// 3. Theme Settings
app.get("/api/admin/theme-settings", requireAuth, async (req, res) => {
  try {
    const settings = await sql`SELECT * FROM theme_settings LIMIT 1`;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch theme settings" });
  }
});

app.put("/api/admin/theme-settings", requireAuth, async (req, res) => {
  try {
    const { color_background, color_surface, color_ivory, color_amber, color_ember, color_line } = req.body;
    await sql`
      INSERT INTO theme_settings (id, color_background, color_surface, color_ivory, color_ivory_dim, color_amber, color_ember, color_line)
      VALUES ((SELECT id FROM theme_settings LIMIT 1), ${color_background}, ${color_surface}, ${color_ivory}, '#C9BFA9', ${color_amber}, ${color_ember}, ${color_line})
      ON CONFLICT (id) DO UPDATE SET 
        color_ivory_dim = EXCLUDED.color_ivory_dim,
        color_background = EXCLUDED.color_background, color_surface = EXCLUDED.color_surface,
        color_ivory = EXCLUDED.color_ivory, color_amber = EXCLUDED.color_amber, color_ember = EXCLUDED.color_ember, color_line = EXCLUDED.color_line
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save theme settings" });
  }
});

// 4. Categories - Full CRUD
app.get("/api/admin/categories", requireAuth, async (req, res) => {
  try {
    const cats = await sql`
      SELECT id, name, slug, description, parent_id, display_order 
      FROM categories 
      ORDER BY display_order
    `;
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

app.post("/api/admin/categories", requireAuth, async (req, res) => {
  try {
    const { name, description, parent_id, display_order } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const result = await sql`
      INSERT INTO categories (name, slug, description, parent_id, display_order)
      VALUES (${name}, ${slug}, ${description || null}, ${parent_id || null}, ${display_order || 0})
      RETURNING id, name, slug, description, parent_id, display_order
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create category" });
  }
});

app.patch("/api/admin/categories/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parent_id, display_order } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name !== undefined) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
      updates.push(`slug = $${paramIndex++}`);
      values.push(slug);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (parent_id !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(parent_id || null);
    }
    if (display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(display_order);
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    await sql`
      UPDATE categories
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update category" });
  }
});

app.delete("/api/admin/categories/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM categories WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete category" });
  }
});

// 5. Products - Full CRUD
app.get("/api/admin/products", requireAuth, async (req, res) => {
  try {
    const products = await sql`
      SELECT p.id, p.name, p.price, p.stock_quantity, p.is_active, p.is_3d_featured, p.is_chef_pick, p.is_best_seller,
             p.description, p.images, p.dietary_tags, p.category_id,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.created_at DESC
    `;
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/api/admin/products/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await sql`
      SELECT p.id, p.name, p.slug, p.description, p.price, p.category_id, p.stock_quantity, 
             p.images, p.is_active, p.is_3d_featured, p.is_chef_pick, p.is_best_seller, p.dietary_tags
      FROM products p
      WHERE p.id = ${id}
    `;
    if (product.length === 0) return res.status(404).json({ error: "Product not found" });
    res.json(product[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

app.post("/api/admin/products", requireAuth, async (req, res) => {
  try {
    const { name, category_id, price, stock_quantity, tags, description, image_urls, is_active, is_3d_featured, is_chef_pick, is_best_seller } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    const result = await sql`
      INSERT INTO products (name, slug, description, price, category_id, stock_quantity, images, is_active, is_3d_featured, is_chef_pick, is_best_seller, dietary_tags)
      VALUES (${name}, ${slug}, ${description || null}, ${price}, ${category_id || null}, ${stock_quantity || 0}, ${JSON.stringify(image_urls || [])}, ${is_active !== false}, ${is_3d_featured || false}, ${is_chef_pick || false}, ${is_best_seller || false}, ${JSON.stringify(tags ? tags.split(',').map(t => t.trim()) : [])})
      RETURNING id
    `;
    res.json({ ok: true, id: result[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create product" });
  }
});

app.put("/api/admin/products/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, price, stock_quantity, tags, description, image_urls, is_active, is_3d_featured, is_chef_pick, is_best_seller } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    await sql`
      UPDATE products
      SET name = ${name},
          slug = ${slug},
          description = ${description || null},
          price = ${price},
          category_id = ${category_id || null},
          stock_quantity = ${stock_quantity || 0},
          images = ${JSON.stringify(image_urls || [])},
          is_active = ${is_active !== false},
          is_3d_featured = ${is_3d_featured || false},
          is_chef_pick = ${is_chef_pick || false},
          is_best_seller = ${is_best_seller || false},
          dietary_tags = ${JSON.stringify(tags ? tags.split(',').map(t => t.trim()) : [])},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

app.delete("/api/admin/products/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM products WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

app.patch("/api/admin/products/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, is_3d_featured, is_chef_pick, is_best_seller, stock_quantity, price } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (is_active !== undefined) { updates.push(`is_active = $${paramIndex++}`); values.push(is_active); }
    if (is_3d_featured !== undefined) { updates.push(`is_3d_featured = $${paramIndex++}`); values.push(is_3d_featured); }
    if (is_chef_pick !== undefined) { updates.push(`is_chef_pick = $${paramIndex++}`); values.push(is_chef_pick); }
    if (is_best_seller !== undefined) { updates.push(`is_best_seller = $${paramIndex++}`); values.push(is_best_seller); }
    if (stock_quantity !== undefined) { updates.push(`stock_quantity = $${paramIndex++}`); values.push(stock_quantity); }
    if (price !== undefined) { updates.push(`price = $${paramIndex++}`); values.push(price); }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    await sql`
      UPDATE products
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// 6. Contact Details
app.get("/api/admin/contact", requireAuth, async (req, res) => {
  try {
    const settings = await sql`
      SELECT phone, email, address, google_maps_url, hours_weekdays, hours_weekends 
      FROM site_settings 
      LIMIT 1
    `;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contact details" });
  }
});

app.put("/api/admin/contact", requireAuth, async (req, res) => {
  try {
    const { phone, email, address, google_maps_url, hours_weekdays, hours_weekends } = req.body;
    await sql`
      INSERT INTO site_settings (id, phone, email, address, google_maps_url, hours_weekdays, hours_weekends)
      VALUES ((SELECT id FROM site_settings LIMIT 1), ${phone}, ${email}, ${address}, ${google_maps_url}, ${hours_weekdays}, ${hours_weekends})
      ON CONFLICT (id) DO UPDATE SET 
        phone = EXCLUDED.phone, email = EXCLUDED.email, address = EXCLUDED.address,
        google_maps_url = EXCLUDED.google_maps_url, hours_weekdays = EXCLUDED.hours_weekdays, hours_weekends = EXCLUDED.hours_weekends
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save contact details" });
  }
});

// 7. Users - Full CRUD
app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await sql`
      SELECT u.id, u.name, u.email, u.is_active, u.avatar_url,
             array_agg(r.name) FILTER (WHERE r.name IS NOT NULL) as roles,
             array_agg(r.permissions) FILTER (WHERE r.permissions IS NOT NULL) as permissions
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      GROUP BY u.id, u.name, u.email, u.is_active, u.avatar_url
      ORDER BY u.created_at DESC
    `;
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, role } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    await sql`
      UPDATE users
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
    `;

    // Update role if provided
    if (role !== undefined) {
      // Remove existing roles
      await sql`DELETE FROM user_roles WHERE user_id = ${id}`;
      if (role) {
        const roleResult = await sql`SELECT id FROM roles WHERE name = ${role} LIMIT 1`;
        if (roleResult.length > 0) {
          await sql`INSERT INTO user_roles (user_id, role_id) VALUES (${id}, ${roleResult[0].id})`;
        }
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

app.delete("/api/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // Don't allow deleting yourself
    if (req.user.id === id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }
    await sql`DELETE FROM users WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// 8. Roles
app.get("/api/admin/roles", requireAuth, requireAdmin, async (req, res) => {
  try {
    const roles = await sql`
      SELECT id, name, description, permissions 
      FROM roles 
      ORDER BY name
    `;
    res.json(roles);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

app.patch("/api/admin/roles/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;
    await sql`
      UPDATE roles 
      SET permissions = ${JSON.stringify(permissions || [])}
      WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update role" });
  }
});

// 9. Featured Sections - Full CRUD
app.get("/api/admin/featured-sections", requireAuth, async (req, res) => {
  try {
    const sections = await sql`
      SELECT id, section_key, title, display_order, is_visible, config
      FROM featured_sections
      ORDER BY display_order
    `;
    res.json(sections);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch featured sections" });
  }
});

app.post("/api/admin/featured-sections", requireAuth, async (req, res) => {
  try {
    const { section_key, title, display_order, is_visible, config } = req.body;
    const result = await sql`
      INSERT INTO featured_sections (section_key, title, display_order, is_visible, config)
      VALUES (${section_key}, ${title || null}, ${display_order || 0}, ${is_visible !== false}, ${JSON.stringify(config || {})})
      RETURNING id, section_key, title, display_order, is_visible, config
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create featured section" });
  }
});

app.patch("/api/admin/featured-sections/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_visible, display_order, title, config } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (is_visible !== undefined) {
      updates.push(`is_visible = $${paramIndex++}`);
      values.push(is_visible);
    }
    if (display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(display_order);
    }
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(config));
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    values.push(id);
    await sql`
      UPDATE featured_sections
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
    `;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update featured section" });
  }
});

app.delete("/api/admin/featured-sections/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM featured_sections WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete featured section" });
  }
});

app.put("/api/admin/featured-sections", requireAuth, async (req, res) => {
  try {
    const { sections } = req.body;
    for (const section of sections) {
      await sql`
        UPDATE featured_sections
        SET display_order = ${section.display_order},
            is_visible = ${section.is_visible},
            title = COALESCE(${section.title || null}, title),
            config = COALESCE(${section.config ? JSON.stringify(section.config) : null}, config),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${section.id}
      `;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update featured sections" });
  }
});

// 10. 3D Models - URL based
app.get("/api/admin/models", requireAuth, async (req, res) => {
  try {
    const models = await sql`
      SELECT m.id, m.filename, m.file_url, m.file_size, m.model_type, 
             m.assigned_product_id, m.metadata, m.created_at,
             p.name as product_name
      FROM models_3d m
      LEFT JOIN products p ON m.assigned_product_id = p.id
      ORDER BY m.created_at DESC
    `;
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch 3D models" });
  }
});

app.post("/api/admin/models", requireAuth, async (req, res) => {
  try {
    const { filename, file_url, file_size, model_type, assigned_product_id, metadata } = req.body;
    const result = await sql`
      INSERT INTO models_3d (filename, file_url, file_size, model_type, assigned_product_id, metadata)
      VALUES (${filename}, ${file_url}, ${file_size || null}, ${model_type || null}, ${assigned_product_id || null}, ${JSON.stringify(metadata || {})})
      RETURNING id, filename, file_url, file_size, model_type, assigned_product_id, metadata
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create 3D model" });
  }
});

app.patch("/api/admin/models/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_product_id, model_type, metadata } = req.body;
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (assigned_product_id !== undefined) {
      updates.push(`assigned_product_id = $${paramIndex++}`);
      values.push(assigned_product_id || null);
    }
    if (model_type !== undefined) {
      updates.push(`model_type = $${paramIndex++}`);
      values.push(model_type);
    }
    if (metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(metadata));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(id);
    await sql`
      UPDATE models_3d
      SET ${sql.raw(updates.join(', '))}
      WHERE id = $${paramIndex}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update 3D model" });
  }
});

app.delete("/api/admin/models/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM models_3d WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete 3D model" });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUBLIC STOREFRONT ROUTES
// (index.html/products.html etc. were calling /api/admin/* directly,
// which 401s for anyone not logged into the admin panel. These are the
// public, read-only, no-auth equivalents the storefront should use.)
// ═══════════════════════════════════════════════════════════════

app.get("/api/public/theme-settings", async (req, res) => {
  try {
    const settings = await sql`SELECT color_background, color_surface, color_ivory, color_ivory_dim, color_amber, color_ember, color_line FROM theme_settings LIMIT 1`;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch theme settings" });
  }
});

app.get("/api/public/site-settings", async (req, res) => {
  try {
    const settings = await sql`SELECT site_name, tagline, logo_url, featured_title FROM site_settings LIMIT 1`;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch site settings" });
  }
});

app.get("/api/public/categories", async (req, res) => {
  try {
    const cats = await sql`SELECT id, name, slug, description, parent_id, display_order FROM categories ORDER BY display_order`;
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

app.get("/api/public/products", async (req, res) => {
  try {
    const products = await sql`
      SELECT p.id, p.name, p.slug, p.description, p.price, p.stock_quantity, p.images, p.dietary_tags,
             p.is_3d_featured, p.is_chef_pick, p.is_best_seller, p.category_id,
             c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = true
      ORDER BY p.created_at DESC
    `;
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

app.get("/api/public/models", async (req, res) => {
  try {
    const models = await sql`
      SELECT m.id, m.filename, m.file_url, m.model_type, m.assigned_product_id, p.name as product_name
      FROM models_3d m
      LEFT JOIN products p ON m.assigned_product_id = p.id
      ORDER BY m.created_at DESC
    `;
    res.json(models);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch 3D models" });
  }
});

app.get("/api/public/contact", async (req, res) => {
  try {
    const settings = await sql`SELECT phone, email, address, google_maps_url, hours_weekdays, hours_weekends FROM site_settings LIMIT 1`;
    res.json(settings[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch contact details" });
  }
});

// ═══════════════════════════════════════════════════════════════
// GENERIC PAGE CONTENT (data-ckey system)
// One table backs every editable freeform text/image block on every
// page. Public GET returns { ckey: value } for a page; admin PUT
// upserts one field at a time.
// ═══════════════════════════════════════════════════════════════

app.get("/api/public/content/:page", async (req, res) => {
  try {
    const { page } = req.params;
    const rows = await sql`SELECT ckey, field_type, value FROM page_content WHERE page = ${page}`;
    const content = {};
    for (const row of rows) content[row.ckey] = row.value;
    res.json(content);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch page content" });
  }
});

app.get("/api/admin/content/:page", requireAuth, async (req, res) => {
  try {
    const { page } = req.params;
    const rows = await sql`SELECT id, ckey, field_type, value, updated_at FROM page_content WHERE page = ${page} ORDER BY ckey`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch page content" });
  }
});

app.get("/api/admin/content-pages", requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT DISTINCT page FROM page_content ORDER BY page`;
    res.json(rows.map(r => r.page));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch content pages" });
  }
});

app.put("/api/admin/content", requireAuth, async (req, res) => {
  try {
    const { page, ckey, field_type, value } = req.body;
    if (!page || !ckey) return res.status(400).json({ error: "page and ckey are required" });

    const result = await sql`
      INSERT INTO page_content (page, ckey, field_type, value)
      VALUES (${page}, ${ckey}, ${field_type || 'text'}, ${value ?? ''})
      ON CONFLICT (page, ckey) DO UPDATE SET
        value = EXCLUDED.value,
        field_type = EXCLUDED.field_type,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, page, ckey, field_type, value, updated_at
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save content" });
  }
});

// ═══════════════════════════════════════════════════════════════
// TESTIMONIALS — Full CRUD
// ═══════════════════════════════════════════════════════════════

app.get("/api/admin/testimonials", requireAuth, async (req, res) => {
  try {
    const rows = await sql`SELECT id, name, initials, role, quote, stars, display_order, is_visible FROM testimonials ORDER BY display_order`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

app.get("/api/public/testimonials", async (req, res) => {
  try {
    const rows = await sql`SELECT name, initials, role, quote, stars FROM testimonials WHERE is_visible = true ORDER BY display_order`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

app.post("/api/admin/testimonials", requireAuth, async (req, res) => {
  try {
    const { name, initials, role, quote, stars, display_order, is_visible } = req.body;
    if (!name || !quote) return res.status(400).json({ error: "Name and quote are required" });
    const autoInitials = initials || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const result = await sql`
      INSERT INTO testimonials (name, initials, role, quote, stars, display_order, is_visible)
      VALUES (${name}, ${autoInitials}, ${role || null}, ${quote}, ${stars || 5}, ${display_order || 0}, ${is_visible !== false})
      RETURNING id, name, initials, role, quote, stars, display_order, is_visible
    `;
    res.json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create testimonial" });
  }
});

app.put("/api/admin/testimonials/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, initials, role, quote, stars, display_order, is_visible } = req.body;
    if (!name || !quote) return res.status(400).json({ error: "Name and quote are required" });
    const autoInitials = initials || name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    await sql`
      UPDATE testimonials
      SET name = ${name},
          initials = ${autoInitials},
          role = ${role || null},
          quote = ${quote},
          stars = ${stars || 5},
          display_order = ${display_order || 0},
          is_visible = ${is_visible !== false},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update testimonial" });
  }
});

app.delete("/api/admin/testimonials/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await sql`DELETE FROM testimonials WHERE id = ${id}`;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete testimonial" });
  }
});

// ─── START SERVER ───
app.listen(PORT, () => {
  console.log(`\n🔥 GraphicyCafe server running at http://localhost:${PORT}\n`);
});