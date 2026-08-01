-- ─── USERS & AUTH ───
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ─── HERO SLIDES ───
CREATE TABLE IF NOT EXISTS hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  eyebrow VARCHAR(100),
  title VARCHAR(255) NOT NULL,
  subtitle TEXT,
  cta_text VARCHAR(100),
  cta_link VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- ─── SITE SETTINGS ───
CREATE TABLE IF NOT EXISTS site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name VARCHAR(100) DEFAULT 'GraphicyCafe',
  tagline VARCHAR(255) DEFAULT 'Fresh brewed, 3D viewed',
  logo_url TEXT,
  featured_title VARCHAR(255) DEFAULT 'The chef''s table',
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  google_maps_url TEXT,
  hours_weekdays VARCHAR(100),
  hours_weekends VARCHAR(100),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── THEME SETTINGS ───
CREATE TABLE IF NOT EXISTS theme_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  color_background VARCHAR(20) DEFAULT '#17140F',
  color_surface VARCHAR(20) DEFAULT '#211C15',
  color_ivory VARCHAR(20) DEFAULT '#F3ECDD',
  color_ivory_dim VARCHAR(20) DEFAULT '#C9BFA9',
  color_amber VARCHAR(20) DEFAULT '#E3A63D',
  color_ember VARCHAR(20) DEFAULT '#C2542A',
  color_line VARCHAR(30) DEFAULT 'rgba(243,236,221,0.12)',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── CATEGORIES ───
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) UNIQUE NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── PRODUCTS ───
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(280) UNIQUE NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  stock_quantity INTEGER DEFAULT 0,
  images JSONB DEFAULT '[]',
  dietary_tags JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  is_3d_featured BOOLEAN DEFAULT false,
  is_chef_pick BOOLEAN DEFAULT false,
  is_best_seller BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── 3D MODELS ───
CREATE TABLE IF NOT EXISTS models_3d (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  model_type VARCHAR(50),
  assigned_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── ORDERS ───
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  address TEXT NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  delivery_fee DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending',
  payment_status VARCHAR(50) DEFAULT 'unpaid',
  payment_method VARCHAR(50),
  items JSONB DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── FEATURED SECTIONS ───
CREATE TABLE IF NOT EXISTS featured_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key VARCHAR(100) UNIQUE NOT NULL,
  title VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ─── HOMEPAGE CONTENT ───
CREATE TABLE IF NOT EXISTS homepage_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hero_title VARCHAR(255) DEFAULT 'Fire, smoke, and the dishes worth it',
  hero_subtitle TEXT DEFAULT 'Cedar-charred mains and seasonal small plates, plated the way you''ll actually see them at the table.',
  hero_cta_text VARCHAR(100) DEFAULT 'Order now →',
  hero_cta_link VARCHAR(255) DEFAULT '#',
  featured_title VARCHAR(255) DEFAULT 'The chef''s table',
  featured_description TEXT DEFAULT 'A seven-course tasting menu built around whatever came off the grill best this week.',
  featured_cta_text VARCHAR(100) DEFAULT 'Reserve the table →',
  featured_cta_link VARCHAR(255) DEFAULT '#',
  offers_title VARCHAR(255) DEFAULT 'Offers & special categories',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- ─── PAGE CONTENT (generic content-block system) ───
-- Every editable freeform text/image on every page lives here as a
-- single row keyed by (page, ckey). New editable fields never need a
-- migration — just insert a new row and reference the ckey in the HTML.
CREATE TABLE IF NOT EXISTS page_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page VARCHAR(60) NOT NULL,          -- 'global', 'index', 'products', 'product-details', 'cart', 'review', 'bot'
  ckey VARCHAR(120) NOT NULL,         -- e.g. 'hero.eyebrow', 'footer.tagline'
  field_type VARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text' | 'richtext' | 'image'
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (page, ckey)
);

-- ─── TESTIMONIALS ───
CREATE TABLE IF NOT EXISTS testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  initials VARCHAR(10),
  role VARCHAR(120),
  quote TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 5,
  display_order INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ─── SEED DATA ───
-- ─── SEED HOMEPAGE CONTENT ───
INSERT INTO homepage_content (id, hero_title, hero_subtitle, hero_cta_text, hero_cta_link, featured_title, featured_description, featured_cta_text, featured_cta_link, offers_title)
VALUES (
  gen_random_uuid(),
  'Fire, smoke, and the dishes worth it',
  'Cedar-charred mains and seasonal small plates, plated the way you''ll actually see them at the table.',
  'Order now →',
  '#',
  'The chef''s table',
  'A seven-course tasting menu built around whatever came off the grill best this week. Every course previewable in AR before you commit.',
  'Reserve the table →',
  '#',
  'Offers & special categories'
);
-- 1. Create admin user (password: admin123)
INSERT INTO users (id, name, email, password_hash, is_active) 
VALUES (
  gen_random_uuid(),
  'Admin User',
  'admin@graphicycafe.com',
  '$2b$10$rbbsWLbjdtF.aWdmX5tiGe.NWlNRAR2Fh1BBfSBd8mZveZyDbjfWK', -- bcrypt hash for 'admin123' (verified)
  true
);

-- 2. Create roles
INSERT INTO roles (id, name, description, permissions) VALUES
(gen_random_uuid(), 'admin', 'Full system access', '["*"]'),
(gen_random_uuid(), 'manager', 'Manage content and orders', '["products:*", "orders:*", "site:*", "categories:*"]'),
(gen_random_uuid(), 'editor', 'Manage content only', '["products:read", "products:write", "site:read", "site:write"]');

-- 3. Insert default site settings
-- NOTE: hero_headline/hero_subtext are NOT columns on site_settings (they don't
-- exist on this table at all - the hero copy lives on homepage_content.hero_title/
-- hero_subtitle, inserted below). The original insert referenced them and would
-- fail with "column does not exist" on a fresh database.
INSERT INTO site_settings (id, site_name, tagline, featured_title)
VALUES (
  gen_random_uuid(),
  'GraphicyCafe',
  'Fresh brewed, 3D viewed',
  'The chef''s table'
);

-- 4. Insert default theme
INSERT INTO theme_settings (id, color_background, color_surface, color_ivory, color_ivory_dim, color_amber, color_ember, color_line)
VALUES (
  gen_random_uuid(),
  '#17140F',
  '#211C15',
  '#F3ECDD',
  '#C9BFA9',
  '#E3A63D',
  '#C2542A',
  'rgba(243,236,221,0.12)'
);

-- 5. Insert sample categories
INSERT INTO categories (id, name, slug, display_order) VALUES
(gen_random_uuid(), 'Mains', 'mains', 1),
(gen_random_uuid(), 'Desserts', 'desserts', 2),
(gen_random_uuid(), 'Starters', 'starters', 3),
(gen_random_uuid(), 'Drinks', 'drinks', 4);

-- 6. Insert sample products
INSERT INTO products (id, name, slug, description, price, category_id, stock_quantity, images, dietary_tags, is_active) 
SELECT 
  gen_random_uuid(),
  'Charred Miso Salmon',
  'charred-miso-salmon',
  'Cedar-charred salmon with miso glaze, served with seasonal vegetables.',
  28.00,
  (SELECT id FROM categories WHERE slug = 'mains' LIMIT 1),
  15,
  '["https://picsum.photos/seed/salmon/400/300"]',
  '["gluten-free"]',
  true;

INSERT INTO products (id, name, slug, description, price, category_id, stock_quantity, images, dietary_tags, is_active) 
SELECT 
  gen_random_uuid(),
  'Layer Cake',
  'layer-cake',
  'A festive layered cake with chocolate ganache and fresh berries.',
  18.00,
  (SELECT id FROM categories WHERE slug = 'desserts' LIMIT 1),
  8,
  '["https://picsum.photos/seed/cake/400/300"]',
  '["vegetarian"]',
  true;

INSERT INTO products (id, name, slug, description, price, category_id, stock_quantity, images, dietary_tags, is_active) 
SELECT 
  gen_random_uuid(),
  'Ember Short Rib',
  'ember-short-rib',
  '36-hour braised beef finished over charcoal, with garlic mashed potatoes.',
  32.00,
  (SELECT id FROM categories WHERE slug = 'mains' LIMIT 1),
  10,
  '["https://picsum.photos/seed/shortrib/400/300"]',
  '[]',
  true;

INSERT INTO products (id, name, slug, description, price, category_id, stock_quantity, images, dietary_tags, is_active) 
SELECT 
  gen_random_uuid(),
  'Smoked Eggplant',
  'smoked-eggplant',
  'Smoked eggplant with miso butter and chili oil.',
  19.00,
  (SELECT id FROM categories WHERE slug = 'starters' LIMIT 1),
  12,
  '["https://picsum.photos/seed/eggplant/400/300"]',
  '["vegan", "gluten-free"]',
  true;

-- 7. Insert sample featured sections
INSERT INTO featured_sections (id, section_key, title, display_order, is_visible) VALUES
(gen_random_uuid(), 'hero_banner', 'Hero Banner', 1, true),
(gen_random_uuid(), 'featured_dishes', 'Featured Dishes', 2, true),
(gen_random_uuid(), 'chef_picks', 'Chef''s Picks', 3, true);

-- 8. Seed page_content — every ckey referenced by the frontend, with the
--    current hardcoded copy as its default value, so nothing visually
--    changes until an admin edits something. ON CONFLICT guards re-running.
INSERT INTO page_content (page, ckey, field_type, value) VALUES
-- global (header/footer, shared across every page)
('global', 'nav_1', 'text', 'Menu'),
('global', 'nav_2', 'text', 'Offers'),
('global', 'nav_3', 'text', '3D Preview'),
('global', 'nav_4', 'text', 'About'),
('global', 'footer_tagline', 'text', 'Wood-fired mains and seasonal plates, now previewable in AR before you order.'),
('global', 'footer_explore_1', 'text', 'Full menu'),
('global', 'footer_explore_2', 'text', 'Offers'),
('global', 'footer_explore_3', 'text', 'Gift cards'),
('global', 'footer_explore_4', 'text', '3D preview'),
('global', 'footer_support_1', 'text', 'Track order'),
('global', 'footer_support_2', 'text', 'Delivery areas'),
('global', 'footer_support_3', 'text', 'Contact us'),
('global', 'footer_support_4', 'text', 'FAQ'),
('global', 'footer_copyright', 'text', '© 2026 GraphicyCafe'),
-- index (home page)
('index', 'offers_eyebrow', 'text', 'Right now'),
('index', 'products_eyebrow', 'text', 'Browse'),
('index', 'products_title', 'text', 'The full menu'),
('index', 'products_link_text', 'text', 'View all →'),
('index', 'gallery_eyebrow', 'text', 'Preview before you order'),
('index', 'gallery_title', 'text', '3D menu card gallery'),
('index', 'gallery_link_text', 'text', 'Open full AR menu →'),
('index', 'testimonials_eyebrow', 'text', 'From our guests'),
('index', 'testimonials_title', 'text', 'What people are saying'),
('index', 'trust_item_1', 'text', '3D preview on every dish'),
('index', 'trust_item_2', 'text', 'Contactless delivery'),
('index', 'trust_item_3', 'text', 'Fresh, sourced daily'),
('index', 'trust_item_4', 'text', 'Secure checkout'),
('index', 'newsletter_eyebrow', 'text', 'Stay in the loop'),
('index', 'newsletter_title', 'text', 'First to know about new menu drops'),
('index', 'newsletter_description', 'text', 'One email a month, mostly about food. No spam.'),
('index', 'newsletter_button_text', 'text', 'Subscribe'),
-- products (menu/listing page)
('products', 'page_title', 'text', 'Full menu'),
-- product-details
('product-details', 'tab_description', 'text', 'Description'),
('product-details', 'tab_reviews', 'text', 'Reviews'),
('product-details', 'tab_similar', 'text', 'Similar Products'),
('product-details', 'mode_3d', 'text', 'View 3D'),
('product-details', 'mode_simple_ar', 'text', 'Simple AR'),
('product-details', 'mode_advanced_ar', 'text', 'Advanced AR'),
-- cart (widget preview page)
('cart', 'title', 'text', 'Your Cart'),
('cart', 'empty_title', 'text', 'Your cart is empty'),
('cart', 'empty_desc', 'text', 'Browse our menu and add your favorite dishes.'),
('cart', 'empty_button', 'text', 'Browse menu'),
('cart', 'label_subtotal', 'text', 'Subtotal'),
('cart', 'label_delivery', 'text', 'Delivery'),
('cart', 'label_tax', 'text', 'Tax (8%)'),
('cart', 'label_total', 'text', 'Total'),
('cart', 'button_checkout', 'text', 'Proceed to checkout'),
('cart', 'button_clear', 'text', 'Clear'),
-- review (widget preview page)
('review', 'heading', 'text', 'Write a review'),
('review', 'subtitle', 'text', 'Share your experience with this dish'),
('review', 'email_hint', 'text', 'We''ll never share your email with anyone.'),
('review', 'photo_hint', 'text', 'Upload up to 5 photos of the dish (JPEG, PNG, WebP)'),
('review', 'success_title', 'text', 'Review submitted!'),
('review', 'success_desc', 'text', 'Thank you for sharing your experience. Your review will help others discover great dishes.'),
('review', 'button_submit', 'text', 'Submit review'),
('review', 'button_cancel', 'text', 'Cancel'),
-- bot (AI assistant widget preview page)
('bot', 'name', 'text', 'Graphicy Assistant'),
('bot', 'status', 'text', 'Online'),
('bot', 'welcome_message', 'richtext', '👋 Hi there! I''m your Graphicy assistant.
I can help you:
• Find dishes on our menu
• Answer questions about ingredients
• Check order status
• Recommend something delicious

What can I help you with today?'),
('bot', 'quick_action_1', 'text', '🍽️ Special'),
('bot', 'quick_action_2', 'text', '📋 Menu'),
('bot', 'quick_action_3', 'text', '🌟 Recommend'),
('bot', 'quick_action_4', 'text', '📦 Track order'),
('bot', 'input_placeholder', 'text', 'Type your message...')
ON CONFLICT (page, ckey) DO NOTHING;

-- 9. Seed testimonials (migrated from the hardcoded array in index.html)
INSERT INTO testimonials (name, initials, role, quote, stars, display_order, is_visible) VALUES
('Aisha K.', 'AK', 'Verified order', 'Being able to see the short rib in 3D before ordering sold me on it instantly.', 5, 1, true),
('Ravi M.', 'RM', 'Verified order', 'The salmon lives up to the hype, and the AR preview meant zero surprises at the table.', 5, 2, true),
('Tara L.', 'TL', 'Verified order', 'Ordered the cake for a birthday after previewing it in AR on our own dining table — exact match.', 4, 3, true);