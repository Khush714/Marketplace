// Phase 0 & Phase 1 deliverables, rendered live in the app so the audit is
// testable and versioned alongside the code it describes.

export type ReuseLevel = "reuse" | "extend" | "new";

export type CapabilityRow = {
  requirement: string;
  posCapability: string;
  table: string;
  reuse: ReuseLevel;
  modification: string;
};

export const capabilityMatrix: CapabilityRow[] = [
  {
    requirement: "Restaurant listing",
    posCapability: "Restaurant records already exist in POS core",
    table: "restaurants + restaurant_marketplace_profiles",
    reuse: "extend",
    modification: "Listing state moved into a 1:1 marketplace profile",
  },
  {
    requirement: "Restaurant profile",
    posCapability: "Restaurant + address + open state",
    table: "restaurants",
    reuse: "reuse",
    modification: "None — read-only projection for storefront",
  },
  {
    requirement: "Menu",
    posCapability: "Menu categories & items power the POS ticket screen",
    table: "categories, menu_items",
    reuse: "reuse",
    modification: "Expose isAvailable / isPopular to storefront only",
  },
  {
    requirement: "Cart",
    posCapability: "No POS equivalent (POS uses in-session ticket)",
    table: "(client-side)",
    reuse: "new",
    modification: "New client cart state, persisted per browser",
  },
  {
    requirement: "Orders",
    posCapability: "POS writes orders + order_items",
    table: "orders, order_items",
    reuse: "extend",
    modification: "Add channel='marketplace' + reference + delivery fields",
  },
  {
    requirement: "Customers",
    posCapability: "Customer directory exists",
    table: "customers",
    reuse: "reuse",
    modification: "Unique phone + orders.customer_id FK (was loose text)",
  },
  {
    requirement: "Payments",
    posCapability: "Payment method captured on ticket",
    table: "orders.paymentMethod/paymentStatus",
    reuse: "extend",
    modification: "Support online/cash-on-delivery statuses",
  },
  {
    requirement: "Reviews",
    posCapability: "Table existed; had no purchase linkage",
    table: "reviews",
    reuse: "extend",
    modification: "Added customer_id, order_id, is_verified (not a 2nd table)",
  },
  {
    requirement: "Fulfilment (delivery/pickup)",
    posCapability: "POS had no channel concept",
    table: "orders.fulfillment_type + profile toggles",
    reuse: "new",
    modification: "Pickup waives the delivery fee",
  },
];

export type ChecklistItem = { label: string; status: "pass" | "todo" };

export const baselineChecklist: ChecklistItem[] = [
  { label: "Branch marketplace-v1 created", status: "pass" },
  { label: "POS core schema defined & migrated", status: "pass" },
  { label: "Build passes (next build)", status: "pass" },
  { label: "Health endpoint /api/health returns ok", status: "pass" },
  { label: "Menu / order / customer structures documented", status: "pass" },
  { label: "Regression checklist recorded", status: "pass" },
];

export type PhaseCard = {
  id: string;
  title: string;
  goal: string;
  state: "done" | "active" | "next";
  points: string[];
};

export const phases: PhaseCard[] = [
  {
    id: "P0",
    title: "Freeze & Baseline POS",
    goal: "Guarantee the existing POS is not broken.",
    state: "done",
    points: [
      "Clean branch marketplace-v1",
      "Build + test suite green",
      "Endpoints, tables, auth flow recorded",
      "Baseline regression checklist captured",
    ],
  },
  {
    id: "P1",
    title: "Architecture Audit",
    goal: "Know exactly what already exists before building.",
    state: "done",
    points: [
      "Inspect frontend / backend / database",
      "Map each marketplace requirement to POS capability",
      "Decide reuse vs extend vs new for every area",
    ],
  },
  {
    id: "P2",
    title: "Marketplace Data Model",
    goal: "Extend the DB only where necessary — zero duplication.",
    state: "done",
    points: [
      "New restaurant_marketplace_profiles (1:1 satellite)",
      "Moved listing/delivery fields OFF the POS table",
      "Extended reviews with customer_id + order_id",
      "orders now FK into the POS customer directory",
    ],
  },
  {
    id: "P2.5",
    title: "Storefront & Discovery",
    goal: "Public listing, cart, checkout, reviews.",
    state: "done",
    points: [
      "Discovery grid respects is_listed + marketplace_status",
      "Delivery / pickup fulfilment at checkout",
      "Verified reviews tied to a real order",
      "Listing control panel at /admin/listings",
    ],
  },
  {
    id: "P3",
    title: "Marketplace API Layer",
    goal: "Consumer APIs exposing customer-safe data only.",
    state: "done",
    points: [
      "/api/marketplace/restaurants (+/:id, /menu, /reviews)",
      "/api/marketplace/orders (POST + GET)",
      "/api/marketplace/reviews, /categories, /search",
      "Allowlist projection + runtime leak tripwire",
    ],
  },
  {
    id: "P4",
    title: "Restaurant Onboarding",
    goal: "Restaurant admin self-publishes to the marketplace.",
    state: "done",
    points: [
      "List-my-restaurant switch sets is_listed = true",
      "Description, cuisine, price range, image upload",
      "Accept online orders / pickup / delivery toggles",
      "Image uploads stored durably and served via /api/media/:id",
    ],
  },
  {
    id: "P5",
    title: "Consumer App Shell (TABLZ)",
    goal: "Responsive PWA with the full consumer route map.",
    state: "done",
    points: [
      "/ /restaurants /restaurants/:id(/menu)",
      "/cart /checkout /orders /orders/:id /profile",
      "Installable PWA: manifest, icons, offline shell",
      "Mobile tab bar + desktop header",
    ],
  },
  {
    id: "P6",
    title: "Restaurant Discovery",
    goal: "Listing cards with rating, cuisine, price, availability.",
    state: "done",
    points: [
      "Card: image, name, ★ rating • reviews, cuisines, price",
      "Open/closed + ORDER ONLINE availability",
      "Sort: recommended / nearby / top rated / most reviewed",
      "Distance, offers & personalisation deferred",
    ],
  },
  {
    id: "P7",
    title: "Restaurant Profile",
    goal: "Clicking a restaurant opens its digital storefront.",
    state: "done",
    points: [
      "Hero image, name, ★ rating • reviews, cuisine • price, OPEN badge",
      "ORDER ONLINE CTA prominent on storefront",
      "About / Reviews / Photos tabs — all from POS data",
      "Photos sourced from menu_items.image_url, no second gallery DB",
    ],
  },
  {
    id: "P8",
    title: "POS Menu Integration",
    goal: "ORDER ONLINE retrieves existing POS menu — no duplication.",
    state: "done",
    points: [
      "Restaurant → restaurant_id → categories + menu_items → Marketplace menu",
      "Zero marketplace_menu tables — POS remains source of truth",
      "Menu grouped as STARTERS / MAIN COURSE etc, price + [ + ] per spec",
      "Audit endpoint /api/marketplace/menu-audit proves no duplication",
    ],
  },
  {
    id: "P9",
    title: "Cart (Modifiers · Taxes · Discounts)",
    goal: "Full cart with POS-native pricing engine.",
    state: "done",
    points: [
      "menu_item_modifier_groups + menu_item_modifiers (POS)",
      "restaurants.tax_rate + discounts.code (POS)",
      "Shared priceCart() runs client + server → identical totals",
      "Modifiers picker → cart line → order snapshot",
    ],
  },
  {
    id: "P10",
    title: "Customer Authentication",
    goal: "Phone OTP + guest browsing (V1).",
    state: "done",
    points: [
      "POST /api/auth/otp/request + /verify + signed cookie",
      "customers is the SAME POS directory — no second identity store",
      "Saved addresses, saved restaurants, /api/me endpoints",
      "Guest checkout still works end-to-end",
    ],
  },
  {
    id: "P11",
    title: "Checkout",
    goal: "Details → Fulfilment → Address → Summary → Payment → Confirm.",
    state: "done",
    points: [
      "Multi-step wizard with progress bar",
      "Prefills from saved profile / address book",
      "Reuses existing POS payment states (paid / unpaid)",
      "Address auto-skipped for pickup",
    ],
  },
  {
    id: "P12",
    title: "Marketplace → POS Order Bridge",
    goal: "Marketplace orders land in the restaurant POS — zero re-entry.",
    state: "done",
    points: [
      "placeOrder writes the SAME orders rows + lifecycle event",
      "Per-restaurant POS key (SHA-256, shown once) via /api/pos/verify",
      "POS polls /api/pos/orders — items, modifiers, notes, totals",
      "POS queue UI at /admin/pos/[slug] with NEW ONLINE ORDER + ACCEPT",
    ],
  },
  {
    id: "P13",
    title: "Order Lifecycle",
    goal: "One consistent state machine shared by POS and customer.",
    state: "done",
    points: [
      "placed → accepted → preparing → ready → completed (+cancelled)",
      "transitionOrder() is the single writer; forward-only transitions",
      "Append-only order_status_events feeds both queues + tracker",
      "Customer can cancel only while still placed",
    ],
  },
  {
    id: "P14",
    title: "Reviews & Ratings",
    goal: "Only eligible completed orders can be reviewed.",
    state: "done",
    points: [
      "Completed-order + ownership + one-review-per-order enforced",
      "Rating = weighted avg (verified ×1, guest ×0.5), published only",
      "Admin moderation: publish / hold / hide → rating updates live",
      "Restaurants can reply; response renders on storefront",
    ],
  },
  {
    id: "P15",
    title: "Customer Order History",
    goal: "'My Orders' + detail with everything in one place.",
    state: "done",
    points: [
      "Signed-in: full history from /api/me/orders (customer_id)",
      "Card: restaurant, total, status, date, VIEW ORDER",
      "Detail: items, taxes, payment, status, ID, review, timeline",
      "One-tap REORDER seeds the cart with modifiers",
    ],
  },
  {
    id: "P16",
    title: "Restaurant Admin Marketplace Controls",
    goal: "Marketplace State lives inside the existing POS admin.",
    state: "done",
    points: [
      "Status 🟢 LIVE, visibility, online orders, pickup, delivery",
      "Reviews ★, marketplace order count, live count, revenue",
      "Links into POS queue + review moderation from one screen",
    ],
  },
  {
    id: "P17",
    title: "Platform Admin",
    goal: "Operator dashboard for restaurants, reviews, orders.",
    state: "done",
    points: [
      "All / Pending / Active / Suspended restaurant buckets",
      "Approve, Reject, Suspend, Feature, Hide controls",
      "Reported reviews + restaurant responses",
      "Live / completed / cancelled marketplace orders",
    ],
  },
  {
    id: "P17.5",
    title: "Search & Discovery",
    goal: "Search restaurant → cuisine → food item with filters.",
    state: "done",
    points: [
      "/search groups restaurant, cuisine, and dish hits",
      "Filters: cuisine, rating, price, vegetarian, open, pickup, delivery",
      "Dish search hits POS menu_items — no second catalog",
    ],
  },
  {
    id: "P19",
    title: "Location",
    goal: "Nearby restaurants, distance, delivery availability.",
    state: "done",
    points: [
      "restaurants.lat/lng + delivery_radius_km (POS-owned)",
      "Customer location → haversine distance",
      "deliversToYou when distance ≤ radius",
    ],
  },
  {
    id: "P20",
    title: "Offers & Loyalty",
    goal: "Public restaurant offers + Tablz points.",
    state: "done",
    points: [
      "Public offers reuse POS discounts (10% OFF, $10 above $50, free item)",
      "$500 order earns 50 Tablz points on completion",
      "Points live on the customer profile",
    ],
  },
  {
    id: "P21",
    title: "Notifications",
    goal: "Order lifecycle notifications with an outbox.",
    state: "done",
    points: [
      "order_placed, order_accepted, order_ready, order_completed, payment_successful",
      "Single notifications table + customer-visible /api/me/notifications",
      "Email/WhatsApp/SMS channels are Phase 24+ flush workers",
    ],
  },
  {
    id: "P22",
    title: "Security & Tenant Isolation",
    goal: "Aggressively verify cross-tenancy boundaries.",
    state: "done",
    points: [
      "/api/security-test runs 8 live probes (401, cross-customer 403, PII)",
      "POS keys are SHA-256 + constant-time compare",
      "Marketplace cannot expose internal POS data (existing audit path)",
    ],
  },
  {
    id: "P23",
    title: "Performance",
    goal: "Hot-path latency, indexes, duplicate-order prevention.",
    state: "done",
    points: [
      "/api/performance-test gates listing/menu/search/ping under budgets",
      "Idempotency keys stop duplicate orders on retry",
      "Indexes on orders.status, notifications, loyalty, idempotency",
    ],
  },
  {
    id: "P24",
    title: "Real Payment + Notification Delivery",
    goal: "Production payment gateway + live notification channels.",
    state: "next",
    points: [
      "Stripe/Razorpay payment intents + webhook -> payment_status",
      "Flush notifications outbox: Push / WhatsApp / SMS / Email",
      "Delivery retries + DLQ for failed notifications",
    ],
  },
  {
    id: "P26",
    title: "Discovery-only Pivot",
    goal: "Marketplace = discovery + reviews + menu-link/QR distribution. Ordering lives on the restaurant's own POS.",
    state: "done",
    points: [
      "restaurant_marketplace_profiles.menu_url (validated by normalizeMenuUrl)",
      "ORDER ONLINE ↗ deep-links to the POS in a new tab",
      "Cart / checkout / menu-browser / order UIs removed",
      "Legacy ordering APIs return 410 (code preserved under src/lib)",
      "QR endpoint /api/marketplace/restaurants/:id/qr for table cards",
    ],
  },
];

export const apiInventory = [
  { method: "GET", path: "/api/health", purpose: "Baseline liveness probe" },
  { method: "GET", path: "/api/restaurants", purpose: "List + filter storefront" },
  { method: "GET", path: "/api/restaurants/[slug]", purpose: "Profile + menu + reviews" },
  { method: "POST", path: "/api/restaurants/[slug]/reviews", purpose: "Create review" },
  { method: "POST", path: "/api/orders", purpose: "Place marketplace order" },
  { method: "GET", path: "/api/orders/[reference]", purpose: "Track a single order" },
  { method: "GET", path: "/api/admin/listings", purpose: "All profiles incl. unlisted" },
  { method: "PATCH", path: "/api/admin/listings", purpose: "Toggle listing / fulfilment" },
  { method: "GET", path: "/api/marketplace/restaurants", purpose: "Consumer list (search/filter/page)" },
  { method: "GET", path: "/api/marketplace/restaurants/:id", purpose: "Consumer profile (id or slug)" },
  { method: "GET", path: "/api/marketplace/restaurants/:id/menu", purpose: "Consumer menu" },
  { method: "GET", path: "/api/marketplace/restaurants/:id/reviews", purpose: "Consumer reviews" },
  { method: "POST", path: "/api/marketplace/orders", purpose: "Place order" },
  { method: "GET", path: "/api/marketplace/orders/:id", purpose: "Track order (id or ref)" },
  { method: "POST", path: "/api/marketplace/reviews", purpose: "Create review" },
  { method: "GET", path: "/api/marketplace/categories", purpose: "Cuisines + price ranges" },
  { method: "GET", path: "/api/marketplace/search", purpose: "Unified restaurant + dish search" },
  { method: "GET", path: "/api/marketplace/home", purpose: "Home rails + categories in one call" },
  { method: "GET", path: "/api/marketplace/audit", purpose: "Regression gate: no internal fields" },
  { method: "GET", path: "/api/marketplace/menu-audit", purpose: "Phase 8 proof: no second menu DB" },
  { method: "GET", path: "/api/marketplace/restaurants/:id/photos", purpose: "Photos from POS menu_items.image_url" },
  { method: "GET", path: "/api/admin/marketplace/:slug", purpose: "Owner onboarding state" },
  { method: "PUT", path: "/api/admin/marketplace/:slug", purpose: "SAVE onboarding form" },
  { method: "POST", path: "/api/admin/media", purpose: "Image upload (4 MB max)" },
  { method: "GET", path: "/api/media/:id", purpose: "Serve uploaded image" },
  { method: "GET", path: "/api/marketplace/restaurants/:id/discounts", purpose: "Preview a POS promo code" },
  { method: "POST", path: "/api/auth/otp/request", purpose: "Phone OTP challenge" },
  { method: "POST", path: "/api/auth/otp/verify", purpose: "Verify OTP + set session cookie" },
  { method: "GET", path: "/api/auth/me", purpose: "Current customer + addresses" },
  { method: "POST", path: "/api/auth/logout", purpose: "Clear session cookie" },
  { method: "GET/POST/DELETE", path: "/api/me/addresses", purpose: "Address book (auth)" },
  { method: "GET/POST/DELETE", path: "/api/me/saved", purpose: "Saved restaurants (auth)" },
  { method: "GET", path: "/api/me/orders", purpose: "Order history by customer_id (auth)" },
  { method: "GET", path: "/api/pos/verify", purpose: "POS key → restaurant identity" },
  { method: "GET", path: "/api/pos/orders", purpose: "POS order queue (bridge)" },
  { method: "POST", path: "/api/pos/orders/:ref/transition", purpose: "POS advances lifecycle" },
  { method: "POST", path: "/api/admin/pos/:slug/key", purpose: "Rotate POS key (shown once)" },
  { method: "POST", path: "/api/marketplace/orders/:id/cancel", purpose: "Customer cancels placed order" },
  { method: "GET", path: "/api/admin/reviews", purpose: "Review moderation queue" },
  { method: "PATCH", path: "/api/admin/reviews/:id", purpose: "Moderate + respond to review" },
  { method: "GET", path: "/api/admin/overview", purpose: "Operator KPIs" },
  { method: "GET", path: "/api/admin/orders", purpose: "Live/completed/cancelled marketplace orders" },
  { method: "GET", path: "/api/admin/reviews/reports", purpose: "Reported reviews queue" },
  { method: "POST", path: "/api/marketplace/reviews/:id/report", purpose: "Report a review" },
  { method: "GET", path: "/api/me/loyalty", purpose: "Tablz points + ledger" },
  { method: "GET", path: "/api/me/notifications", purpose: "Customer notification outbox" },
  { method: "GET", path: "/api/security-test", purpose: "Phase 22 tenant-isolation gate" },
  { method: "GET", path: "/api/performance-test", purpose: "Phase 23 latency budgets" },
  { method: "POST", path: "/api/web-vitals", purpose: "Client web-vitals intake" },
  { method: "POST", path: "/api/marketplace/orders", purpose: "410 Gone — ordering lives on the POS (deprecated)" },
  { method: "GET", path: "/api/marketplace/restaurants/:id/qr", purpose: "Scannable card for the storefront or POS menu URL" },
];

export const redactionRules = [
  { concern: "Inventory cost", enforced: "costPrice / unitCost / stock never selected" },
  { concern: "Staff information", enforced: "No staff tables joined into public queries" },
  { concern: "Restaurant financials", enforced: "revenue / margin / profit blocked by name" },
  { concern: "Supplier information", enforced: "supplier* keys blocked by name" },
  { concern: "Internal analytics", enforced: "channel / internalNotes / posConfig blocked" },
  { concern: "Other customers", enforced: "Reviews expose display name only, never PII" },
  { concern: "POS configuration", enforced: "posConfig / staffPin blocked by name" },
  { concern: "Commercial terms", enforced: "commissionRate never leaves the admin API" },
  { concern: "Internal relational ids", enforced: "restaurant_id / order_id / customer_id dropped" },
];

export type SchemaDecision = {
  field: string;
  verdict: "existed" | "moved" | "added";
  detail: string;
};

/** Phase 2: field-by-field ruling on the proposed marketplace entities. */
export const profileDecisions: SchemaDecision[] = [
  { field: "restaurant_id", verdict: "added", detail: "1:1 FK, unique constraint" },
  { field: "is_listed", verdict: "added", detail: "No POS equivalent" },
  { field: "description", verdict: "existed", detail: "restaurants.description — nullable override only" },
  { field: "cover_image", verdict: "existed", detail: "restaurants.image_url — nullable override only" },
  { field: "logo", verdict: "added", detail: "logo_url, marketplace-only branding" },
  { field: "cuisine", verdict: "existed", detail: "restaurants.cuisine — NOT duplicated" },
  { field: "price_range", verdict: "existed", detail: "restaurants.price_range — NOT duplicated" },
  { field: "accept_online_orders", verdict: "added", detail: "Gate on order creation" },
  { field: "accept_pickup", verdict: "added", detail: "Enables pickup fulfilment" },
  { field: "accept_delivery", verdict: "added", detail: "Enables delivery fulfilment" },
  { field: "marketplace_status", verdict: "added", detail: "draft | pending_review | live | suspended" },
  { field: "delivery_fee / min_order / eta_minutes", verdict: "moved", detail: "Relocated OFF restaurants — marketplace concern" },
  { field: "featured", verdict: "moved", detail: "restaurants.featured → profile.is_featured" },
];

export const reviewDecisions: SchemaDecision[] = [
  { field: "id", verdict: "existed", detail: "Already present" },
  { field: "restaurant_id", verdict: "existed", detail: "Already present" },
  { field: "customer_id", verdict: "added", detail: "FK to POS customers" },
  { field: "order_id", verdict: "added", detail: "FK to orders, one review per order" },
  { field: "rating", verdict: "existed", detail: "Already present" },
  { field: "review_text", verdict: "existed", detail: "Maps to existing `comment` column — not renamed" },
  { field: "created_at", verdict: "existed", detail: "Already present" },
  { field: "is_verified", verdict: "added", detail: "True when linked to a real order" },
];
