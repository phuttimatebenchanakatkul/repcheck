"""Sodium (mg) and sugar (g) per 100g for every RAW_INGREDIENTS entry in
food_library.py, keyed by ingredient name.

Generated in one batch via Gemini (see the backfill script kept in the
project's scratch history) rather than hand-typed, using the same
"roughly USDA-level approximate values" standard as the rest of
food_library.py -- not brand-specific or medical-grade figures.
food_library.py merges this onto each raw ingredient at import time and
derives composite dishes' sodium/sugar the same way it already derives
their calories/protein/fat/carbs, from the recipe's ingredients.
"""

MICRONUTRIENTS = {
  "White Rice, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.1
  },
  "Jasmine Rice, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.1
  },
  "Basmati Rice, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.1
  },
  "Brown Rice, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.4
  },
  "Wild Rice, cooked": {
    "sodium_mg": 7,
    "sugar_g": 1.2
  },
  "Sushi Rice, cooked": {
    "sodium_mg": 250,
    "sugar_g": 3.5
  },
  "Sticky Rice, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.1
  },
  "Quinoa, cooked": {
    "sodium_mg": 7,
    "sugar_g": 0.1
  },
  "Couscous, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.1
  },
  "Barley, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.8
  },
  "Bulgur, cooked": {
    "sodium_mg": 10,
    "sugar_g": 0.4
  },
  "Farro, cooked": {
    "sodium_mg": 8,
    "sugar_g": 0.5
  },
  "Oats, dry": {
    "sodium_mg": 2,
    "sugar_g": 1.0
  },
  "Pasta, cooked": {
    "sodium_mg": 6,
    "sugar_g": 0.6
  },
  "Rice Noodles, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.1
  },
  "Glass Noodles, cooked": {
    "sodium_mg": 9,
    "sugar_g": 0.1
  },
  "Egg Noodles, cooked": {
    "sodium_mg": 15,
    "sugar_g": 0.5
  },
  "Ramen Noodles, cooked": {
    "sodium_mg": 450,
    "sugar_g": 0.5
  },
  "Udon Noodles, cooked": {
    "sodium_mg": 200,
    "sugar_g": 0.2
  },
  "White Bread": {
    "sodium_mg": 490,
    "sugar_g": 5.0
  },
  "Whole Wheat Bread": {
    "sodium_mg": 450,
    "sugar_g": 4.0
  },
  "Sourdough Bread": {
    "sodium_mg": 550,
    "sugar_g": 1.5
  },
  "Rye Bread": {
    "sodium_mg": 500,
    "sugar_g": 1.5
  },
  "Bagel": {
    "sodium_mg": 450,
    "sugar_g": 6.0
  },
  "English Muffin": {
    "sodium_mg": 400,
    "sugar_g": 2.0
  },
  "Flour Tortilla": {
    "sodium_mg": 550,
    "sugar_g": 1.5
  },
  "Corn Tortilla": {
    "sodium_mg": 40,
    "sugar_g": 0.5
  },
  "Pita Bread": {
    "sodium_mg": 400,
    "sugar_g": 1.0
  },
  "Naan": {
    "sodium_mg": 450,
    "sugar_g": 2.0
  },
  "Croissant": {
    "sodium_mg": 450,
    "sugar_g": 4.0
  },
  "Cornbread": {
    "sodium_mg": 500,
    "sugar_g": 8.0
  },
  "Baguette": {
    "sodium_mg": 600,
    "sugar_g": 2.0
  },
  "Puff Pastry": {
    "sodium_mg": 400,
    "sugar_g": 1.0
  },
  "Flour, All-Purpose": {
    "sodium_mg": 2,
    "sugar_g": 0.3
  },
  "Panko Breadcrumbs": {
    "sodium_mg": 400,
    "sugar_g": 3.0
  },
  "Burger Bun": {
    "sodium_mg": 450,
    "sugar_g": 5.0
  },
  "Hot Dog Bun": {
    "sodium_mg": 450,
    "sugar_g": 5.0
  },
  "Tostada Shell": {
    "sodium_mg": 250,
    "sugar_g": 0.5
  },
  "Masa Dough": {
    "sodium_mg": 5,
    "sugar_g": 0.5
  },
  "Cornmeal": {
    "sodium_mg": 2,
    "sugar_g": 0.6
  },
  "Grits, cooked": {
    "sodium_mg": 300,
    "sugar_g": 0.2
  },
  "Chicken Breast, cooked": {
    "sodium_mg": 70,
    "sugar_g": 0.0
  },
  "Chicken Thigh, cooked": {
    "sodium_mg": 80,
    "sugar_g": 0.0
  },
  "Chicken Wing, cooked": {
    "sodium_mg": 90,
    "sugar_g": 0.0
  },
  "Chicken Drumstick, cooked": {
    "sodium_mg": 85,
    "sugar_g": 0.0
  },
  "Ground Chicken, cooked": {
    "sodium_mg": 80,
    "sugar_g": 0.0
  },
  "Chicken (bone-in), fried": {
    "sodium_mg": 500,
    "sugar_g": 0.5
  },
  "Turkey Breast, cooked": {
    "sodium_mg": 75,
    "sugar_g": 0.0
  },
  "Ground Turkey, cooked": {
    "sodium_mg": 80,
    "sugar_g": 0.0
  },
  "Duck, cooked": {
    "sodium_mg": 70,
    "sugar_g": 0.0
  },
  "Duck Fat": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Ground Beef 80/20, cooked": {
    "sodium_mg": 65,
    "sugar_g": 0.0
  },
  "Ground Beef 90/10, cooked": {
    "sodium_mg": 65,
    "sugar_g": 0.0
  },
  "Ribeye Steak, cooked": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Sirloin Steak, cooked": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Flank Steak, cooked": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Beef Brisket, cooked": {
    "sodium_mg": 65,
    "sugar_g": 0.0
  },
  "Beef Strips, cooked": {
    "sodium_mg": 65,
    "sugar_g": 0.0
  },
  "Beef, stew meat, cooked": {
    "sodium_mg": 65,
    "sugar_g": 0.0
  },
  "Pork Chop, cooked": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Pork Tenderloin, cooked": {
    "sodium_mg": 62,
    "sugar_g": 0.0
  },
  "Pork Belly, cooked": {
    "sodium_mg": 650,
    "sugar_g": 0.0
  },
  "Ground Pork, cooked": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Pulled Pork": {
    "sodium_mg": 450,
    "sugar_g": 2.0
  },
  "Carnitas (Pork), cooked": {
    "sodium_mg": 550,
    "sugar_g": 0.0
  },
  "Al Pastor Pork, cooked": {
    "sodium_mg": 600,
    "sugar_g": 3.0
  },
  "Chorizo, cooked": {
    "sodium_mg": 1100,
    "sugar_g": 1.0
  },
  "Bacon, cooked": {
    "sodium_mg": 1700,
    "sugar_g": 0.0
  },
  "Sausage (pork)": {
    "sodium_mg": 800,
    "sugar_g": 1.0
  },
  "Hot Dog Sausage": {
    "sodium_mg": 1000,
    "sugar_g": 2.0
  },
  "Ham": {
    "sodium_mg": 1200,
    "sugar_g": 1.0
  },
  "Lamb, cooked": {
    "sodium_mg": 70,
    "sugar_g": 0.0
  },
  "Salmon, cooked": {
    "sodium_mg": 50,
    "sugar_g": 0.0
  },
  "Tuna, canned in water": {
    "sodium_mg": 300,
    "sugar_g": 0.0
  },
  "Tuna, raw (sashimi grade)": {
    "sodium_mg": 40,
    "sugar_g": 0.0
  },
  "Shrimp, cooked": {
    "sodium_mg": 400,
    "sugar_g": 0.0
  },
  "Dried Shrimp": {
    "sodium_mg": 3500,
    "sugar_g": 0.0
  },
  "Cod, cooked": {
    "sodium_mg": 70,
    "sugar_g": 0.0
  },
  "Tilapia, cooked": {
    "sodium_mg": 50,
    "sugar_g": 0.0
  },
  "Halibut, cooked": {
    "sodium_mg": 80,
    "sugar_g": 0.0
  },
  "Crab, cooked": {
    "sodium_mg": 700,
    "sugar_g": 0.0
  },
  "Lobster, cooked": {
    "sodium_mg": 400,
    "sugar_g": 0.0
  },
  "Sardines, canned": {
    "sodium_mg": 400,
    "sugar_g": 0.0
  },
  "Mahi Mahi, cooked": {
    "sodium_mg": 100,
    "sugar_g": 0.0
  },
  "Eel, cooked (unagi)": {
    "sodium_mg": 450,
    "sugar_g": 8.0
  },
  "Octopus, cooked": {
    "sodium_mg": 230,
    "sugar_g": 0.0
  },
  "Bonito Flakes": {
    "sodium_mg": 1500,
    "sugar_g": 0.0
  },
  "Egg, whole": {
    "sodium_mg": 140,
    "sugar_g": 1.0
  },
  "Egg White": {
    "sodium_mg": 160,
    "sugar_g": 0.7
  },
  "Egg Yolk": {
    "sodium_mg": 50,
    "sugar_g": 0.0
  },
  "Cream Cheese": {
    "sodium_mg": 300,
    "sugar_g": 3.0
  },
  "Cheddar Cheese": {
    "sodium_mg": 600,
    "sugar_g": 0.0
  },
  "Mozzarella Cheese": {
    "sodium_mg": 600,
    "sugar_g": 1.0
  },
  "Parmesan Cheese": {
    "sodium_mg": 1500,
    "sugar_g": 1.0
  },
  "Swiss Cheese": {
    "sodium_mg": 200,
    "sugar_g": 1.0
  },
  "Gruyere Cheese": {
    "sodium_mg": 330,
    "sugar_g": 0.0
  },
  "Feta Cheese": {
    "sodium_mg": 1100,
    "sugar_g": 4.0
  },
  "Goat Cheese": {
    "sodium_mg": 400,
    "sugar_g": 0.0
  },
  "Brie Cheese": {
    "sodium_mg": 600,
    "sugar_g": 0.0
  },
  "Blue Cheese": {
    "sodium_mg": 1100,
    "sugar_g": 0.0
  },
  "Ricotta Cheese": {
    "sodium_mg": 100,
    "sugar_g": 3.0
  },
  "String Cheese": {
    "sodium_mg": 600,
    "sugar_g": 1.0
  },
  "American Cheese": {
    "sodium_mg": 1500,
    "sugar_g": 8.0
  },
  "Provolone Cheese": {
    "sodium_mg": 800,
    "sugar_g": 1.0
  },
  "Cottage Cheese": {
    "sodium_mg": 400,
    "sugar_g": 3.0
  },
  "Queso Fresco": {
    "sodium_mg": 500,
    "sugar_g": 2.0
  },
  "Cotija Cheese": {
    "sodium_mg": 1400,
    "sugar_g": 1.0
  },
  "Paneer": {
    "sodium_mg": 20,
    "sugar_g": 1.0
  },
  "Whole Milk": {
    "sodium_mg": 40,
    "sugar_g": 5.0
  },
  "Skim Milk": {
    "sodium_mg": 45,
    "sugar_g": 5.0
  },
  "2% Milk": {
    "sodium_mg": 45,
    "sugar_g": 5.0
  },
  "Almond Milk, unsweetened": {
    "sodium_mg": 60,
    "sugar_g": 0.0
  },
  "Oat Milk": {
    "sodium_mg": 40,
    "sugar_g": 4.0
  },
  "Soy Milk": {
    "sodium_mg": 40,
    "sugar_g": 1.0
  },
  "Buttermilk": {
    "sodium_mg": 100,
    "sugar_g": 5.0
  },
  "Greek Yogurt, plain nonfat": {
    "sodium_mg": 40,
    "sugar_g": 4.0
  },
  "Yogurt, plain whole milk": {
    "sodium_mg": 45,
    "sugar_g": 5.0
  },
  "Heavy Cream": {
    "sodium_mg": 40,
    "sugar_g": 3.0
  },
  "Half and Half": {
    "sodium_mg": 40,
    "sugar_g": 4.0
  },
  "Sour Cream": {
    "sodium_mg": 50,
    "sugar_g": 3.0
  },
  "Custard": {
    "sodium_mg": 50,
    "sugar_g": 15.0
  },
  "Butter": {
    "sodium_mg": 11,
    "sugar_g": 0.0
  },
  "Ghee": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Tofu": {
    "sodium_mg": 7,
    "sugar_g": 1.0
  },
  "Tempeh": {
    "sodium_mg": 9,
    "sugar_g": 0.0
  },
  "Black Beans, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.0
  },
  "Kidney Beans, cooked": {
    "sodium_mg": 2,
    "sugar_g": 0.0
  },
  "Chickpeas, cooked": {
    "sodium_mg": 7,
    "sugar_g": 0.0
  },
  "Pinto Beans, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.0
  },
  "Refried Beans": {
    "sodium_mg": 450,
    "sugar_g": 1.0
  },
  "Edamame, cooked": {
    "sodium_mg": 9,
    "sugar_g": 2.0
  },
  "Lentils, cooked": {
    "sodium_mg": 2,
    "sugar_g": 0.0
  },
  "Green Peas, cooked": {
    "sodium_mg": 1,
    "sugar_g": 6.0
  },
  "Almonds": {
    "sodium_mg": 1,
    "sugar_g": 4.0
  },
  "Walnuts": {
    "sodium_mg": 2,
    "sugar_g": 3.0
  },
  "Cashews": {
    "sodium_mg": 12,
    "sugar_g": 6.0
  },
  "Peanuts": {
    "sodium_mg": 18,
    "sugar_g": 5.0
  },
  "Pistachios": {
    "sodium_mg": 1,
    "sugar_g": 8.0
  },
  "Pecans": {
    "sodium_mg": 0,
    "sugar_g": 4.0
  },
  "Sunflower Seeds": {
    "sodium_mg": 9,
    "sugar_g": 3.0
  },
  "Sesame Seeds": {
    "sodium_mg": 11,
    "sugar_g": 0.0
  },
  "Chia Seeds": {
    "sodium_mg": 16,
    "sugar_g": 0.0
  },
  "Flax Seeds": {
    "sodium_mg": 30,
    "sugar_g": 2.0
  },
  "Peanut Butter": {
    "sodium_mg": 400,
    "sugar_g": 9.0
  },
  "Almond Butter": {
    "sodium_mg": 150,
    "sugar_g": 5.0
  },
  "Peanut Sauce": {
    "sodium_mg": 600,
    "sugar_g": 12.0
  },
  "Banana": {
    "sodium_mg": 1,
    "sugar_g": 12.0
  },
  "Apple": {
    "sodium_mg": 1,
    "sugar_g": 10.0
  },
  "Orange": {
    "sodium_mg": 0,
    "sugar_g": 9.0
  },
  "Grapes": {
    "sodium_mg": 2,
    "sugar_g": 16.0
  },
  "Watermelon": {
    "sodium_mg": 1,
    "sugar_g": 6.0
  },
  "Pineapple": {
    "sodium_mg": 1,
    "sugar_g": 10.0
  },
  "Mango": {
    "sodium_mg": 1,
    "sugar_g": 14.0
  },
  "Peach": {
    "sodium_mg": 0,
    "sugar_g": 8.0
  },
  "Pear": {
    "sodium_mg": 1,
    "sugar_g": 10.0
  },
  "Kiwi": {
    "sodium_mg": 3,
    "sugar_g": 9.0
  },
  "Cherries": {
    "sodium_mg": 0,
    "sugar_g": 13.0
  },
  "Strawberries": {
    "sodium_mg": 1,
    "sugar_g": 5.0
  },
  "Blueberries": {
    "sodium_mg": 1,
    "sugar_g": 10.0
  },
  "Raspberries": {
    "sodium_mg": 1,
    "sugar_g": 4.0
  },
  "Blackberries": {
    "sodium_mg": 1,
    "sugar_g": 5.0
  },
  "Cantaloupe": {
    "sodium_mg": 16,
    "sugar_g": 8.0
  },
  "Grapefruit": {
    "sodium_mg": 0,
    "sugar_g": 7.0
  },
  "Dates": {
    "sodium_mg": 2,
    "sugar_g": 66.0
  },
  "Raisins": {
    "sodium_mg": 11,
    "sugar_g": 59.0
  },
  "Avocado": {
    "sodium_mg": 7,
    "sugar_g": 1.0
  },
  "Green Papaya": {
    "sodium_mg": 8,
    "sugar_g": 0.0
  },
  "Lime Juice": {
    "sodium_mg": 2,
    "sugar_g": 2.0
  },
  "Tomatillo": {
    "sodium_mg": 5,
    "sugar_g": 4.0
  },
  "Broccoli": {
    "sodium_mg": 33,
    "sugar_g": 2.0
  },
  "Spinach": {
    "sodium_mg": 79,
    "sugar_g": 0.0
  },
  "Potato, baked": {
    "sodium_mg": 10,
    "sugar_g": 1.0
  },
  "Sweet Potato, baked": {
    "sodium_mg": 41,
    "sugar_g": 6.0
  },
  "Carrot": {
    "sodium_mg": 69,
    "sugar_g": 5.0
  },
  "Cucumber": {
    "sodium_mg": 2,
    "sugar_g": 2.0
  },
  "Tomato": {
    "sodium_mg": 5,
    "sugar_g": 3.0
  },
  "Bell Pepper": {
    "sodium_mg": 4,
    "sugar_g": 4.0
  },
  "Poblano Pepper": {
    "sodium_mg": 5,
    "sugar_g": 3.0
  },
  "Jalapeno Pepper": {
    "sodium_mg": 3,
    "sugar_g": 4.0
  },
  "Chili Pepper": {
    "sodium_mg": 7,
    "sugar_g": 5.0
  },
  "Onion": {
    "sodium_mg": 4,
    "sugar_g": 4.2
  },
  "Shallot": {
    "sodium_mg": 12,
    "sugar_g": 7.9
  },
  "Leeks": {
    "sodium_mg": 20,
    "sugar_g": 3.9
  },
  "Garlic": {
    "sodium_mg": 17,
    "sugar_g": 1.0
  },
  "Ginger": {
    "sodium_mg": 13,
    "sugar_g": 1.7
  },
  "Galangal": {
    "sodium_mg": 6,
    "sugar_g": 0.0
  },
  "Lemongrass": {
    "sodium_mg": 6,
    "sugar_g": 0.0
  },
  "Zucchini": {
    "sodium_mg": 8,
    "sugar_g": 1.7
  },
  "Cauliflower": {
    "sodium_mg": 30,
    "sugar_g": 1.9
  },
  "Asparagus": {
    "sodium_mg": 2,
    "sugar_g": 1.9
  },
  "Green Beans": {
    "sodium_mg": 6,
    "sugar_g": 3.3
  },
  "Brussels Sprouts": {
    "sodium_mg": 25,
    "sugar_g": 2.2
  },
  "Cabbage": {
    "sodium_mg": 18,
    "sugar_g": 3.2
  },
  "Kale": {
    "sodium_mg": 38,
    "sugar_g": 2.3
  },
  "Mushroom": {
    "sodium_mg": 5,
    "sugar_g": 2.0
  },
  "Corn": {
    "sodium_mg": 15,
    "sugar_g": 3.2
  },
  "Beet": {
    "sodium_mg": 78,
    "sugar_g": 6.8
  },
  "Bean Sprouts": {
    "sodium_mg": 6,
    "sugar_g": 1.9
  },
  "Scallion": {
    "sodium_mg": 16,
    "sugar_g": 2.3
  },
  "Cilantro": {
    "sodium_mg": 46,
    "sugar_g": 0.9
  },
  "Thai Basil": {
    "sodium_mg": 4,
    "sugar_g": 0.0
  },
  "Romaine Lettuce": {
    "sodium_mg": 8,
    "sugar_g": 1.2
  },
  "Lettuce": {
    "sodium_mg": 28,
    "sugar_g": 1.4
  },
  "Olive Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Coconut Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Avocado Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Sesame Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Vegetable Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Mayonnaise": {
    "sodium_mg": 635,
    "sugar_g": 0.6
  },
  "Ketchup": {
    "sodium_mg": 1114,
    "sugar_g": 22.9
  },
  "Mustard": {
    "sodium_mg": 1252,
    "sugar_g": 0.6
  },
  "Dijon Mustard": {
    "sodium_mg": 1300,
    "sugar_g": 1.5
  },
  "Pickles": {
    "sodium_mg": 800,
    "sugar_g": 1.5
  },
  "BBQ Sauce": {
    "sodium_mg": 700,
    "sugar_g": 30.0
  },
  "Soy Sauce": {
    "sodium_mg": 5720,
    "sugar_g": 0.4
  },
  "Fish Sauce": {
    "sodium_mg": 8500,
    "sugar_g": 0.5
  },
  "Oyster Sauce": {
    "sodium_mg": 2800,
    "sugar_g": 9.0
  },
  "Tamarind Paste": {
    "sodium_mg": 25,
    "sugar_g": 35.0
  },
  "Palm Sugar": {
    "sodium_mg": 30,
    "sugar_g": 85.0
  },
  "Thai Red Curry Paste": {
    "sodium_mg": 3500,
    "sugar_g": 5.0
  },
  "Thai Green Curry Paste": {
    "sodium_mg": 3500,
    "sugar_g": 5.0
  },
  "Panang Curry Paste": {
    "sodium_mg": 3000,
    "sugar_g": 8.0
  },
  "Massaman Curry Paste": {
    "sodium_mg": 3000,
    "sugar_g": 10.0
  },
  "Yellow Curry Paste": {
    "sodium_mg": 3000,
    "sugar_g": 5.0
  },
  "Coconut Milk": {
    "sodium_mg": 15,
    "sugar_g": 2.1
  },
  "Salsa": {
    "sodium_mg": 500,
    "sugar_g": 3.0
  },
  "Pico de Gallo": {
    "sodium_mg": 400,
    "sugar_g": 2.0
  },
  "Guacamole": {
    "sodium_mg": 450,
    "sugar_g": 1.0
  },
  "Enchilada Sauce": {
    "sodium_mg": 600,
    "sugar_g": 2.0
  },
  "Adobo Sauce": {
    "sodium_mg": 1200,
    "sugar_g": 15.0
  },
  "Chipotle Pepper in Adobo": {
    "sodium_mg": 1000,
    "sugar_g": 12.0
  },
  "Taco Seasoning": {
    "sodium_mg": 10000,
    "sugar_g": 5.0
  },
  "Mole Sauce": {
    "sodium_mg": 600,
    "sugar_g": 10.0
  },
  "Nori (seaweed)": {
    "sodium_mg": 150,
    "sugar_g": 0.0
  },
  "Miso Paste": {
    "sodium_mg": 3700,
    "sugar_g": 6.0
  },
  "Dashi Stock": {
    "sodium_mg": 400,
    "sugar_g": 0.0
  },
  "Mirin": {
    "sodium_mg": 50,
    "sugar_g": 45.0
  },
  "Wasabi": {
    "sodium_mg": 100,
    "sugar_g": 5.0
  },
  "Rice Vinegar": {
    "sodium_mg": 10,
    "sugar_g": 0.0
  },
  "Teriyaki Sauce": {
    "sodium_mg": 2500,
    "sugar_g": 14.0
  },
  "Katsu Sauce": {
    "sodium_mg": 1200,
    "sugar_g": 25.0
  },
  "Tempura Batter": {
    "sodium_mg": 450,
    "sugar_g": 2.0
  },
  "Curry Roux (Japanese)": {
    "sodium_mg": 3800,
    "sugar_g": 8.0
  },
  "Okonomiyaki Sauce": {
    "sodium_mg": 1100,
    "sugar_g": 22.0
  },
  "Seaweed Salad (Wakame)": {
    "sodium_mg": 650,
    "sugar_g": 3.0
  },
  "White Wine": {
    "sodium_mg": 5,
    "sugar_g": 1.0
  },
  "Red Wine": {
    "sodium_mg": 4,
    "sugar_g": 1.0
  },
  "Thyme": {
    "sodium_mg": 9,
    "sugar_g": 0.0
  },
  "Bay Leaf": {
    "sodium_mg": 23,
    "sugar_g": 0.0
  },
  "Vanilla Extract": {
    "sodium_mg": 9,
    "sugar_g": 12.0
  },
  "Garam Masala": {
    "sodium_mg": 35,
    "sugar_g": 0.0
  },
  "Turmeric": {
    "sodium_mg": 38,
    "sugar_g": 3.0
  },
  "Cumin": {
    "sodium_mg": 168,
    "sugar_g": 2.0
  },
  "Coriander Powder": {
    "sodium_mg": 35,
    "sugar_g": 0.0
  },
  "Curry Leaves": {
    "sodium_mg": 10,
    "sugar_g": 0.0
  },
  "Mustard Seeds": {
    "sodium_mg": 13,
    "sugar_g": 1.0
  },
  "Cardamom": {
    "sodium_mg": 18,
    "sugar_g": 0.0
  },
  "Cinnamon": {
    "sodium_mg": 10,
    "sugar_g": 2.0
  },
  "Chili Powder": {
    "sodium_mg": 1600,
    "sugar_g": 5.0
  },
  "Tikka Masala Sauce": {
    "sodium_mg": 550,
    "sugar_g": 6.0
  },
  "Curry Sauce (Indian, general)": {
    "sodium_mg": 450,
    "sugar_g": 4.0
  },
  "Honey": {
    "sodium_mg": 4,
    "sugar_g": 82.0
  },
  "Maple Syrup": {
    "sodium_mg": 12,
    "sugar_g": 67.0
  },
  "Sugar, white": {
    "sodium_mg": 1,
    "sugar_g": 100.0
  },
  "Brown Sugar": {
    "sodium_mg": 28,
    "sugar_g": 97.0
  },
  "Dark Chocolate": {
    "sodium_mg": 10,
    "sugar_g": 24.0
  },
  "Milk Chocolate": {
    "sodium_mg": 80,
    "sugar_g": 52.0
  },
  "Granola Bar": {
    "sodium_mg": 150,
    "sugar_g": 28.0
  },
  "Popcorn, air-popped": {
    "sodium_mg": 7,
    "sugar_g": 0.0
  },
  "Potato Chips": {
    "sodium_mg": 550,
    "sugar_g": 0.0
  },
  "Tortilla Chips": {
    "sodium_mg": 450,
    "sugar_g": 1.0
  },
  "Pretzels": {
    "sodium_mg": 1200,
    "sugar_g": 3.0
  },
  "Ice Cream": {
    "sodium_mg": 80,
    "sugar_g": 21.0
  },
  "Graham Cracker": {
    "sodium_mg": 350,
    "sugar_g": 25.0
  },
  "Marshmallow": {
    "sodium_mg": 80,
    "sugar_g": 58.0
  },
  "Chocolate Chips": {
    "sodium_mg": 10,
    "sugar_g": 50.0
  },
  "Croutons": {
    "sodium_mg": 600,
    "sugar_g": 4.0
  },
  "Caesar Dressing": {
    "sodium_mg": 700,
    "sugar_g": 2.0
  },
  "Macarons": {
    "sodium_mg": 60,
    "sugar_g": 45.0
  },
  "Whey Protein Powder": {
    "sodium_mg": 300,
    "sugar_g": 5.0
  },
  "Casein Protein Powder": {
    "sodium_mg": 250,
    "sugar_g": 3.0
  },
  "Plant Protein Powder": {
    "sodium_mg": 600,
    "sugar_g": 2.0
  },

  # ---- New ingredients added when food_library.py was expanded with
  # Italian, Chinese, Korean, Vietnamese, Greek/Mediterranean, Middle
  # Eastern, and breakfast/beverage items ----
  "Prosciutto": {
    "sodium_mg": 2145,
    "sugar_g": 0.6
  },
  "Pancetta": {
    "sodium_mg": 1800,
    "sugar_g": 0.5
  },
  "Pecorino Romano Cheese": {
    "sodium_mg": 1800,
    "sugar_g": 0.5
  },
  "Basil, fresh": {
    "sodium_mg": 4,
    "sugar_g": 0.3
  },
  "Oregano, dried": {
    "sodium_mg": 25,
    "sugar_g": 4.1
  },
  "Balsamic Vinegar": {
    "sodium_mg": 23,
    "sugar_g": 15.0
  },
  "Arborio Rice, cooked": {
    "sodium_mg": 1,
    "sugar_g": 0.1
  },
  "Polenta, cooked": {
    "sodium_mg": 250,
    "sugar_g": 0.3
  },
  "Pesto Sauce": {
    "sodium_mg": 650,
    "sugar_g": 2.5
  },
  "Marinara Sauce": {
    "sodium_mg": 450,
    "sugar_g": 4.5
  },
  "Alfredo Sauce": {
    "sodium_mg": 500,
    "sugar_g": 2.0
  },
  "Italian Sausage, cooked": {
    "sodium_mg": 850,
    "sugar_g": 1.5
  },
  "Salami": {
    "sodium_mg": 1600,
    "sugar_g": 1.2
  },
  "Mortadella": {
    "sodium_mg": 1200,
    "sugar_g": 0.5
  },
  "Capers": {
    "sodium_mg": 2500,
    "sugar_g": 0.4
  },
  "Sun-Dried Tomatoes": {
    "sodium_mg": 250,
    "sugar_g": 37.5
  },
  "Artichoke Hearts": {
    "sodium_mg": 300,
    "sugar_g": 0.8
  },
  "Pine Nuts": {
    "sodium_mg": 2,
    "sugar_g": 3.6
  },
  "Lasagna Noodles, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.5
  },
  "Gnocchi, cooked": {
    "sodium_mg": 250,
    "sugar_g": 0.5
  },
  "Mascarpone Cheese": {
    "sodium_mg": 60,
    "sugar_g": 3.0
  },
  "Ladyfingers (Savoiardi)": {
    "sodium_mg": 150,
    "sugar_g": 38.0
  },
  "Cocoa Powder": {
    "sodium_mg": 20,
    "sugar_g": 0.6
  },
  "Espresso": {
    "sodium_mg": 2,
    "sugar_g": 0.1
  },
  "Hoisin Sauce": {
    "sodium_mg": 1100,
    "sugar_g": 25.0
  },
  "Dark Soy Sauce": {
    "sodium_mg": 5500,
    "sugar_g": 1.0
  },
  "Shaoxing Wine": {
    "sodium_mg": 100,
    "sugar_g": 0.5
  },
  "Five Spice Powder": {
    "sodium_mg": 100,
    "sugar_g": 10.0
  },
  "Bok Choy": {
    "sodium_mg": 65,
    "sugar_g": 1.0
  },
  "Napa Cabbage": {
    "sodium_mg": 10,
    "sugar_g": 1.4
  },
  "Water Chestnuts": {
    "sodium_mg": 14,
    "sugar_g": 4.8
  },
  "Bamboo Shoots": {
    "sodium_mg": 4,
    "sugar_g": 2.5
  },
  "Char Siu Pork, cooked": {
    "sodium_mg": 700,
    "sugar_g": 12.0
  },
  "Wonton Wrapper": {
    "sodium_mg": 450,
    "sugar_g": 2.0
  },
  "Sichuan Peppercorn": {
    "sodium_mg": 20,
    "sugar_g": 0.0
  },
  "Chili Oil": {
    "sodium_mg": 0,
    "sugar_g": 0.0
  },
  "Black Bean Sauce": {
    "sodium_mg": 2200,
    "sugar_g": 5.0
  },
  "Snow Peas": {
    "sodium_mg": 20,
    "sugar_g": 4.0
  },
  "Duck Sauce": {
    "sodium_mg": 500,
    "sugar_g": 30.0
  },
  "Mandarin Pancake": {
    "sodium_mg": 200,
    "sugar_g": 1.0
  },
  "Gochujang": {
    "sodium_mg": 2200,
    "sugar_g": 15.0
  },
  "Gochugaru": {
    "sodium_mg": 50,
    "sugar_g": 5.0
  },
  "Doenjang": {
    "sodium_mg": 3500,
    "sugar_g": 2.0
  },
  "Kimchi": {
    "sodium_mg": 600,
    "sugar_g": 1.5
  },
  "Bulgogi Beef, cooked": {
    "sodium_mg": 550,
    "sugar_g": 8.0
  },
  "Rice Cake (Tteok)": {
    "sodium_mg": 180,
    "sugar_g": 0.5
  },
  "Perilla Leaves": {
    "sodium_mg": 1,
    "sugar_g": 0.3
  },
  "Korean Short Rib, cooked": {
    "sodium_mg": 600,
    "sugar_g": 9.0
  },
  "Korean Fish Cake": {
    "sodium_mg": 750,
    "sugar_g": 4.0
  },
  "Korean BBQ Sauce": {
    "sodium_mg": 1200,
    "sugar_g": 25.0
  },
  "Rice Paper": {
    "sodium_mg": 280,
    "sugar_g": 0.5
  },
  "Vermicelli Noodles, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.1
  },
  "Pho Broth": {
    "sodium_mg": 450,
    "sugar_g": 1.2
  },
  "Mint, fresh": {
    "sodium_mg": 31,
    "sugar_g": 0.5
  },
  "Coffee, black": {
    "sodium_mg": 2,
    "sugar_g": 0.0
  },
  "Kalamata Olives": {
    "sodium_mg": 2300,
    "sugar_g": 0.0
  },
  "Green Olives": {
    "sodium_mg": 2400,
    "sugar_g": 0.0
  },
  "Tzatziki": {
    "sodium_mg": 250,
    "sugar_g": 3.0
  },
  "Hummus": {
    "sodium_mg": 380,
    "sugar_g": 1.0
  },
  "Tahini": {
    "sodium_mg": 40,
    "sugar_g": 0.5
  },
  "Phyllo Dough": {
    "sodium_mg": 450,
    "sugar_g": 2.0
  },
  "Halloumi Cheese": {
    "sodium_mg": 1200,
    "sugar_g": 0.5
  },
  "Grape Leaves": {
    "sodium_mg": 350,
    "sugar_g": 1.0
  },
  "Ground Lamb, cooked": {
    "sodium_mg": 70,
    "sugar_g": 0.0
  },
  "Dill": {
    "sodium_mg": 61,
    "sugar_g": 0.2
  },
  "Orzo, cooked": {
    "sodium_mg": 5,
    "sugar_g": 0.5
  },
  "Pomegranate Seeds": {
    "sodium_mg": 3,
    "sugar_g": 13.7
  },
  "Eggplant": {
    "sodium_mg": 2,
    "sugar_g": 3.5
  },
  "Za'atar": {
    "sodium_mg": 800,
    "sugar_g": 1.0
  },
  "Baba Ghanoush": {
    "sodium_mg": 300,
    "sugar_g": 2.5
  },
  "Shawarma Chicken, cooked": {
    "sodium_mg": 500,
    "sugar_g": 1.5
  },
  "Shawarma Lamb, cooked": {
    "sodium_mg": 550,
    "sugar_g": 1.0
  },
  "Labneh": {
    "sodium_mg": 350,
    "sugar_g": 3.0
  },
  "Lavash Flatbread": {
    "sodium_mg": 450,
    "sugar_g": 1.5
  },
  "Sumac": {
    "sodium_mg": 20,
    "sugar_g": 0.5
  },
  "Falafel, fried": {
    "sodium_mg": 400,
    "sugar_g": 1.5
  },
  "Corn Flakes": {
    "sodium_mg": 850,
    "sugar_g": 8.0
  },
  "Granola": {
    "sodium_mg": 60,
    "sugar_g": 20.0
  },
  "Orange Juice": {
    "sodium_mg": 2,
    "sugar_g": 8.5
  },
  "Apple Juice": {
    "sodium_mg": 4,
    "sugar_g": 10.0
  },
  "Fruit Jam": {
    "sodium_mg": 10,
    "sugar_g": 50.0
  },
  "Nutella": {
    "sodium_mg": 40,
    "sugar_g": 56.0
  },
  "Hash Browns": {
    "sodium_mg": 400,
    "sugar_g": 0.5
  },
  "Protein Bar": {
    "sodium_mg": 200,
    "sugar_g": 15.0
  },
  "Whipped Cream": {
    "sodium_mg": 30,
    "sugar_g": 6.0
  },
  "Okra": {
    "sodium_mg": 7,
    "sugar_g": 1.5
  },

  # ---- New ingredients added when food_library.py was expanded with
  # commercial brand / restaurant chain items ----
  "Big Mac": {
    "sodium_mg": 530,
    "sugar_g": 3.4
  },
  "McChicken": {
    "sodium_mg": 510,
    "sugar_g": 3.7
  },
  "Quarter Pounder with Cheese": {
    "sodium_mg": 580,
    "sugar_g": 3.6
  },
  "McDonald's Fries": {
    "sodium_mg": 320,
    "sugar_g": 0.4
  },
  "McDonald's Chicken McNuggets": {
    "sodium_mg": 500,
    "sugar_g": 0.2
  },
  "Egg McMuffin": {
    "sodium_mg": 560,
    "sugar_g": 3.0
  },
  "McFlurry with M&Ms": {
    "sodium_mg": 120,
    "sugar_g": 22.0
  },
  "KFC Original Recipe Chicken Breast": {
    "sodium_mg": 680,
    "sugar_g": 0.5
  },
  "KFC Popcorn Chicken": {
    "sodium_mg": 750,
    "sugar_g": 1.2
  },
  "KFC Chicken Sandwich": {
    "sodium_mg": 540,
    "sugar_g": 4.5
  },
  "KFC Mashed Potatoes with Gravy": {
    "sodium_mg": 380,
    "sugar_g": 1.5
  },
  "KFC Coleslaw": {
    "sodium_mg": 280,
    "sugar_g": 9.5
  },
  "Pizza Hut Pepperoni Pan Pizza": {
    "sodium_mg": 570,
    "sugar_g": 1.5
  },
  "Pizza Hut Stuffed Crust Pizza": {
    "sodium_mg": 620,
    "sugar_g": 1.8
  },
  "Pizza Hut Breadstick": {
    "sodium_mg": 580,
    "sugar_g": 1.0
  },
  "Taco Bell Crunchwrap Supreme": {
    "sodium_mg": 480,
    "sugar_g": 1.3
  },
  "Taco Bell Beef Burrito Supreme": {
    "sodium_mg": 460,
    "sugar_g": 1.8
  },
  "Taco Bell Crunchy Taco": {
    "sodium_mg": 530,
    "sugar_g": 0.8
  },
  "Taco Bell Chicken Quesadilla": {
    "sodium_mg": 590,
    "sugar_g": 1.5
  },
  "Wingstop Classic Bone-In Wings": {
    "sodium_mg": 850,
    "sugar_g": 0.5
  },
  "Wingstop Boneless Wings": {
    "sodium_mg": 920,
    "sugar_g": 1.2
  },
  "Wingstop Fries": {
    "sodium_mg": 450,
    "sugar_g": 2.5
  },
  "Five Guys Cheeseburger": {
    "sodium_mg": 520,
    "sugar_g": 2.2
  },
  "Five Guys Fries": {
    "sodium_mg": 350,
    "sugar_g": 0.5
  },
  "Shake Shack ShackBurger": {
    "sodium_mg": 500,
    "sugar_g": 3.5
  },
  "Shake Shack Crinkle Fries": {
    "sodium_mg": 380,
    "sugar_g": 0.5
  },
  "Shake Shack Vanilla Shake": {
    "sodium_mg": 110,
    "sugar_g": 18.0
  },
  "Chagee Classic Milk Tea": {
    "sodium_mg": 40,
    "sugar_g": 6.5
  },
  "Koi The Original Milk Tea with Pearls": {
    "sodium_mg": 35,
    "sugar_g": 9.0
  },
  "Meiji Milk": {
    "sodium_mg": 45,
    "sugar_g": 4.8
  },
  "Mama Cup Noodles, Tom Yum Shrimp, prepared": {
    "sodium_mg": 510,
    "sugar_g": 1.2
  }
}
