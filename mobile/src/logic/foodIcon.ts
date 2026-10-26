/**
 * The emoji shown for a food that has no photo: a straight port of iconForFood() in templates/nutrition.html, rule for rule, in the
 * same order (the first match wins, so the order is the behaviour). src/logic/__tests__/foodIcon.test.ts runs the website's own
 * function over every food in the library and fails if the two ever disagree; change them together.
 */

export function iconForFood(name: string): string {
  const n = name.toLowerCase();
  // ---- Dish-level matches, most specific first ----
  if (n.includes("pizza")) return "\u{1F355}";
  if (n.includes("cheeseburger") || n.includes("hamburger")) return "\u{1F354}";
  // Hot/corn dog before the sausage/corn checks further down, so "Hot Dog
  // Sausage" and "Korean Corn Dog" don't get pulled into those instead.
  if (n.includes("hot dog") || n.includes("corn dog")) return "\u{1F32D}";
  if (n.includes("fries")) return "\u{1F35F}";
  if (n.includes("taco")) return "\u{1F32E}";
  if (n.includes("burrito")) return "\u{1F32F}";
  if (n.includes("sushi")) return "\u{1F363}";
  if (n.includes("nugget") || n.includes("fried chicken")) return "\u{1F357}";
  if (n.includes("grilled cheese")) return "\u{1F9C0}";
  if (n.includes("dumpling") || n.includes("gyoza") || n.includes("wonton") || n.includes("spring roll")) return "\u{1F95F}";
  // Disambiguation guards -- each of these would otherwise be caught by a
  // later, more generic keyword (egg/cake/ham/cheese/chicken) and end up
  // with a wrong-category icon. Must run before that generic check.
  if (n.includes("eggplant")) return "\u{1F346}";
  if (n.includes("fish cake") || n.includes("rice cake")) return "\u{1F365}";
  if (n.includes("graham cracker")) return "\u{1F36A}";
  if (n.includes("duck sauce")) return "\u{1F96B}";
  if (n.includes("butter chicken")) return "\u{1F35A}";
  // "Curry Leaves" itself contains "curry", so it already resolves via the
  // curry check below -- no separate guard needed once curry and rice
  // share one icon.
  if (n.includes("curry") || n.includes("tikka") || n.includes("korma") || n.includes("vindaloo") || n.includes("rogan josh") || n.includes("keema") || n.includes("chana") || n.includes("masala")) return "\u{1F35A}";
  // "stew" but not "stew meat" -- that phrase names a raw cut of beef
  // (RAW_INGREDIENTS), not a cooked stew dish.
  if (n.includes("soup") || (n.includes("stew") && !n.includes("stew meat")) || n.includes("chowder") || n.includes("jjigae") || n.includes("bouillabaisse") || n.includes("gumbo") || n.includes("tom kha") || n.includes("tom yum") || n.includes("pho") || n.includes("ratatouille") || n.includes("cassoulet") || n.includes("vichyssoise") || n.includes("congee")) return "\u{1F372}";
  if (n.includes("falafel") || n.includes("shawarma") || n.includes("gyro") || n.includes("kebab") || n.includes("kofta") || n.includes("souvlaki")) return "\u{1F959}";
  if (n.includes("caesar") || n.includes("salad")) return "\u{1F957}";
  if (n.includes("spaghetti") || n.includes("alfredo") || n.includes("carbonara") || n.includes("bolognese") || n.includes("primavera") || n.includes("puttanesca") || n.includes("fettuccine")) return "\u{1F35D}";
  if (n.includes("stir fry")) return "\u{1F372}";
  if (n.includes("pancake") || n.includes("waffle")) return "\u{1F95E}";
  if (n.includes("donut")) return "\u{1F369}";
  if (n.includes("cookie")) return "\u{1F36A}";
  // "muffin" alone stays out of this check -- "English Muffin" is bread
  // and "Egg McMuffin" is an egg sandwich, neither is a cupcake. Bare
  // "Muffin"/"Cake" and these named desserts are the only muffin/cake
  // matches left.
  if (n.includes("cake") || n.includes("tiramisu") || n.includes("panna cotta") || n.includes("cannoli") || n.includes("baklava")) return "\u{1F9C1}";
  // "tarte" (French spelling, as in Tarte Tatin) not bare "tart" -- "tart"
  // is a substring of "Beef Tartare", an unrelated raw-beef dish.
  if (n.includes("pie") || n.includes("tarte") || n.includes("quiche")) return "\u{1F967}";
  if (n.includes("ice cream")) return "\u{1F368}";
  if (n.includes("chips") || n.includes("pretzel") || n.includes("popcorn")) return "\u{1F37F}";
  // Oil before "olive" alone, so "Olive Oil" resolves here and only bare
  // olives (Kalamata Olives, Green Olives) reach the olive check below.
  if (n.includes("oil") || n.includes("mayo")) return "\u{1F9C8}";
  if (n.includes("olive")) return "\u{1FAD2}";
  if (n.includes("cheese") || n.includes("butter") || n.includes("paneer")) return "\u{1F9C0}";
  if (n.includes("milk") || n.includes("yogurt") || n.includes("cream")) return "\u{1F95B}";
  if (n.includes("egg")) return "\u{1F95A}";
  if (n.includes("chicken") || n.includes("turkey") || n.includes("duck")) return "\u{1F357}";
  if (n.includes("beef") || n.includes("steak") || n.includes("brisket") || n.includes("bacon") || n.includes("ham") || n.includes("sausage") || n.includes("pork") || n.includes("lamb") || n.includes("prosciutto") || n.includes("pancetta") || n.includes("salami") || n.includes("mortadella") || n.includes("chorizo")) return "\u{1F969}";
  if (n.includes("salmon") || n.includes("tuna") || n.includes("shrimp") || n.includes("cod") || n.includes("tilapia") || n.includes("halibut") || n.includes("crab") || n.includes("lobster") || n.includes("sardine") || n.includes("mahi") || n.includes("fish") || n.includes("seafood") || n.includes("eel") || n.includes("octopus") || n.includes("clam") || n.includes("oyster")) return "\u{1F41F}";
  // Flatbreads and French pastries split out of the old catch-all grain
  // group -- pita/naan/tortilla and croissant/baguette are visually and
  // thematically distinct from a bowl of rice.
  if (n.includes("pita") || n.includes("naan") || n.includes("tortilla") || n.includes("lavash") || n.includes("flatbread")) return "\u{1FAD3}";
  if (n.includes("croissant") || n.includes("baguette") || n.includes("puff pastry") || n.includes("pain au chocolat")) return "\u{1F950}";
  if (n.includes("rice") || n.includes("pasta") || n.includes("noodle") || n.includes("bread") || n.includes("oats") || n.includes("quinoa") || n.includes("couscous") || n.includes("barley") || n.includes("bulgur") || n.includes("farro") || n.includes("bagel") || n.includes("cornbread") || n.includes("muffin") || n.includes("biryani") || n.includes("grits") || n.includes("polenta")) return "\u{1F35A}";
  // Fresh herbs/aromatics run after the meat/rice checks above, so a dish
  // like "Thai Basil Beef" or "Thai Basil Fried Rice" resolves via its
  // protein/grain first -- only the bare herb ingredient reaches here.
  if (n.includes("cilantro") || n.includes("basil") || n.includes("mint") || n.includes("dill") || n.includes("oregano") || n.includes("thyme") || n.includes("bay leaf") || n.includes("perilla") || n.includes("ginger") || n.includes("galangal") || n.includes("lemongrass") || n.includes("grape leaves")) return "\u{1F331}";
  if (n.includes("banana") || n.includes("apple") || n.includes("orange") || n.includes("berr") || n.includes("grape") || n.includes("melon") || n.includes("pineapple") || n.includes("mango") || n.includes("peach") || n.includes("pear") || n.includes("kiwi") || n.includes("cherr") || n.includes("date") || n.includes("raisin")) return "\u{1F34E}";
  if (n.includes("almond") || n.includes("walnut") || n.includes("cashew") || n.includes("peanut") || n.includes("pistachio") || n.includes("pecan") || n.includes("sunflower") || n.includes("chia") || n.includes("flax") || n.includes("pine nut")) return "\u{1F95C}";
  if (n.includes("broccoli") || n.includes("spinach") || n.includes("potato") || n.includes("avocado") || n.includes("carrot") || n.includes("cucumber") || n.includes("tomato") || n.includes("pepper") || n.includes("onion") || n.includes("shallot") || n.includes("leek") || n.includes("garlic") || n.includes("zucchini") || n.includes("cauliflower") || n.includes("asparagus") || n.includes("cabbage") || n.includes("kale") || n.includes("mushroom") || n.includes("corn") || n.includes("beet") || n.includes("okra")) return "\u{1F966}";
  if (n.includes("bean") || n.includes("chickpea") || n.includes("lentil") || n.includes("tofu") || n.includes("tempeh") || n.includes("edamame")) return "\u{1F331}";
  if (n.includes("chocolate") || n.includes("honey") || n.includes("sugar") || n.includes("granola")) return "\u{1F36B}";
  // Dry spices/seasoning vs. wet sauces/pastes/condiments -- distinct
  // enough categories in food_library.py's own pantry sections to earn
  // separate icons rather than both falling through to the default plate.
  if (n.includes("turmeric") || n.includes("cumin") || n.includes("garam masala") || n.includes("chili powder") || n.includes("five spice") || n.includes("za'atar") || n.includes("sumac") || n.includes("coriander powder") || n.includes("cinnamon") || n.includes("cardamom") || n.includes("mustard seed")) return "\u{1F9C2}";
  if (n.includes("soy sauce") || n.includes("fish sauce") || n.includes("oyster sauce") || n.includes("teriyaki") || n.includes("hoisin") || n.includes("ketchup") || n.includes("mustard") || n.includes("bbq sauce") || n.includes("salsa") || n.includes("enchilada sauce") || n.includes("adobo") || n.includes("mole") || n.includes("katsu sauce") || n.includes("marinara") || n.includes("pesto") || n.includes("black bean sauce") || n.includes("gochujang") || n.includes("gochugaru") || n.includes("doenjang") || n.includes("tahini") || n.includes("hummus") || n.includes("tzatziki") || n.includes("guacamole") || n.includes("pico de gallo") || n.includes("miso")) return "\u{1F96B}";
  if (n.includes("wine")) return "\u{1F377}";
  if (n.includes("coffee") || n.includes("espresso")) return "\u{2615}";
  if (n.includes("protein powder")) return "\u{1F964}";
  return "\u{1F37D}️";
}
