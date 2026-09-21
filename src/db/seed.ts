import "dotenv/config";
import { db } from "./index";
import { menuItems, orders, restaurants } from "./schema";

const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;

/* ------------------------------ image pools ------------------------------ */
const BURGERS = [24554391, 18987002, 28376179, 28828555, 10914838, 11022623, 28760166, 12325274].map(px);
const PIZZA = [8471699, 37290096, 13736876, 36430040, 18126715].map(px);
const SUSHI = [31415299, 11064614, 12878171, 4724481, 31388920, 31393436].map(px);
const INDIAN = [28674660, 34484975, 37883423, 17050759, 34159107, 28909537].map(px);
const RAMEN = [31393431, 33312313, 31393433, 1907227, 26510357, 1907229].map(px);
const DESSERT = [8601851, 11774178, 5702858, 3740193, 38897439, 32789045].map(px);
const TACOS = [36498697, 36498696, 33614219, 33614213, 36498704].map(px);
const SALAD = [27612521, 4958944, 7660437, 5966438, 5514820].map(px);
const FRIED = [9872916, 15910249, 33068077, 5652264, 37228290].map(px);
const DRINKS = [4869289, 8178560, 31424521, 32088360, 9479999].map(px);
const PASTA = [12039747, 17243892, 37726976, 11209143, 36430164].map(px);

type ItemDef = [
  category: string,
  name: string,
  price: number,
  description: string,
  img: string,
  isVeg?: boolean,
  isBestseller?: boolean,
];

interface RestaurantDef {
  slug: string;
  name: string;
  tagline: string;
  cuisines: string[];
  rating: number;
  ratingsCount: number;
  priceLevel: number;
  deliveryMinutes: number;
  distanceKm: number;
  offer: string | null;
  offerPercent?: number;
  offerMaxCents?: number;
  imageUrl: string;
  heroUrl: string;
  featured?: boolean;
  pureVeg?: boolean;
  locality: string;
  /** Set to false to hide this restaurant from the marketplace (soft-hide). */
  active?: boolean;
  items: ItemDef[];
}

const DATA: RestaurantDef[] = [
  {
    slug: "ember-and-oak",
    name: "Ember & Oak",
    tagline: "Smash burgers over live fire",
    cuisines: ["Burgers", "American"],
    rating: 4.7,
    ratingsCount: 2430,
    priceLevel: 2,
    deliveryMinutes: 25,
    distanceKm: 1.2,
    offer: "50% OFF up to ₹120",
    offerPercent: 50,
    offerMaxCents: 12000,
    imageUrl: BURGERS[3],
    heroUrl: BURGERS[0],
    featured: true,
    locality: "Old City",
    items: [
      ["Recommended", "The Oak Smash", 329, "Double smashed patty, aged cheddar, burnt-onion mayo, potato bun.", BURGERS[4], false, true],
      ["Recommended", "Ember Stack", 399, "Triple layer, charred jalapeño relish, smoked gouda.", BURGERS[1], false, true],
      ["Burgers", "Blue Ridge Melt", 349, "Bacon jam, blue cheese cream, rocket leaves.", BURGERS[5]],
      ["Burgers", "Garden Smash", 289, "Crisp veggie patty, chipotle aioli, pickled onion.", BURGERS[2], true],
      ["Sides", "Truffle Fries", 189, "Hand-cut fries, truffle oil, parmesan snow.", BURGERS[6], true, true],
      ["Sides", "Fire Wings", 259, "Smoked chicken wings tossed in ember hot sauce.", FRIED[4]],
      ["Shakes", "Burnt Caramel Shake", 219, "Slow-burnt caramel, vanilla bean, sea salt.", DRINKS[4], true],
      ["Desserts", "S'mores Brownie", 199, "Torched marshmallow, dark chocolate, graham crumble.", DESSERT[1], true],
    ],
  },
  {
    slug: "crust-theory",
    name: "Crust Theory",
    tagline: "72-hour dough, wood-fired at 450°",
    cuisines: ["Pizza", "Italian"],
    rating: 4.5,
    ratingsCount: 1820,
    priceLevel: 3,
    deliveryMinutes: 35,
    distanceKm: 2.4,
    offer: "Flat ₹150 OFF above ₹499",
    offerPercent: 0,
    offerMaxCents: 15000,
    imageUrl: PIZZA[0],
    heroUrl: PIZZA[2],
    featured: true,
    locality: "Zadeshwar",
    items: [
      ["Recommended", "Margherita Fiamma", 425, "San Marzano tomato, fior di latte, basil, cold-pressed olive oil.", PIZZA[0], true, true],
      ["Recommended", "Diavola", 545, "Spicy salami, calabrian chilli honey, smoked mozzarella.", PIZZA[2], false, true],
      ["Wood-fired Pizzas", "Funghi e Taleggio", 565, "Roasted forest mushrooms, taleggio, thyme.", PIZZA[4], true],
      ["Wood-fired Pizzas", "Quattro Formaggi", 595, "Four cheese blend, walnut crumble, acacia honey.", PIZZA[0], true],
      ["Small Plates", "Charred Sourdough & Burrata", 345, "Blistered tomatoes, basil oil, sea salt.", PIZZA[1], true],
      ["Small Plates", "Baked Meatballs", 365, "Pork & fennel meatballs in Sunday sugo.", PIZZA[3]],
      ["Desserts", "Nutella Calzone", 285, "Wood-fired calzone, roasted hazelnut, vanilla gelato.", DESSERT[4], true],
      ["Beverages", "Sparkling Blood Orange", 149, "Sicilian blood orange soda, rosemary.", DRINKS[0], true],
    ],
  },
  {
    slug: "nori-house",
    name: "Nori House",
    tagline: "Tokyo-style sushi & izakaya",
    cuisines: ["Sushi", "Japanese"],
    rating: 4.8,
    ratingsCount: 960,
    priceLevel: 3,
    deliveryMinutes: 30,
    distanceKm: 3.1,
    offer: "Free edamame on ₹799+",
    imageUrl: SUSHI[0],
    heroUrl: SUSHI[5],
    featured: true,
    locality: "Old City",
    items: [
      ["Recommended", "Omakase Platter · 12 pc", 899, "Chef's selection of nigiri, maki & sashimi.", SUSHI[5], false, true],
      ["Recommended", "Salmon Aburi Nigiri · 6 pc", 549, "Torched salmon belly, yuzu kosho, nikiri soy.", SUSHI[2], false, true],
      ["Signature Rolls", "Volcano Roll", 499, "Crunchy spicy tuna, lava sauce, tobiko.", SUSHI[1]],
      ["Signature Rolls", "Rainbow Dragon", 579, "Eel, avocado, assorted sashimi crown.", SUSHI[3]],
      ["Signature Rolls", "Veggie Tempura Roll", 399, "Crisp vegetables, spicy mayo, teriyaki.", SUSHI[4], true],
      ["Izakaya", "Chicken Karaage", 349, "Double-fried chicken, wasabi mayo, lemon.", FRIED[0]],
      ["Izakaya", "Chashu Ramen", 459, "12-hour tonkotsu broth, ajitama, nori.", RAMEN[0], false, true],
      ["Desserts", "Matcha Tiramisu", 299, "Ceremonial matcha, mascarpone cloud.", DESSERT[3], true],
    ],
  },
  {
    slug: "spice-route",
    name: "Spice Route",
    tagline: "Old Delhi recipes, charcoal tandoor",
    cuisines: ["North Indian", "Kebabs"],
    rating: 4.6,
    ratingsCount: 5210,
    priceLevel: 2,
    deliveryMinutes: 25,
    distanceKm: 0.9,
    offer: "20% OFF up to ₹100",
    offerPercent: 20,
    offerMaxCents: 10000,
    imageUrl: INDIAN[3],
    heroUrl: INDIAN[1],
    featured: true,
    locality: "Old City",
    items: [
      ["Recommended", "Butter Chicken 1962", 389, "Charcoal tikka, tomato-makhan velvet, kasuri methi.", INDIAN[3], false, true],
      ["Recommended", "Galouti Kebab", 419, "Melt-in-mouth lamb kebab, saffron sheermal.", INDIAN[5], false, true],
      ["Tandoor", "Angar Paneer Tikka", 319, "Fire-kissed cottage cheese, mint chutney.", INDIAN[4], true],
      ["Tandoor", "Tandoori Wings", 299, "Overnight marinade, clay-oven char.", FRIED[0]],
      ["Mains", "Dal-e-Route", 269, "48-hour black dal, white butter, cream.", INDIAN[1], true, true],
      ["Mains", "Subz Miloni", 289, "Seasonal vegetables, cashew korma gravy.", INDIAN[4], true],
      ["Breads & Rice", "Truffle Naan", 129, "Buttered naan kissed with truffle oil.", PIZZA[1], true],
      ["Desserts", "Rasmalai Tres Leches", 199, "Saffron milk cake, pistachio dust.", DESSERT[2], true],
    ],
  },
  {
    slug: "biryani-works",
    name: "Biryani Works",
    tagline: "Dum-sealed handis, single origin rice",
    cuisines: ["Biryani", "Hyderabadi"],
    rating: 4.4,
    ratingsCount: 8640,
    priceLevel: 2,
    deliveryMinutes: 30,
    distanceKm: 1.8,
    offer: "₹75 OFF above ₹349",
    offerPercent: 0,
    offerMaxCents: 7500,
    imageUrl: INDIAN[0],
    heroUrl: INDIAN[2],
    locality: "Maktampur",
    items: [
      ["Recommended", "Hyderabadi Chicken Dum", 329, "Aged basmati, saffron milk, brown onion, mirchi ka salan.", INDIAN[0], false, true],
      ["Recommended", "Raan Biryani", 549, "Slow-braised lamb shank, royal spices, edible silver.", INDIAN[2], false, true],
      ["Handi Biryanis", "Subz Dum Biryani", 279, "Garden vegetables, rose water, mint raita.", INDIAN[1], true],
      ["Handi Biryanis", "Egg Pepper Biryani", 249, "Cracked pepper masala, curry leaf tempering.", INDIAN[5]],
      ["Companions", "Mirchi ka Salan", 79, "Peanut-sesame chilli curry.", INDIAN[4], true],
      ["Companions", "Burhani Raita", 69, "Garlic-whipped yogurt, roasted cumin.", DRINKS[0], true],
      ["Desserts", "Qubani ka Meetha", 159, "Stewed apricots, malai, almond slivers.", DESSERT[5], true],
      ["Beverages", "Kesar Badam Milk", 139, "Saffron almond milk served chilled.", DRINKS[4], true],
    ],
  },
  {
    slug: "ramen-district",
    name: "Ramen District",
    tagline: "Broths simmered 18 hours, noodles pulled daily",
    cuisines: ["Ramen", "Asian"],
    rating: 4.7,
    ratingsCount: 1210,
    priceLevel: 2,
    deliveryMinutes: 20,
    distanceKm: 1.1,
    offer: null,
    imageUrl: RAMEN[0],
    heroUrl: RAMEN[2],
    featured: true,
    locality: "Old City",
    items: [
      ["Recommended", "Tonkotsu Black", 449, "Rich pork broth, black garlic oil, chashu, ajitama.", RAMEN[4], false, true],
      ["Recommended", "Spicy Miso Bomb", 429, "Miso tare, chilli paste, buttered corn, minced chicken.", RAMEN[2], false, true],
      ["Ramen", "Shoyu Classic", 399, "Clear shoyu broth, bamboo, nori, soft egg.", RAMEN[0]],
      ["Ramen", "Tantanmen", 419, "Sesame-peanut broth, spiced pork, bok choy.", RAMEN[5]],
      ["Ramen", "Garden Shio", 369, "Light sea-salt broth, seasonal greens, tofu.", RAMEN[1], true],
      ["Small Plates", "Gyoza · 6 pc", 289, "Pan-seared chicken dumplings, ponzu dip.", RAMEN[3]],
      ["Small Plates", "Edamame Truffle Salt", 189, "Steamed young soybeans, truffle salt.", SALAD[4], true],
      ["Beverages", "Yuzu Cooler", 159, "Japanese citrus soda, shiso leaf.", DRINKS[0], true],
    ],
  },
  {
    slug: "the-velvet-crumb",
    name: "The Velvet Crumb",
    tagline: "Small-batch patisserie, baked at dawn",
    cuisines: ["Desserts", "Bakery"],
    rating: 4.9,
    ratingsCount: 640,
    priceLevel: 2,
    deliveryMinutes: 25,
    distanceKm: 2.2,
    offer: "Flat ₹100 OFF above ₹399",
    offerPercent: 0,
    offerMaxCents: 10000,
    imageUrl: DESSERT[2],
    heroUrl: DESSERT[0],
    locality: "Zadeshwar",
    pureVeg: true,
    items: [
      ["Recommended", "Midnight Mousse Cake", 349, "70% dark chocolate mousse, hazelnut praline core.", DESSERT[0], true, true],
      ["Recommended", "Blueberry Noir Cheesecake", 379, "Baked cheesecake, macerated blueberries, cocoa soil.", DESSERT[2], true, true],
      ["Patisserie", "Chocolate Crepe Cake", 329, "Twenty layers, chocolate chantilly, cocoa drizzle.", DESSERT[4], true],
      ["Patisserie", "Victoria Slice", 289, "Classic tea cake, raspberry jam, vanilla cream.", DESSERT[3], true],
      ["Patisserie", "Vintage Fudge Cake", 319, "Old-school fudge icing, candied walnuts.", DESSERT[5], true],
      ["Bakery", "Butter Croissant", 149, "Laminated 96 layers, French butter.", DESSERT[1], true],
      ["Bakery", "Sea Salt Cookies · 4 pc", 179, "Brown butter, dark chocolate pools, flaky salt.", DESSERT[3], true],
      ["Beverages", "Iced Mocha", 199, "Double espresso, chocolate, cold milk.", DRINKS[0], true],
    ],
  },
  {
    slug: "verde-kitchen",
    name: "Verde Kitchen",
    tagline: "Farm bowls & cold-pressed juices",
    cuisines: ["Healthy", "Salads"],
    rating: 4.3,
    ratingsCount: 780,
    priceLevel: 2,
    deliveryMinutes: 15,
    distanceKm: 0.6,
    offer: null,
    imageUrl: SALAD[2],
    heroUrl: SALAD[0],
    pureVeg: true,
    locality: "Old City",
    items: [
      ["Recommended", "Harvest Buddha Bowl", 349, "Quinoa, roast pumpkin, avocado, tahini drizzle.", SALAD[2], true, true],
      ["Recommended", "Falafel Garden", 319, "Crisp falafel, pickled veg, hummus, sumac onions.", SALAD[1], true, true],
      ["Bowls", "Rainbow Crunch", 299, "Shredded seasonal veg, citrus-kosho dressing.", SALAD[0], true],
      ["Bowls", "Charred Corn & Bean", 289, "Fire-roasted corn, black beans, lime crema.", SALAD[4], true],
      ["Bowls", "Heirloom Tomato Panzanella", 329, "Torn sourdough, basil, cold-pressed olive oil.", SALAD[3], true],
      ["Juices", "Green Reset", 179, "Kale, green apple, cucumber, ginger.", DRINKS[4], true],
      ["Juices", "Sunset Citrus", 169, "Orange, carrot, turmeric shoot.", DRINKS[0], true],
      ["Desserts", "Cacao Chia Parfait", 199, "Overnight chia, raw cacao, coconut cream.", DESSERT[2], true],
    ],
  },
  {
    slug: "la-calle",
    name: "La Calle",
    tagline: "Mexico City street taquería",
    cuisines: ["Mexican", "Tacos"],
    rating: 4.5,
    ratingsCount: 1530,
    priceLevel: 2,
    deliveryMinutes: 25,
    distanceKm: 1.5,
    offer: "Free churros on ₹599+",
    imageUrl: TACOS[3],
    heroUrl: TACOS[1],
    locality: "Zadeshwar",
    items: [
      ["Recommended", "Baja Shrimp Tacos · 3", 399, "Crisp shrimp, chipotle crema, mango slaw.", TACOS[2], false, true],
      ["Recommended", "Pollo al Pastor · 3", 349, "Achiote chicken, grilled pineapple, salsa verde.", TACOS[1], false, true],
      ["Tacos", "Guac & Black Bean · 3", 299, "Smashed guacamole, spiced beans, radish.", TACOS[4], true],
      ["Tacos", "Carnitas Street Taco · 3", 379, "Slow pork confit, onion, cilantro, lime.", TACOS[0]],
      ["Mains", "Smothered Burrito", 429, "Wet burrito, ranchero sauce, jack cheese.", TACOS[3]],
      ["Mains", "Elote Bowl", 279, "Charred street corn, cotija, tajín butter.", SALAD[4], true],
      ["Desserts", "Churros con Chocolate", 229, "Cinnamon sugar churros, dark chocolate dip.", DESSERT[1], true],
      ["Beverages", "Horchata", 159, "Cinnamon rice milk, vanilla.", DRINKS[1], true],
    ],
  },
  {
    slug: "the-fryer-club",
    name: "The Fryer Club",
    tagline: "Buttermilk-brined, twice-fried",
    cuisines: ["Fried Chicken", "Fast Food"],
    rating: 4.2,
    ratingsCount: 3940,
    priceLevel: 1,
    deliveryMinutes: 20,
    distanceKm: 1.0,
    offer: "40% OFF up to ₹80",
    offerPercent: 40,
    offerMaxCents: 8000,
    imageUrl: FRIED[0],
    heroUrl: FRIED[1],
    locality: "Old City",
    items: [
      ["Recommended", "Nashville Hot Tenders", 289, "Cayenne-dusted tenders, comeback sauce, pickles.", FRIED[2], false, true],
      ["Recommended", "The Club Bucket · 8 pc", 549, "Signature twice-fried chicken, house dips.", FRIED[1], false, true],
      ["Fried", "Golden Drumsticks · 4", 259, "24-hour brine, crackly crust, honey drizzle.", FRIED[3]],
      ["Fried", "Tenders & Fries Box", 319, "Crinkle fries, two dips, slaw.", FRIED[4]],
      ["Burgers", "Crispy Chicken Burger", 249, "Buttermilk thigh, ghost pepper mayo, brioche.", BURGERS[7]],
      ["Sides", "Mac & Cheese Bites", 199, "Molten cheddar core, marinara dip.", FRIED[2], true],
      ["Sides", "Seasoned Crinkle Fries", 129, "House spice blend, ketchup.", BURGERS[6], true],
      ["Shakes", "Cookies & Cream Shake", 189, "Vanilla soft serve, crushed cookies.", DRINKS[4], true],
    ],
  },
  {
    slug: "osteria-lume",
    name: "Osteria Lume",
    tagline: "Handmade pasta, candle-lit recipes",
    cuisines: ["Italian", "Pasta"],
    rating: 4.6,
    ratingsCount: 540,
    priceLevel: 3,
    deliveryMinutes: 35,
    distanceKm: 3.5,
    offer: null,
    imageUrl: PASTA[0],
    heroUrl: PASTA[2],
    featured: true,
    locality: "Zadeshwar",
    items: [
      ["Recommended", "Tagliatelle al Pomodoro", 545, "Hand-cut pasta, datterini tomato, basil, parmesan.", PASTA[0], true, true],
      ["Recommended", "Fettuccine Funghi", 585, "Wild mushroom cream, truffle pecorino.", PASTA[2], true, true],
      ["Pasta", "Vongole Bianco", 645, "Fresh clams, white wine, parsley, lemon zest.", PASTA[1]],
      ["Pasta", "Rigatoni alla Vodka", 565, "Tomato-vodka crema, calabrian chilli.", PASTA[4], true],
      ["Pasta", "Lasagna della Casa", 595, "Slow ragù, béchamel, 48-hour flavor.", PASTA[3]],
      ["Small Plates", "Burrata & Heirlooms", 445, "Puglian burrata, basil oil, aged balsamic.", SALAD[3], true],
      ["Desserts", "Classic Tiramisu", 349, "Espresso-soaked savoiardi, mascarpone, cocoa.", DESSERT[3], true],
      ["Beverages", "Italian Soda", 169, "Blood orange & rosemary soda.", DRINKS[2], true],
    ],
  },
  {
    slug: "bean-and-leaf",
    name: "Bean & Leaf",
    tagline: "Third-wave coffee & all-day sips",
    cuisines: ["Cafe", "Beverages"],
    rating: 4.4,
    ratingsCount: 2110,
    priceLevel: 1,
    deliveryMinutes: 15,
    distanceKm: 0.8,
    offer: null,
    imageUrl: DRINKS[0],
    heroUrl: DRINKS[2],
    locality: "Old City",
    items: [
      ["Recommended", "Vietnamese Iced Coffee", 189, "Slow-drip robusta, condensed milk silk.", DRINKS[0], true, true],
      ["Recommended", "Cold Brew Tonic", 209, "18-hour cold brew, citrus tonic, ice sphere.", DRINKS[1], true, true],
      ["Coffee", "Sea Salt Caramel Latte", 199, "Double shot, salted caramel, oat milk option.", DRINKS[4], true],
      ["Coffee", "Cortado", 159, "Equal parts espresso & steamed milk, 4 oz.", DRINKS[2], true],
      ["Coffee", "Filter Kaapi", 129, "South Indian degree coffee, frothy dabara style.", DRINKS[3], true],
      ["Bites", "Banana Espresso Bread", 149, "Warm slice, espresso butter.", DESSERT[5], true],
      ["Bites", "Avocado Toast", 249, "Sourdough, smashed avo, chilli crunch.", SALAD[1], true],
      ["Desserts", "Affogato", 179, "Vanilla gelato drowned in espresso.", DESSERT[1], true],
    ],
  },
];

/* --------------------------------- seed ---------------------------------- */

async function seed() {
  console.log("Clearing existing data…");
  await db.delete(orders);
  await db.delete(menuItems);
  await db.delete(restaurants);

  console.log(`Seeding ${DATA.length} restaurants…`);
  for (const def of DATA) {
    const { items, active, ...rest } = def;
    const [row] = await db
      .insert(restaurants)
      .values({ ...rest, isActive: active ?? true, offerPercent: def.offerPercent ?? 0, offerMaxCents: def.offerMaxCents ?? 0 })
      .returning();
    await db.insert(menuItems).values(
      items.map((it, i) => ({
        restaurantId: row.id,
        category: it[0],
        name: it[1],
        priceCents: Math.round(it[2] * 100),
        description: it[3],
        imageUrl: it[4],
        isVeg: it[5] ?? false,
        isBestseller: it[6] ?? false,
        sort: i,
      })),
    );
    console.log(`  ✓ ${def.name} (${items.length} dishes)`);
  }
  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
