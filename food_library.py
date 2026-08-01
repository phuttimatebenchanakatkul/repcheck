"""Searchable food database for the nutrition tracker.

Every raw-ingredient entry is calories/carbs/fat/protein per 100g (or
100mL for liquids), using standard, widely-cited approximate values
(roughly USDA-level) -- not brand-specific or medical-grade figures.
Sodium (mg) and sugar (g) per 100g are merged on below from
micronutrient_data.py (generated separately, in bulk, rather than by
hand -- see that file's docstring).

Composite/prepared dishes (pizza, tacos, pad thai, etc.) don't have
hand-typed macros. Instead each one carries an "ingredients" list --
{"name": <raw ingredient>, "grams": <default amount>} -- and
_compute_dish_macros() below derives the dish's own per-100g
calories/carbs/fat/protein/sodium/sugar by summing those ingredients.
That keeps the numbers internally consistent and means editing an
ingredient's amount in the app always recalculates the whole dish
correctly, instead of drifting from a separately-guessed total.

This is a large, representative set of dishes (30+ per cuisine for Thai,
Mexican, Japanese, American, French, and Indian) -- not literally every
dish that exists in each cuisine, which isn't a bounded list. Recipes are
simplified to their handful of defining ingredients rather than
restaurant-exact recipes.
"""

from micronutrient_data import MICRONUTRIENTS


def _dish(name, ingredients):
    """ingredients: list of (raw_ingredient_name, grams) tuples."""
    return {
        "name": name,
        "ingredients": [{"name": n, "grams": g} for n, g in ingredients],
    }


RAW_INGREDIENTS = [
    # ------------------------------------------------------------------
    # Grains, rice, pasta, bread
    # ------------------------------------------------------------------
    {"name": "White Rice, cooked", "calories": 130, "carbs": 28, "fat": 0.3, "protein": 2.7},
    {"name": "Jasmine Rice, cooked", "calories": 129, "carbs": 28, "fat": 0.3, "protein": 2.7},
    {"name": "Basmati Rice, cooked", "calories": 121, "carbs": 25, "fat": 0.4, "protein": 3.5},
    {"name": "Brown Rice, cooked", "calories": 123, "carbs": 26, "fat": 1.0, "protein": 2.7},
    {"name": "Wild Rice, cooked", "calories": 101, "carbs": 21, "fat": 0.3, "protein": 4.0},
    {"name": "Sushi Rice, cooked", "calories": 135, "carbs": 29, "fat": 0.2, "protein": 2.5},
    {"name": "Sticky Rice, cooked", "calories": 130, "carbs": 28, "fat": 0.3, "protein": 2.7},
    {"name": "Quinoa, cooked", "calories": 120, "carbs": 21, "fat": 1.9, "protein": 4.4},
    {"name": "Couscous, cooked", "calories": 112, "carbs": 23, "fat": 0.2, "protein": 3.8},
    {"name": "Barley, cooked", "calories": 123, "carbs": 28, "fat": 0.4, "protein": 2.3},
    {"name": "Bulgur, cooked", "calories": 83, "carbs": 19, "fat": 0.2, "protein": 3.1},
    {"name": "Farro, cooked", "calories": 122, "carbs": 25, "fat": 0.9, "protein": 4.9},
    {"name": "Oats, dry", "calories": 389, "carbs": 66, "fat": 7.0, "protein": 17},
    {"name": "Pasta, cooked", "calories": 158, "carbs": 31, "fat": 0.9, "protein": 5.8},
    {"name": "Rice Noodles, cooked", "calories": 109, "carbs": 25, "fat": 0.2, "protein": 0.9},
    {"name": "Glass Noodles, cooked", "calories": 95, "carbs": 23, "fat": 0.1, "protein": 0.1},
    {"name": "Egg Noodles, cooked", "calories": 138, "carbs": 25, "fat": 2.1, "protein": 4.5},
    {"name": "Ramen Noodles, cooked", "calories": 188, "carbs": 27, "fat": 7.0, "protein": 5.0},
    {"name": "Udon Noodles, cooked", "calories": 99, "carbs": 21, "fat": 0.4, "protein": 2.6},
    {"name": "White Bread", "calories": 265, "carbs": 49, "fat": 3.2, "protein": 9.0},
    {"name": "Whole Wheat Bread", "calories": 247, "carbs": 41, "fat": 3.4, "protein": 13},
    {"name": "Sourdough Bread", "calories": 289, "carbs": 56, "fat": 1.7, "protein": 11},
    {"name": "Rye Bread", "calories": 259, "carbs": 48, "fat": 3.3, "protein": 8.5},
    {"name": "Bagel", "calories": 257, "carbs": 50, "fat": 1.7, "protein": 10},
    {"name": "English Muffin", "calories": 227, "carbs": 44, "fat": 1.8, "protein": 8.2},
    {"name": "Flour Tortilla", "calories": 306, "carbs": 51, "fat": 7.5, "protein": 8.2},
    {"name": "Corn Tortilla", "calories": 218, "carbs": 45, "fat": 2.9, "protein": 5.7},
    {"name": "Pita Bread", "calories": 275, "carbs": 55, "fat": 1.2, "protein": 9.1},
    {"name": "Naan", "calories": 291, "carbs": 50, "fat": 5.7, "protein": 9.6},
    {"name": "Croissant", "calories": 406, "carbs": 46, "fat": 21, "protein": 8.2},
    {"name": "Cornbread", "calories": 296, "carbs": 45, "fat": 9.6, "protein": 6.1},
    {"name": "Baguette", "calories": 274, "carbs": 55, "fat": 1.5, "protein": 9.0},
    {"name": "Puff Pastry", "calories": 558, "carbs": 45, "fat": 39, "protein": 7.3},
    {"name": "Flour, All-Purpose", "calories": 364, "carbs": 76, "fat": 1.0, "protein": 10},
    {"name": "Panko Breadcrumbs", "calories": 373, "carbs": 71, "fat": 3.0, "protein": 12},
    {"name": "Burger Bun", "calories": 265, "carbs": 48, "fat": 4.0, "protein": 9.0},
    {"name": "Hot Dog Bun", "calories": 265, "carbs": 48, "fat": 4.0, "protein": 9.0},
    {"name": "Tostada Shell", "calories": 435, "carbs": 58, "fat": 20, "protein": 6.5},
    {"name": "Masa Dough", "calories": 218, "carbs": 45, "fat": 2.4, "protein": 5.7},
    {"name": "Cornmeal", "calories": 370, "carbs": 79, "fat": 3.9, "protein": 8.1},
    {"name": "Grits, cooked", "calories": 71, "carbs": 15, "fat": 0.3, "protein": 1.7},

    # ------------------------------------------------------------------
    # Poultry, beef, pork, lamb
    # ------------------------------------------------------------------
    {"name": "Chicken Breast, cooked", "calories": 165, "carbs": 0, "fat": 3.6, "protein": 31},
    {"name": "Chicken Thigh, cooked", "calories": 209, "carbs": 0, "fat": 11, "protein": 26},
    {"name": "Chicken Wing, cooked", "calories": 290, "carbs": 0, "fat": 19, "protein": 27},
    {"name": "Chicken Drumstick, cooked", "calories": 172, "carbs": 0, "fat": 8.4, "protein": 24},
    {"name": "Ground Chicken, cooked", "calories": 189, "carbs": 0, "fat": 11, "protein": 22},
    {"name": "Chicken (bone-in), fried", "calories": 280, "carbs": 8.0, "fat": 17, "protein": 22},
    {"name": "Turkey Breast, cooked", "calories": 135, "carbs": 0, "fat": 1.0, "protein": 30},
    {"name": "Ground Turkey, cooked", "calories": 203, "carbs": 0, "fat": 10, "protein": 27},
    {"name": "Duck, cooked", "calories": 337, "carbs": 0, "fat": 28, "protein": 19},
    {"name": "Duck Fat", "calories": 900, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Ground Beef 80/20, cooked", "calories": 270, "carbs": 0, "fat": 18, "protein": 26},
    {"name": "Ground Beef 90/10, cooked", "calories": 210, "carbs": 0, "fat": 11, "protein": 26},
    {"name": "Ribeye Steak, cooked", "calories": 291, "carbs": 0, "fat": 22, "protein": 24},
    {"name": "Sirloin Steak, cooked", "calories": 201, "carbs": 0, "fat": 8.7, "protein": 29},
    {"name": "Flank Steak, cooked", "calories": 192, "carbs": 0, "fat": 9.3, "protein": 26},
    {"name": "Beef Brisket, cooked", "calories": 246, "carbs": 0, "fat": 15, "protein": 29},
    {"name": "Beef Strips, cooked", "calories": 220, "carbs": 0, "fat": 13, "protein": 25},
    {"name": "Beef, stew meat, cooked", "calories": 215, "carbs": 0, "fat": 10, "protein": 29},
    {"name": "Pork Chop, cooked", "calories": 231, "carbs": 0, "fat": 13, "protein": 26},
    {"name": "Pork Tenderloin, cooked", "calories": 143, "carbs": 0, "fat": 3.5, "protein": 26},
    {"name": "Pork Belly, cooked", "calories": 404, "carbs": 0, "fat": 32, "protein": 27},
    {"name": "Ground Pork, cooked", "calories": 263, "carbs": 0, "fat": 21, "protein": 20},
    {"name": "Pulled Pork", "calories": 240, "carbs": 4.0, "fat": 14, "protein": 24},
    {"name": "Carnitas (Pork), cooked", "calories": 280, "carbs": 0, "fat": 20, "protein": 24},
    {"name": "Al Pastor Pork, cooked", "calories": 250, "carbs": 3.0, "fat": 16, "protein": 22},
    {"name": "Chorizo, cooked", "calories": 455, "carbs": 2.0, "fat": 38, "protein": 24},
    {"name": "Bacon, cooked", "calories": 541, "carbs": 1.4, "fat": 42, "protein": 37},
    {"name": "Sausage (pork)", "calories": 301, "carbs": 1.5, "fat": 27, "protein": 12.5},
    {"name": "Hot Dog Sausage", "calories": 290, "carbs": 4.0, "fat": 26, "protein": 11},
    {"name": "Ham", "calories": 145, "carbs": 1.5, "fat": 5.5, "protein": 21},
    {"name": "Lamb, cooked", "calories": 294, "carbs": 0, "fat": 21, "protein": 25},

    # ------------------------------------------------------------------
    # Fish & seafood
    # ------------------------------------------------------------------
    {"name": "Salmon, cooked", "calories": 208, "carbs": 0, "fat": 13, "protein": 20},
    {"name": "Tuna, canned in water", "calories": 116, "carbs": 0, "fat": 1.0, "protein": 26},
    {"name": "Tuna, raw (sashimi grade)", "calories": 144, "carbs": 0, "fat": 4.9, "protein": 23},
    {"name": "Shrimp, cooked", "calories": 99, "carbs": 0.2, "fat": 0.3, "protein": 24},
    {"name": "Dried Shrimp", "calories": 264, "carbs": 1.0, "fat": 3.0, "protein": 59},
    {"name": "Cod, cooked", "calories": 105, "carbs": 0, "fat": 0.9, "protein": 23},
    {"name": "Tilapia, cooked", "calories": 128, "carbs": 0, "fat": 2.7, "protein": 26},
    {"name": "Halibut, cooked", "calories": 140, "carbs": 0, "fat": 2.9, "protein": 27},
    {"name": "Crab, cooked", "calories": 97, "carbs": 0, "fat": 1.5, "protein": 19},
    {"name": "Lobster, cooked", "calories": 89, "carbs": 0.5, "fat": 0.9, "protein": 19},
    {"name": "Sardines, canned", "calories": 208, "carbs": 0, "fat": 11, "protein": 25},
    {"name": "Mahi Mahi, cooked", "calories": 109, "carbs": 0, "fat": 0.9, "protein": 24},
    {"name": "Eel, cooked (unagi)", "calories": 236, "carbs": 0, "fat": 15, "protein": 24},
    {"name": "Octopus, cooked", "calories": 164, "carbs": 4.4, "fat": 2.1, "protein": 30},
    {"name": "Bonito Flakes", "calories": 356, "carbs": 0, "fat": 3.0, "protein": 77},

    # ------------------------------------------------------------------
    # Eggs & dairy
    # ------------------------------------------------------------------
    {"name": "Egg, whole", "calories": 155, "carbs": 1.1, "fat": 11, "protein": 13},
    {"name": "Egg White", "calories": 52, "carbs": 0.7, "fat": 0.2, "protein": 11},
    {"name": "Egg Yolk", "calories": 322, "carbs": 3.6, "fat": 27, "protein": 16},
    {"name": "Cream Cheese", "calories": 342, "carbs": 4.1, "fat": 34, "protein": 6.2},
    {"name": "Cheddar Cheese", "calories": 403, "carbs": 1.3, "fat": 33, "protein": 25},
    {"name": "Mozzarella Cheese", "calories": 280, "carbs": 2.2, "fat": 17, "protein": 28},
    {"name": "Parmesan Cheese", "calories": 431, "carbs": 4.1, "fat": 29, "protein": 38},
    {"name": "Swiss Cheese", "calories": 380, "carbs": 1.4, "fat": 28, "protein": 27},
    {"name": "Gruyere Cheese", "calories": 413, "carbs": 0.4, "fat": 32, "protein": 30},
    {"name": "Feta Cheese", "calories": 264, "carbs": 4.1, "fat": 21, "protein": 14},
    {"name": "Goat Cheese", "calories": 364, "carbs": 2.5, "fat": 30, "protein": 22},
    {"name": "Brie Cheese", "calories": 334, "carbs": 0.5, "fat": 28, "protein": 21},
    {"name": "Blue Cheese", "calories": 353, "carbs": 2.3, "fat": 29, "protein": 21},
    {"name": "Ricotta Cheese", "calories": 174, "carbs": 3.0, "fat": 13, "protein": 11},
    {"name": "String Cheese", "calories": 300, "carbs": 2.0, "fat": 22, "protein": 24},
    {"name": "American Cheese", "calories": 371, "carbs": 9.0, "fat": 31, "protein": 18},
    {"name": "Provolone Cheese", "calories": 351, "carbs": 2.1, "fat": 27, "protein": 26},
    {"name": "Cottage Cheese", "calories": 98, "carbs": 3.4, "fat": 4.3, "protein": 11},
    {"name": "Queso Fresco", "calories": 264, "carbs": 4.5, "fat": 20, "protein": 18},
    {"name": "Cotija Cheese", "calories": 375, "carbs": 3.0, "fat": 30, "protein": 22},
    {"name": "Paneer", "calories": 265, "carbs": 3.6, "fat": 21, "protein": 18},
    {"name": "Whole Milk", "calories": 61, "carbs": 4.8, "fat": 3.3, "protein": 3.2},
    {"name": "Skim Milk", "calories": 34, "carbs": 5.0, "fat": 0.1, "protein": 3.4},
    {"name": "2% Milk", "calories": 50, "carbs": 4.9, "fat": 2.0, "protein": 3.3},
    {"name": "Almond Milk, unsweetened", "calories": 13, "carbs": 0.6, "fat": 1.1, "protein": 0.4},
    {"name": "Oat Milk", "calories": 47, "carbs": 7.0, "fat": 1.5, "protein": 1.0},
    {"name": "Soy Milk", "calories": 33, "carbs": 1.8, "fat": 1.8, "protein": 2.9},
    {"name": "Buttermilk", "calories": 40, "carbs": 4.8, "fat": 1.0, "protein": 3.3},
    {"name": "Greek Yogurt, plain nonfat", "calories": 59, "carbs": 3.6, "fat": 0.4, "protein": 10},
    {"name": "Yogurt, plain whole milk", "calories": 61, "carbs": 4.7, "fat": 3.3, "protein": 3.5},
    {"name": "Heavy Cream", "calories": 340, "carbs": 3.0, "fat": 36, "protein": 2.8},
    {"name": "Half and Half", "calories": 130, "carbs": 4.3, "fat": 11.5, "protein": 3.0},
    {"name": "Sour Cream", "calories": 195, "carbs": 4.2, "fat": 19.5, "protein": 3.4},
    {"name": "Custard", "calories": 100, "carbs": 15, "fat": 3.6, "protein": 4.4},
    {"name": "Butter", "calories": 717, "carbs": 0.1, "fat": 81, "protein": 0.9},
    {"name": "Ghee", "calories": 900, "carbs": 0, "fat": 100, "protein": 0},

    # ------------------------------------------------------------------
    # Legumes, tofu & plant protein
    # ------------------------------------------------------------------
    {"name": "Tofu", "calories": 76, "carbs": 1.9, "fat": 4.8, "protein": 8.0},
    {"name": "Tempeh", "calories": 192, "carbs": 7.6, "fat": 11, "protein": 20},
    {"name": "Black Beans, cooked", "calories": 132, "carbs": 24, "fat": 0.5, "protein": 8.9},
    {"name": "Kidney Beans, cooked", "calories": 127, "carbs": 23, "fat": 0.5, "protein": 8.7},
    {"name": "Chickpeas, cooked", "calories": 164, "carbs": 27, "fat": 2.6, "protein": 8.9},
    {"name": "Pinto Beans, cooked", "calories": 143, "carbs": 26, "fat": 0.7, "protein": 9.0},
    {"name": "Refried Beans", "calories": 93, "carbs": 15, "fat": 1.5, "protein": 5.4},
    {"name": "Edamame, cooked", "calories": 122, "carbs": 9, "fat": 7.7, "protein": 11.5},
    {"name": "Lentils, cooked", "calories": 116, "carbs": 20, "fat": 0.4, "protein": 9.0},
    {"name": "Green Peas, cooked", "calories": 84, "carbs": 15, "fat": 0.4, "protein": 5.4},

    # ------------------------------------------------------------------
    # Nuts, seeds & nut butters
    # ------------------------------------------------------------------
    {"name": "Almonds", "calories": 579, "carbs": 22, "fat": 50, "protein": 21},
    {"name": "Walnuts", "calories": 654, "carbs": 14, "fat": 65, "protein": 15},
    {"name": "Cashews", "calories": 553, "carbs": 30, "fat": 44, "protein": 18},
    {"name": "Peanuts", "calories": 567, "carbs": 16, "fat": 49, "protein": 26},
    {"name": "Pistachios", "calories": 560, "carbs": 28, "fat": 45, "protein": 20},
    {"name": "Pecans", "calories": 691, "carbs": 14, "fat": 72, "protein": 9.2},
    {"name": "Sunflower Seeds", "calories": 584, "carbs": 20, "fat": 51, "protein": 21},
    {"name": "Sesame Seeds", "calories": 573, "carbs": 23, "fat": 50, "protein": 18},
    {"name": "Chia Seeds", "calories": 486, "carbs": 42, "fat": 31, "protein": 17},
    {"name": "Flax Seeds", "calories": 534, "carbs": 29, "fat": 42, "protein": 18},
    {"name": "Peanut Butter", "calories": 588, "carbs": 20, "fat": 50, "protein": 25},
    {"name": "Almond Butter", "calories": 614, "carbs": 19, "fat": 56, "protein": 21},
    {"name": "Peanut Sauce", "calories": 245, "carbs": 15, "fat": 18, "protein": 9.0},

    # ------------------------------------------------------------------
    # Fruits
    # ------------------------------------------------------------------
    {"name": "Banana", "calories": 89, "carbs": 23, "fat": 0.3, "protein": 1.1},
    {"name": "Apple", "calories": 52, "carbs": 14, "fat": 0.2, "protein": 0.3},
    {"name": "Orange", "calories": 47, "carbs": 12, "fat": 0.1, "protein": 0.9},
    {"name": "Grapes", "calories": 69, "carbs": 18, "fat": 0.2, "protein": 0.7},
    {"name": "Watermelon", "calories": 30, "carbs": 7.6, "fat": 0.2, "protein": 0.6},
    {"name": "Pineapple", "calories": 50, "carbs": 13, "fat": 0.1, "protein": 0.5},
    {"name": "Mango", "calories": 60, "carbs": 15, "fat": 0.4, "protein": 0.8},
    {"name": "Peach", "calories": 39, "carbs": 9.5, "fat": 0.3, "protein": 0.9},
    {"name": "Pear", "calories": 57, "carbs": 15, "fat": 0.1, "protein": 0.4},
    {"name": "Kiwi", "calories": 61, "carbs": 15, "fat": 0.5, "protein": 1.1},
    {"name": "Cherries", "calories": 63, "carbs": 16, "fat": 0.2, "protein": 1.1},
    {"name": "Strawberries", "calories": 32, "carbs": 7.7, "fat": 0.3, "protein": 0.7},
    {"name": "Blueberries", "calories": 57, "carbs": 14.5, "fat": 0.3, "protein": 0.7},
    {"name": "Raspberries", "calories": 52, "carbs": 12, "fat": 0.7, "protein": 1.2},
    {"name": "Blackberries", "calories": 43, "carbs": 10, "fat": 0.5, "protein": 1.4},
    {"name": "Cantaloupe", "calories": 34, "carbs": 8.2, "fat": 0.2, "protein": 0.8},
    {"name": "Grapefruit", "calories": 42, "carbs": 11, "fat": 0.1, "protein": 0.8},
    {"name": "Dates", "calories": 277, "carbs": 75, "fat": 0.2, "protein": 1.8},
    {"name": "Raisins", "calories": 299, "carbs": 79, "fat": 0.5, "protein": 3.1},
    {"name": "Avocado", "calories": 160, "carbs": 8.5, "fat": 15, "protein": 2.0},
    {"name": "Green Papaya", "calories": 43, "carbs": 11, "fat": 0.1, "protein": 0.5},
    {"name": "Lime Juice", "calories": 25, "carbs": 8.4, "fat": 0.1, "protein": 0.4},
    {"name": "Tomatillo", "calories": 32, "carbs": 5.8, "fat": 1.0, "protein": 1.0},

    # ------------------------------------------------------------------
    # Vegetables & aromatics
    # ------------------------------------------------------------------
    {"name": "Broccoli", "calories": 34, "carbs": 7.0, "fat": 0.4, "protein": 2.8},
    {"name": "Spinach", "calories": 23, "carbs": 3.6, "fat": 0.4, "protein": 2.9},
    {"name": "Potato, baked", "calories": 93, "carbs": 21, "fat": 0.1, "protein": 2.5},
    {"name": "Sweet Potato, baked", "calories": 90, "carbs": 21, "fat": 0.2, "protein": 2.0},
    {"name": "Carrot", "calories": 41, "carbs": 10, "fat": 0.2, "protein": 0.9},
    {"name": "Cucumber", "calories": 15, "carbs": 3.6, "fat": 0.1, "protein": 0.7},
    {"name": "Tomato", "calories": 18, "carbs": 3.9, "fat": 0.2, "protein": 0.9},
    {"name": "Bell Pepper", "calories": 31, "carbs": 6.0, "fat": 0.3, "protein": 1.0},
    {"name": "Poblano Pepper", "calories": 20, "carbs": 4.6, "fat": 0.2, "protein": 0.9},
    {"name": "Jalapeno Pepper", "calories": 29, "carbs": 6.5, "fat": 0.4, "protein": 0.9},
    {"name": "Chili Pepper", "calories": 40, "carbs": 9.0, "fat": 0.4, "protein": 1.9},
    {"name": "Onion", "calories": 40, "carbs": 9.3, "fat": 0.1, "protein": 1.1},
    {"name": "Shallot", "calories": 72, "carbs": 17, "fat": 0.1, "protein": 2.5},
    {"name": "Leeks", "calories": 61, "carbs": 14, "fat": 0.3, "protein": 1.5},
    {"name": "Garlic", "calories": 149, "carbs": 33, "fat": 0.5, "protein": 6.4},
    {"name": "Ginger", "calories": 80, "carbs": 18, "fat": 0.8, "protein": 1.8},
    {"name": "Galangal", "calories": 71, "carbs": 15, "fat": 1.0, "protein": 1.5},
    {"name": "Lemongrass", "calories": 99, "carbs": 25, "fat": 0.5, "protein": 1.8},
    {"name": "Zucchini", "calories": 17, "carbs": 3.1, "fat": 0.3, "protein": 1.2},
    {"name": "Cauliflower", "calories": 25, "carbs": 5.0, "fat": 0.3, "protein": 1.9},
    {"name": "Asparagus", "calories": 20, "carbs": 3.9, "fat": 0.1, "protein": 2.2},
    {"name": "Green Beans", "calories": 31, "carbs": 7.0, "fat": 0.1, "protein": 1.8},
    {"name": "Brussels Sprouts", "calories": 43, "carbs": 9.0, "fat": 0.3, "protein": 3.4},
    {"name": "Cabbage", "calories": 25, "carbs": 5.8, "fat": 0.1, "protein": 1.3},
    {"name": "Kale", "calories": 49, "carbs": 8.8, "fat": 0.9, "protein": 4.3},
    {"name": "Mushroom", "calories": 22, "carbs": 3.3, "fat": 0.3, "protein": 3.1},
    {"name": "Corn", "calories": 86, "carbs": 19, "fat": 1.2, "protein": 3.3},
    {"name": "Beet", "calories": 43, "carbs": 10, "fat": 0.2, "protein": 1.6},
    {"name": "Bean Sprouts", "calories": 30, "carbs": 5.9, "fat": 0.2, "protein": 3.0},
    {"name": "Scallion", "calories": 32, "carbs": 7.3, "fat": 0.2, "protein": 1.8},
    {"name": "Cilantro", "calories": 23, "carbs": 3.7, "fat": 0.5, "protein": 2.1},
    {"name": "Thai Basil", "calories": 22, "carbs": 2.7, "fat": 0.6, "protein": 3.2},
    {"name": "Romaine Lettuce", "calories": 17, "carbs": 3.3, "fat": 0.3, "protein": 1.2},
    {"name": "Lettuce", "calories": 15, "carbs": 2.9, "fat": 0.2, "protein": 1.4},

    # ------------------------------------------------------------------
    # Oils, sauces, condiments & spices
    # ------------------------------------------------------------------
    {"name": "Olive Oil", "calories": 884, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Coconut Oil", "calories": 862, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Avocado Oil", "calories": 884, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Sesame Oil", "calories": 884, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Vegetable Oil", "calories": 884, "carbs": 0, "fat": 100, "protein": 0},
    {"name": "Mayonnaise", "calories": 680, "carbs": 0.6, "fat": 75, "protein": 1.0},
    {"name": "Ketchup", "calories": 112, "carbs": 27, "fat": 0.1, "protein": 1.2},
    {"name": "Mustard", "calories": 66, "carbs": 5.8, "fat": 4.0, "protein": 4.4},
    {"name": "Dijon Mustard", "calories": 150, "carbs": 8.0, "fat": 9.0, "protein": 5.0},
    {"name": "Pickles", "calories": 11, "carbs": 2.3, "fat": 0.2, "protein": 0.3},
    {"name": "BBQ Sauce", "calories": 172, "carbs": 40, "fat": 0.6, "protein": 1.0},
    {"name": "Soy Sauce", "calories": 53, "carbs": 4.9, "fat": 0.1, "protein": 8.1},
    {"name": "Fish Sauce", "calories": 35, "carbs": 3.6, "fat": 0, "protein": 5.1},
    {"name": "Oyster Sauce", "calories": 51, "carbs": 11, "fat": 0.3, "protein": 1.4},
    {"name": "Tamarind Paste", "calories": 239, "carbs": 63, "fat": 0.6, "protein": 2.8},
    {"name": "Palm Sugar", "calories": 383, "carbs": 98, "fat": 0, "protein": 0},
    {"name": "Thai Red Curry Paste", "calories": 100, "carbs": 12, "fat": 4.0, "protein": 3.0},
    {"name": "Thai Green Curry Paste", "calories": 95, "carbs": 11, "fat": 4.0, "protein": 3.0},
    {"name": "Panang Curry Paste", "calories": 105, "carbs": 12, "fat": 5.0, "protein": 3.0},
    {"name": "Massaman Curry Paste", "calories": 110, "carbs": 13, "fat": 5.0, "protein": 3.0},
    {"name": "Yellow Curry Paste", "calories": 100, "carbs": 12, "fat": 4.0, "protein": 3.0},
    {"name": "Coconut Milk", "calories": 230, "carbs": 3.3, "fat": 24, "protein": 2.3},
    {"name": "Salsa", "calories": 36, "carbs": 8.0, "fat": 0.2, "protein": 1.6},
    {"name": "Pico de Gallo", "calories": 30, "carbs": 6.8, "fat": 0.2, "protein": 1.2},
    {"name": "Guacamole", "calories": 150, "carbs": 8.5, "fat": 13, "protein": 2.0},
    {"name": "Enchilada Sauce", "calories": 33, "carbs": 6.0, "fat": 1.0, "protein": 0.8},
    {"name": "Adobo Sauce", "calories": 60, "carbs": 10, "fat": 2.0, "protein": 1.0},
    {"name": "Chipotle Pepper in Adobo", "calories": 96, "carbs": 18, "fat": 2.0, "protein": 4.0},
    {"name": "Taco Seasoning", "calories": 330, "carbs": 60, "fat": 5.0, "protein": 12},
    {"name": "Mole Sauce", "calories": 160, "carbs": 14, "fat": 10, "protein": 3.5},
    {"name": "Nori (seaweed)", "calories": 349, "carbs": 44, "fat": 2.0, "protein": 35},
    {"name": "Miso Paste", "calories": 199, "carbs": 26, "fat": 6.0, "protein": 12},
    {"name": "Dashi Stock", "calories": 5, "carbs": 0.7, "fat": 0.1, "protein": 0.6},
    {"name": "Mirin", "calories": 237, "carbs": 50, "fat": 0, "protein": 0.5},
    {"name": "Wasabi", "calories": 109, "carbs": 24, "fat": 0.6, "protein": 4.8},
    {"name": "Rice Vinegar", "calories": 18, "carbs": 0.4, "fat": 0, "protein": 0},
    {"name": "Teriyaki Sauce", "calories": 89, "carbs": 16, "fat": 0, "protein": 6.0},
    {"name": "Katsu Sauce", "calories": 130, "carbs": 30, "fat": 0.2, "protein": 1.2},
    {"name": "Tempura Batter", "calories": 346, "carbs": 75, "fat": 1.0, "protein": 8.0},
    {"name": "Curry Roux (Japanese)", "calories": 470, "carbs": 45, "fat": 30, "protein": 5.0},
    {"name": "Okonomiyaki Sauce", "calories": 120, "carbs": 28, "fat": 0.1, "protein": 1.5},
    {"name": "Seaweed Salad (Wakame)", "calories": 45, "carbs": 5.0, "fat": 2.0, "protein": 1.5},
    {"name": "White Wine", "calories": 82, "carbs": 2.6, "fat": 0, "protein": 0.1},
    {"name": "Red Wine", "calories": 85, "carbs": 2.6, "fat": 0, "protein": 0.1},
    {"name": "Thyme", "calories": 276, "carbs": 64, "fat": 7.4, "protein": 9.1},
    {"name": "Bay Leaf", "calories": 313, "carbs": 75, "fat": 8.4, "protein": 7.6},
    {"name": "Vanilla Extract", "calories": 288, "carbs": 13, "fat": 0.1, "protein": 0.1},
    {"name": "Garam Masala", "calories": 379, "carbs": 55, "fat": 15, "protein": 15},
    {"name": "Turmeric", "calories": 312, "carbs": 67, "fat": 3.3, "protein": 9.7},
    {"name": "Cumin", "calories": 375, "carbs": 44, "fat": 22, "protein": 18},
    {"name": "Coriander Powder", "calories": 298, "carbs": 55, "fat": 18, "protein": 12},
    {"name": "Curry Leaves", "calories": 108, "carbs": 18, "fat": 1.0, "protein": 6.1},
    {"name": "Mustard Seeds", "calories": 508, "carbs": 28, "fat": 36, "protein": 26},
    {"name": "Cardamom", "calories": 311, "carbs": 68, "fat": 6.7, "protein": 11},
    {"name": "Cinnamon", "calories": 247, "carbs": 81, "fat": 1.2, "protein": 4.0},
    {"name": "Chili Powder", "calories": 282, "carbs": 50, "fat": 14, "protein": 13},
    {"name": "Tikka Masala Sauce", "calories": 95, "carbs": 7.0, "fat": 6.0, "protein": 2.5},
    {"name": "Curry Sauce (Indian, general)", "calories": 110, "carbs": 8.0, "fat": 7.5, "protein": 3.0},
    {"name": "Honey", "calories": 304, "carbs": 82, "fat": 0, "protein": 0.3},
    {"name": "Maple Syrup", "calories": 260, "carbs": 67, "fat": 0.2, "protein": 0},
    {"name": "Sugar, white", "calories": 387, "carbs": 100, "fat": 0, "protein": 0},
    {"name": "Brown Sugar", "calories": 380, "carbs": 98, "fat": 0, "protein": 0},

    # ------------------------------------------------------------------
    # Snacks, sweets & baking staples
    # ------------------------------------------------------------------
    {"name": "Dark Chocolate", "calories": 546, "carbs": 61, "fat": 31, "protein": 4.9},
    {"name": "Milk Chocolate", "calories": 535, "carbs": 59, "fat": 30, "protein": 7.7},
    {"name": "Granola Bar", "calories": 471, "carbs": 64, "fat": 20, "protein": 10},
    {"name": "Popcorn, air-popped", "calories": 387, "carbs": 78, "fat": 4.5, "protein": 13},
    {"name": "Potato Chips", "calories": 536, "carbs": 53, "fat": 34, "protein": 7.0},
    {"name": "Tortilla Chips", "calories": 489, "carbs": 63, "fat": 24, "protein": 7.0},
    {"name": "Pretzels", "calories": 380, "carbs": 80, "fat": 2.6, "protein": 10},
    {"name": "Ice Cream", "calories": 207, "carbs": 24, "fat": 11, "protein": 3.5},
    {"name": "Graham Cracker", "calories": 421, "carbs": 76, "fat": 11, "protein": 7.0},
    {"name": "Marshmallow", "calories": 318, "carbs": 81, "fat": 0.2, "protein": 1.8},
    {"name": "Chocolate Chips", "calories": 479, "carbs": 63, "fat": 27, "protein": 4.2},
    {"name": "Croutons", "calories": 407, "carbs": 65, "fat": 12, "protein": 11},
    {"name": "Caesar Dressing", "calories": 467, "carbs": 3.0, "fat": 49, "protein": 2.0},
    {"name": "Macarons", "calories": 384, "carbs": 55, "fat": 17, "protein": 6.0},

    # ------------------------------------------------------------------
    # Protein supplements
    # ------------------------------------------------------------------
    {"name": "Whey Protein Powder", "calories": 400, "carbs": 8.0, "fat": 5.0, "protein": 80},
    {"name": "Casein Protein Powder", "calories": 375, "carbs": 11, "fat": 3.5, "protein": 75},
    {"name": "Plant Protein Powder", "calories": 380, "carbs": 15, "fat": 6.0, "protein": 70},

    # ------------------------------------------------------------------
    # Italian & Mediterranean pantry
    # ------------------------------------------------------------------
    {"name": "Prosciutto", "calories": 267, "carbs": 0.6, "fat": 16.7, "protein": 26.7},
    {"name": "Pancetta", "calories": 357, "carbs": 0.5, "fat": 28.6, "protein": 21.4},
    {"name": "Pecorino Romano Cheese", "calories": 387, "carbs": 3.6, "fat": 27, "protein": 32},
    {"name": "Basil, fresh", "calories": 23, "carbs": 2.7, "fat": 0.6, "protein": 3.2},
    {"name": "Oregano, dried", "calories": 265, "carbs": 69, "fat": 4.3, "protein": 9.0},
    {"name": "Balsamic Vinegar", "calories": 88, "carbs": 17, "fat": 0, "protein": 0.5},
    {"name": "Arborio Rice, cooked", "calories": 130, "carbs": 28, "fat": 0.3, "protein": 2.7},
    {"name": "Polenta, cooked", "calories": 70, "carbs": 15, "fat": 0.3, "protein": 1.6},
    {"name": "Pesto Sauce", "calories": 303, "carbs": 4.0, "fat": 30, "protein": 4.0},
    {"name": "Marinara Sauce", "calories": 32, "carbs": 6.0, "fat": 1.0, "protein": 1.5},
    {"name": "Alfredo Sauce", "calories": 380, "carbs": 6.0, "fat": 38, "protein": 5.0},
    {"name": "Italian Sausage, cooked", "calories": 310, "carbs": 2.0, "fat": 26, "protein": 17},
    {"name": "Salami", "calories": 407, "carbs": 1.5, "fat": 34, "protein": 22},
    {"name": "Mortadella", "calories": 288, "carbs": 3.0, "fat": 24, "protein": 15},
    {"name": "Capers", "calories": 23, "carbs": 4.9, "fat": 0.9, "protein": 2.4},
    {"name": "Sun-Dried Tomatoes", "calories": 258, "carbs": 55, "fat": 3.0, "protein": 14},
    {"name": "Artichoke Hearts", "calories": 47, "carbs": 11, "fat": 0.4, "protein": 3.3},
    {"name": "Pine Nuts", "calories": 673, "carbs": 13, "fat": 68, "protein": 14},
    {"name": "Lasagna Noodles, cooked", "calories": 131, "carbs": 25, "fat": 1.1, "protein": 5.0},
    {"name": "Gnocchi, cooked", "calories": 150, "carbs": 31, "fat": 0.5, "protein": 3.5},
    {"name": "Mascarpone Cheese", "calories": 429, "carbs": 4.0, "fat": 44, "protein": 5.0},
    {"name": "Ladyfingers (Savoiardi)", "calories": 384, "carbs": 74, "fat": 5.0, "protein": 8.0},
    {"name": "Cocoa Powder", "calories": 228, "carbs": 58, "fat": 14, "protein": 20},
    {"name": "Espresso", "calories": 2, "carbs": 0.3, "fat": 0.1, "protein": 0.1},

    # ------------------------------------------------------------------
    # Chinese pantry
    # ------------------------------------------------------------------
    {"name": "Hoisin Sauce", "calories": 220, "carbs": 44, "fat": 2.5, "protein": 3.0},
    {"name": "Dark Soy Sauce", "calories": 60, "carbs": 9.0, "fat": 0, "protein": 6.0},
    {"name": "Shaoxing Wine", "calories": 106, "carbs": 2.0, "fat": 0, "protein": 0},
    {"name": "Five Spice Powder", "calories": 349, "carbs": 65, "fat": 8.0, "protein": 11},
    {"name": "Bok Choy", "calories": 13, "carbs": 2.2, "fat": 0.2, "protein": 1.5},
    {"name": "Napa Cabbage", "calories": 16, "carbs": 3.2, "fat": 0.2, "protein": 1.2},
    {"name": "Water Chestnuts", "calories": 97, "carbs": 24, "fat": 0.1, "protein": 1.4},
    {"name": "Bamboo Shoots", "calories": 27, "carbs": 5.2, "fat": 0.3, "protein": 2.6},
    {"name": "Char Siu Pork, cooked", "calories": 280, "carbs": 12, "fat": 15, "protein": 24},
    {"name": "Wonton Wrapper", "calories": 275, "carbs": 55, "fat": 1.0, "protein": 9.0},
    {"name": "Sichuan Peppercorn", "calories": 260, "carbs": 62, "fat": 8.0, "protein": 8.0},
    {"name": "Chili Oil", "calories": 884, "carbs": 1.0, "fat": 98, "protein": 0},
    {"name": "Black Bean Sauce", "calories": 137, "carbs": 20, "fat": 2.0, "protein": 9.0},
    {"name": "Snow Peas", "calories": 42, "carbs": 7.6, "fat": 0.2, "protein": 2.8},
    {"name": "Duck Sauce", "calories": 176, "carbs": 43, "fat": 0, "protein": 0.3},
    {"name": "Mandarin Pancake", "calories": 230, "carbs": 45, "fat": 3.0, "protein": 6.0},

    # ------------------------------------------------------------------
    # Korean pantry
    # ------------------------------------------------------------------
    {"name": "Gochujang", "calories": 210, "carbs": 46, "fat": 1.0, "protein": 5.0},
    {"name": "Gochugaru", "calories": 282, "carbs": 50, "fat": 13, "protein": 12},
    {"name": "Doenjang", "calories": 175, "carbs": 15, "fat": 6.0, "protein": 16},
    {"name": "Kimchi", "calories": 15, "carbs": 2.4, "fat": 0.5, "protein": 1.1},
    {"name": "Bulgogi Beef, cooked", "calories": 210, "carbs": 5.0, "fat": 9.0, "protein": 27},
    {"name": "Rice Cake (Tteok)", "calories": 240, "carbs": 52, "fat": 0.5, "protein": 4.0},
    {"name": "Perilla Leaves", "calories": 37, "carbs": 4.0, "fat": 1.0, "protein": 3.0},
    {"name": "Korean Short Rib, cooked", "calories": 280, "carbs": 3.0, "fat": 20, "protein": 22},
    {"name": "Korean Fish Cake", "calories": 140, "carbs": 15, "fat": 5.0, "protein": 8.0},
    {"name": "Korean BBQ Sauce", "calories": 120, "carbs": 25, "fat": 0.5, "protein": 3.0},

    # ------------------------------------------------------------------
    # Vietnamese pantry
    # ------------------------------------------------------------------
    {"name": "Rice Paper", "calories": 323, "carbs": 72, "fat": 1.1, "protein": 5.9},
    {"name": "Vermicelli Noodles, cooked", "calories": 110, "carbs": 25, "fat": 0.2, "protein": 1.0},
    {"name": "Pho Broth", "calories": 15, "carbs": 1.0, "fat": 0.5, "protein": 1.5},
    {"name": "Mint, fresh", "calories": 44, "carbs": 8.0, "fat": 0.7, "protein": 3.3},
    {"name": "Coffee, black", "calories": 2, "carbs": 0, "fat": 0, "protein": 0.3},

    # ------------------------------------------------------------------
    # Greek & Mediterranean pantry
    # ------------------------------------------------------------------
    {"name": "Kalamata Olives", "calories": 115, "carbs": 6.0, "fat": 11, "protein": 0.8},
    {"name": "Green Olives", "calories": 145, "carbs": 4.0, "fat": 15, "protein": 1.0},
    {"name": "Tzatziki", "calories": 75, "carbs": 4.0, "fat": 5.0, "protein": 4.0},
    {"name": "Hummus", "calories": 166, "carbs": 14, "fat": 10, "protein": 8.0},
    {"name": "Tahini", "calories": 595, "carbs": 21, "fat": 54, "protein": 17},
    {"name": "Phyllo Dough", "calories": 265, "carbs": 48, "fat": 5.0, "protein": 7.0},
    {"name": "Halloumi Cheese", "calories": 321, "carbs": 2.0, "fat": 25, "protein": 22},
    {"name": "Grape Leaves", "calories": 20, "carbs": 4.0, "fat": 0.3, "protein": 1.5},
    {"name": "Ground Lamb, cooked", "calories": 282, "carbs": 0, "fat": 23, "protein": 17},
    {"name": "Dill", "calories": 43, "carbs": 7.0, "fat": 1.1, "protein": 3.5},
    {"name": "Orzo, cooked", "calories": 150, "carbs": 30, "fat": 0.5, "protein": 5.0},
    {"name": "Pomegranate Seeds", "calories": 83, "carbs": 19, "fat": 1.2, "protein": 1.7},
    {"name": "Eggplant", "calories": 25, "carbs": 6.0, "fat": 0.2, "protein": 1.0},

    # ------------------------------------------------------------------
    # Middle Eastern pantry
    # ------------------------------------------------------------------
    {"name": "Za'atar", "calories": 300, "carbs": 35, "fat": 14, "protein": 10},
    {"name": "Baba Ghanoush", "calories": 90, "carbs": 7.0, "fat": 6.0, "protein": 2.0},
    {"name": "Shawarma Chicken, cooked", "calories": 220, "carbs": 2.0, "fat": 12, "protein": 25},
    {"name": "Shawarma Lamb, cooked", "calories": 260, "carbs": 2.0, "fat": 16, "protein": 24},
    {"name": "Labneh", "calories": 150, "carbs": 4.0, "fat": 11, "protein": 8.0},
    {"name": "Lavash Flatbread", "calories": 280, "carbs": 56, "fat": 2.0, "protein": 9.0},
    {"name": "Sumac", "calories": 280, "carbs": 50, "fat": 3.0, "protein": 6.0},
    {"name": "Falafel, fried", "calories": 333, "carbs": 32, "fat": 18, "protein": 13},

    # ------------------------------------------------------------------
    # Breakfast, cereals & beverages
    # ------------------------------------------------------------------
    {"name": "Corn Flakes", "calories": 357, "carbs": 84, "fat": 0.4, "protein": 7.5},
    {"name": "Granola", "calories": 471, "carbs": 64, "fat": 20, "protein": 10},
    {"name": "Orange Juice", "calories": 45, "carbs": 10, "fat": 0.2, "protein": 0.7},
    {"name": "Apple Juice", "calories": 46, "carbs": 11, "fat": 0.1, "protein": 0.1},
    {"name": "Fruit Jam", "calories": 278, "carbs": 69, "fat": 0.1, "protein": 0.4},
    {"name": "Nutella", "calories": 539, "carbs": 57, "fat": 31, "protein": 6.0},
    {"name": "Hash Browns", "calories": 210, "carbs": 22, "fat": 13, "protein": 2.0},
    {"name": "Protein Bar", "calories": 380, "carbs": 35, "fat": 14, "protein": 25},
    {"name": "Whipped Cream", "calories": 257, "carbs": 6.0, "fat": 25, "protein": 2.0},
    {"name": "Okra", "calories": 33, "carbs": 7.0, "fat": 0.2, "protein": 1.9},

    # ------------------------------------------------------------------
    # Commercial brands & restaurant chains
    # Per-100g figures below are back-calculated from each chain's
    # typical published total calories/macros for one whole item divided
    # by that item's typical weight -- approximate publicly-known values,
    # not exact or guaranteed to match current menus/recipes.
    # ------------------------------------------------------------------
    {"name": "Big Mac", "calories": 251, "carbs": 20.5, "fat": 13.7, "protein": 11.4},
    {"name": "McChicken", "calories": 280, "carbs": 28.0, "fat": 14.7, "protein": 9.8},
    {"name": "Quarter Pounder with Cheese", "calories": 261, "carbs": 20.6, "fat": 13.1, "protein": 15.1},
    {"name": "McDonald's Fries", "calories": 291, "carbs": 37.6, "fat": 13.7, "protein": 3.4},
    {"name": "McDonald's Chicken McNuggets", "calories": 275, "carbs": 16.3, "fat": 16.9, "protein": 14.4},
    {"name": "Egg McMuffin", "calories": 228, "carbs": 22.1, "fat": 9.6, "protein": 12.5},
    {"name": "McFlurry with M&Ms", "calories": 158, "carbs": 25.0, "fat": 5.2, "protein": 3.7},
    {"name": "KFC Original Recipe Chicken Breast", "calories": 242, "carbs": 6.8, "fat": 13.0, "protein": 24.2},
    {"name": "KFC Popcorn Chicken", "calories": 333, "carbs": 21.1, "fat": 20.2, "protein": 16.7},
    {"name": "KFC Chicken Sandwich", "calories": 274, "carbs": 27.9, "fat": 12.6, "protein": 13.0},
    {"name": "KFC Mashed Potatoes with Gravy", "calories": 88, "carbs": 12.5, "fat": 2.9, "protein": 1.5},
    {"name": "KFC Coleslaw", "calories": 131, "carbs": 15.4, "fat": 7.7, "protein": 0.8},
    {"name": "Pizza Hut Pepperoni Pan Pizza", "calories": 280, "carbs": 27.0, "fat": 15.0, "protein": 12.0},
    {"name": "Pizza Hut Stuffed Crust Pizza", "calories": 254, "carbs": 26.2, "fat": 11.5, "protein": 11.5},
    {"name": "Pizza Hut Breadstick", "calories": 333, "carbs": 44.4, "fat": 11.1, "protein": 8.9},
    {"name": "Taco Bell Crunchwrap Supreme", "calories": 209, "carbs": 28.0, "fat": 8.3, "protein": 6.3},
    {"name": "Taco Bell Beef Burrito Supreme", "calories": 165, "carbs": 20.6, "fat": 6.0, "protein": 6.9},
    {"name": "Taco Bell Crunchy Taco", "calories": 218, "carbs": 16.7, "fat": 12.8, "protein": 10.3},
    {"name": "Taco Bell Chicken Quesadilla", "calories": 277, "carbs": 21.2, "fat": 14.7, "protein": 14.7},
    {"name": "Wingstop Classic Bone-In Wings", "calories": 200, "carbs": 2.2, "fat": 13.3, "protein": 17.8},
    {"name": "Wingstop Boneless Wings", "calories": 223, "carbs": 15.5, "fat": 11.8, "protein": 12.7},
    {"name": "Wingstop Fries", "calories": 271, "carbs": 36.4, "fat": 12.9, "protein": 3.6},
    {"name": "Five Guys Cheeseburger", "calories": 247, "carbs": 11.5, "fat": 17.1, "protein": 13.8},
    {"name": "Five Guys Fries", "calories": 233, "carbs": 30.0, "fat": 11.5, "protein": 3.0},
    {"name": "Shake Shack ShackBurger", "calories": 250, "carbs": 18.3, "fat": 14.4, "protein": 13.9},
    {"name": "Shake Shack Crinkle Fries", "calories": 214, "carbs": 29.5, "fat": 9.5, "protein": 2.7},
    {"name": "Shake Shack Vanilla Shake", "calories": 140, "carbs": 18.5, "fat": 6.3, "protein": 2.5},
    {"name": "Chagee Classic Milk Tea", "calories": 56, "carbs": 9.6, "fat": 1.6, "protein": 0.6},
    {"name": "Koi The Original Milk Tea with Pearls", "calories": 70, "carbs": 13.0, "fat": 1.6, "protein": 0.8},
    {"name": "Meiji Milk", "calories": 65, "carbs": 4.8, "fat": 3.8, "protein": 3.4},
    {"name": "Mama Cup Noodles, Tom Yum Shrimp, prepared", "calories": 79, "carbs": 11.8, "fat": 3.2, "protein": 1.6},
]


DISHES = [
    # ==================================================================
    # American classics + expanded set (30+)
    # ==================================================================
    _dish("Pizza, cheese", [
        ("White Bread", 120), ("Tomato", 60), ("Mozzarella Cheese", 60), ("Olive Oil", 8),
    ]),
    _dish("Hamburger", [
        ("Ground Beef 80/20, cooked", 110), ("Burger Bun", 70), ("Lettuce", 10),
        ("Tomato", 15), ("Onion", 10), ("Pickles", 10), ("Ketchup", 10), ("Mustard", 5),
    ]),
    _dish("Cheeseburger", [
        ("Ground Beef 80/20, cooked", 110), ("Burger Bun", 70), ("Cheddar Cheese", 20),
        ("Lettuce", 10), ("Tomato", 15), ("Onion", 10), ("Pickles", 10), ("Ketchup", 10),
    ]),
    _dish("French Fries", [("Potato, baked", 200), ("Vegetable Oil", 15)]),
    _dish("Chicken Nuggets", [
        ("Chicken Breast, cooked", 100), ("Flour, All-Purpose", 15),
        ("Panko Breadcrumbs", 20), ("Egg White", 15), ("Vegetable Oil", 15),
    ]),
    _dish("Fried Chicken", [
        ("Chicken (bone-in), fried", 180), ("Flour, All-Purpose", 25),
        ("Buttermilk", 30), ("Vegetable Oil", 15),
    ]),
    _dish("Grilled Cheese Sandwich", [
        ("White Bread", 70), ("Cheddar Cheese", 40), ("Butter", 10),
    ]),
    _dish("Caesar Salad", [
        ("Romaine Lettuce", 150), ("Parmesan Cheese", 15), ("Croutons", 20), ("Caesar Dressing", 25),
    ]),
    _dish("Chicken Caesar Salad", [
        ("Romaine Lettuce", 150), ("Chicken Breast, cooked", 100),
        ("Parmesan Cheese", 15), ("Croutons", 20), ("Caesar Dressing", 25),
    ]),
    _dish("Pancakes", [
        ("Flour, All-Purpose", 90), ("Whole Milk", 120), ("Egg, whole", 55),
        ("Sugar, white", 15), ("Butter", 15), ("Maple Syrup", 30),
    ]),
    _dish("Waffles", [
        ("Flour, All-Purpose", 90), ("Whole Milk", 120), ("Egg, whole", 55),
        ("Sugar, white", 15), ("Butter", 20), ("Maple Syrup", 30),
    ]),
    _dish("Hot Dog", [
        ("Hot Dog Sausage", 60), ("Hot Dog Bun", 55), ("Ketchup", 10), ("Mustard", 8),
    ]),
    _dish("BBQ Ribs", [("Pork Chop, cooked", 220), ("BBQ Sauce", 40)]),
    _dish("Mac and Cheese", [
        ("Pasta, cooked", 200), ("Cheddar Cheese", 60), ("Whole Milk", 60), ("Butter", 15),
    ]),
    _dish("Meatloaf", [
        ("Ground Beef 80/20, cooked", 200), ("Egg, whole", 55),
        ("White Bread", 30), ("Ketchup", 20), ("Onion", 20),
    ]),
    _dish("Buffalo Wings", [
        ("Chicken Wing, cooked", 220), ("Butter", 20), ("BBQ Sauce", 20),
    ]),
    _dish("Chicken Pot Pie", [
        ("Chicken Breast, cooked", 100), ("Puff Pastry", 60), ("Carrot", 30),
        ("Green Peas, cooked", 30), ("Heavy Cream", 40), ("Butter", 10),
    ]),
    _dish("Clam Chowder", [
        ("Potato, baked", 80), ("Half and Half", 100), ("Bacon, cooked", 15), ("Onion", 20),
    ]),
    _dish("Philly Cheesesteak", [
        ("Ribeye Steak, cooked", 130), ("Baguette", 80), ("Provolone Cheese", 30), ("Onion", 30),
    ]),
    _dish("Cobb Salad", [
        ("Romaine Lettuce", 120), ("Chicken Breast, cooked", 90), ("Bacon, cooked", 20),
        ("Egg, whole", 55), ("Avocado", 40), ("Blue Cheese", 20),
    ]),
    _dish("BLT Sandwich", [
        ("White Bread", 70), ("Bacon, cooked", 30), ("Lettuce", 15), ("Tomato", 25), ("Mayonnaise", 15),
    ]),
    _dish("Pulled Pork Sandwich", [
        ("Pulled Pork", 150), ("Burger Bun", 70), ("BBQ Sauce", 25), ("Cabbage", 20),
    ]),
    _dish("Fried Catfish", [
        ("Tilapia, cooked", 180), ("Cornmeal", 25), ("Vegetable Oil", 15),
    ]),
    _dish("Biscuits and Gravy", [
        ("White Bread", 90), ("Sausage (pork)", 60), ("Whole Milk", 80), ("Flour, All-Purpose", 10),
    ]),
    _dish("Chili Con Carne", [
        ("Ground Beef 80/20, cooked", 150), ("Kidney Beans, cooked", 100),
        ("Tomato", 60), ("Onion", 30), ("Chili Powder", 3),
    ]),
    _dish("Cornbread, baked", [
        ("Cornmeal", 80), ("Flour, All-Purpose", 30), ("Whole Milk", 60),
        ("Egg, whole", 55), ("Butter", 20), ("Sugar, white", 15),
    ]),
    _dish("Apple Pie", [
        ("Apple", 200), ("Puff Pastry", 80), ("Sugar, white", 25), ("Cinnamon", 2), ("Butter", 15),
    ]),
    _dish("Pumpkin Pie", [
        ("Puff Pastry", 60), ("Sweet Potato, baked", 150), ("Egg, whole", 55),
        ("Heavy Cream", 60), ("Sugar, white", 30), ("Cinnamon", 2),
    ]),
    _dish("Reuben Sandwich", [
        ("Rye Bread", 70), ("Beef Brisket, cooked", 100), ("Swiss Cheese", 30), ("Cabbage", 30),
    ]),
    _dish("Turkey Club Sandwich", [
        ("White Bread", 90), ("Turkey Breast, cooked", 100), ("Bacon, cooked", 20),
        ("Lettuce", 15), ("Tomato", 20), ("Mayonnaise", 15),
    ]),
    _dish("Loaded Nachos", [
        ("Tortilla Chips", 100), ("Ground Beef 80/20, cooked", 90), ("Cheddar Cheese", 50),
        ("Sour Cream", 25), ("Salsa", 30), ("Jalapeno Pepper", 10),
    ]),
    _dish("Chicken Fried Steak", [
        ("Sirloin Steak, cooked", 150), ("Flour, All-Purpose", 25),
        ("Buttermilk", 30), ("Vegetable Oil", 15), ("Whole Milk", 40),
    ]),
    _dish("Shrimp and Grits", [
        ("Shrimp, cooked", 120), ("Grits, cooked", 180), ("Bacon, cooked", 15), ("Butter", 10),
    ]),
    _dish("Jambalaya", [
        ("White Rice, cooked", 180), ("Shrimp, cooked", 70), ("Sausage (pork)", 60),
        ("Bell Pepper", 30), ("Onion", 30), ("Tomato", 40),
    ]),
    _dish("Gumbo", [
        ("Chicken Thigh, cooked", 100), ("Sausage (pork)", 60), ("Bell Pepper", 30),
        ("Onion", 30), ("White Rice, cooked", 120),
    ]),
    _dish("Spaghetti Bolognese", [
        ("Pasta, cooked", 200), ("Ground Beef 80/20, cooked", 100),
        ("Tomato", 80), ("Onion", 20), ("Garlic", 5), ("Parmesan Cheese", 15),
    ]),
    _dish("Chicken Alfredo", [
        ("Pasta, cooked", 200), ("Chicken Breast, cooked", 110),
        ("Heavy Cream", 60), ("Butter", 15), ("Parmesan Cheese", 25), ("Garlic", 5),
    ]),
    _dish("Beef Stir Fry", [
        ("Beef Strips, cooked", 130), ("Broccoli", 50), ("Bell Pepper", 40),
        ("Carrot", 30), ("Soy Sauce", 15), ("Garlic", 5), ("Vegetable Oil", 10),
    ]),
    _dish("Cookies, chocolate chip", [
        ("Flour, All-Purpose", 60), ("Butter", 40), ("Sugar, white", 25),
        ("Brown Sugar", 25), ("Egg, whole", 30), ("Chocolate Chips", 40),
    ]),
    _dish("Donut", [
        ("Flour, All-Purpose", 60), ("Sugar, white", 20), ("Egg, whole", 30),
        ("Whole Milk", 20), ("Butter", 15), ("Vegetable Oil", 15),
    ]),
    _dish("Muffin", [
        ("Flour, All-Purpose", 70), ("Sugar, white", 30), ("Egg, whole", 30),
        ("Butter", 20), ("Whole Milk", 30), ("Chocolate Chips", 15),
    ]),
    _dish("Cake, frosted", [
        ("Flour, All-Purpose", 70), ("Sugar, white", 40), ("Egg, whole", 40),
        ("Butter", 25), ("Whole Milk", 20), ("Cream Cheese", 20),
    ]),

    # ==================================================================
    # Thai (30)
    # ==================================================================
    _dish("Pad Thai", [
        ("Rice Noodles, cooked", 150), ("Shrimp, cooked", 80), ("Egg, whole", 55),
        ("Peanuts", 15), ("Bean Sprouts", 40), ("Fish Sauce", 10), ("Tamarind Paste", 10),
    ]),
    _dish("Shrimp Pad Thai", [
        ("Rice Noodles, cooked", 150), ("Shrimp, cooked", 100), ("Egg, whole", 55),
        ("Peanuts", 15), ("Bean Sprouts", 40), ("Fish Sauce", 10), ("Tamarind Paste", 10),
    ]),
    _dish("Green Curry, Chicken", [
        ("Chicken Breast, cooked", 120), ("Coconut Milk", 150), ("Thai Green Curry Paste", 30),
        ("Thai Basil", 10), ("Bell Pepper", 30),
    ]),
    _dish("Red Curry, Chicken", [
        ("Chicken Breast, cooked", 120), ("Coconut Milk", 150), ("Thai Red Curry Paste", 30),
        ("Bell Pepper", 30), ("Thai Basil", 8),
    ]),
    _dish("Massaman Curry, Beef", [
        ("Beef, stew meat, cooked", 130), ("Coconut Milk", 150), ("Massaman Curry Paste", 30),
        ("Potato, baked", 80), ("Peanuts", 15),
    ]),
    _dish("Tom Yum Soup, Shrimp", [
        ("Shrimp, cooked", 100), ("Lemongrass", 8), ("Galangal", 5),
        ("Fish Sauce", 10), ("Lime Juice", 10), ("Mushroom", 30),
    ]),
    _dish("Tom Kha Gai", [
        ("Chicken Breast, cooked", 100), ("Coconut Milk", 150), ("Galangal", 6),
        ("Lemongrass", 6), ("Fish Sauce", 8), ("Lime Juice", 8),
    ]),
    _dish("Pad Kra Pao, Basil Chicken", [
        ("Ground Chicken, cooked", 150), ("Thai Basil", 15), ("Chili Pepper", 5),
        ("Garlic", 8), ("Fish Sauce", 8), ("White Rice, cooked", 150),
    ]),
    _dish("Pad See Ew", [
        ("Rice Noodles, cooked", 180), ("Beef Strips, cooked", 100),
        ("Broccoli", 40), ("Egg, whole", 55), ("Soy Sauce", 10),
    ]),
    _dish("Som Tam, Papaya Salad", [
        ("Green Papaya", 150), ("Peanuts", 15), ("Lime Juice", 15),
        ("Fish Sauce", 10), ("Chili Pepper", 5), ("Palm Sugar", 8),
    ]),
    _dish("Satay Chicken", [
        ("Chicken Breast, cooked", 130), ("Peanut Sauce", 40), ("Coconut Milk", 20),
    ]),
    _dish("Thai Fried Rice", [
        ("Jasmine Rice, cooked", 200), ("Egg, whole", 55), ("Chicken Breast, cooked", 80),
        ("Onion", 20), ("Fish Sauce", 8),
    ]),
    _dish("Larb, Chicken", [
        ("Ground Chicken, cooked", 150), ("Lime Juice", 15), ("Fish Sauce", 8),
        ("Cilantro", 8), ("Shallot", 15), ("Chili Pepper", 4),
    ]),
    _dish("Panang Curry, Chicken", [
        ("Chicken Breast, cooked", 120), ("Coconut Milk", 140), ("Panang Curry Paste", 30),
        ("Peanuts", 15),
    ]),
    _dish("Khao Soi", [
        ("Egg Noodles, cooked", 150), ("Chicken Thigh, cooked", 100), ("Coconut Milk", 130),
        ("Yellow Curry Paste", 25), ("Shallot", 10),
    ]),
    _dish("Pad Woon Sen, Glass Noodles", [
        ("Glass Noodles, cooked", 150), ("Shrimp, cooked", 70), ("Egg, whole", 55),
        ("Bean Sprouts", 30), ("Soy Sauce", 10),
    ]),
    _dish("Thai Basil Fried Rice", [
        ("Jasmine Rice, cooked", 200), ("Ground Pork, cooked", 90),
        ("Thai Basil", 12), ("Chili Pepper", 4), ("Egg, whole", 55),
    ]),
    _dish("Mango Sticky Rice", [
        ("Sticky Rice, cooked", 150), ("Mango", 120), ("Coconut Milk", 60), ("Palm Sugar", 15),
    ]),
    _dish("Thai Fish Cakes", [
        ("Cod, cooked", 150), ("Thai Red Curry Paste", 15), ("Green Beans", 30), ("Egg White", 15),
    ]),
    _dish("Crab Fried Rice", [
        ("Jasmine Rice, cooked", 200), ("Crab, cooked", 90), ("Egg, whole", 55), ("Scallion", 10),
    ]),
    _dish("Thai Chicken Satay Skewers", [
        ("Chicken Thigh, cooked", 140), ("Peanut Sauce", 35), ("Coconut Milk", 15),
    ]),
    _dish("Yellow Curry, Chicken", [
        ("Chicken Breast, cooked", 120), ("Coconut Milk", 150), ("Yellow Curry Paste", 30),
        ("Potato, baked", 60),
    ]),
    _dish("Thai Omelette", [
        ("Egg, whole", 165), ("Fish Sauce", 6), ("Vegetable Oil", 15), ("Scallion", 8),
    ]),
    _dish("Pineapple Fried Rice", [
        ("Jasmine Rice, cooked", 200), ("Shrimp, cooked", 80), ("Pineapple", 60),
        ("Egg, whole", 55), ("Cashews", 15),
    ]),
    _dish("Beef Panang", [
        ("Beef Strips, cooked", 130), ("Coconut Milk", 140), ("Panang Curry Paste", 30), ("Peanuts", 12),
    ]),
    _dish("Thai Spring Rolls", [
        ("Rice Noodles, cooked", 60), ("Shrimp, cooked", 50), ("Cabbage", 30),
        ("Carrot", 20), ("Peanut Sauce", 20),
    ]),
    _dish("Thai Peanut Noodles", [
        ("Rice Noodles, cooked", 180), ("Peanut Sauce", 50), ("Chicken Breast, cooked", 90),
        ("Bean Sprouts", 30),
    ]),
    _dish("Thai Basil Beef", [
        ("Beef Strips, cooked", 140), ("Thai Basil", 15), ("Chili Pepper", 5),
        ("Garlic", 8), ("Fish Sauce", 8),
    ]),
    _dish("Coconut Shrimp", [
        ("Shrimp, cooked", 130), ("Coconut Oil", 10), ("Flour, All-Purpose", 20), ("Egg White", 15),
    ]),
    _dish("Thai Chicken Wings", [
        ("Chicken Wing, cooked", 200), ("Fish Sauce", 10), ("Palm Sugar", 10), ("Garlic", 6),
    ]),

    # ==================================================================
    # Mexican (30)
    # ==================================================================
    _dish("Beef Taco", [
        ("Corn Tortilla", 30), ("Ground Beef 80/20, cooked", 80), ("Cheddar Cheese", 20),
        ("Lettuce", 15), ("Tomato", 15), ("Sour Cream", 10),
    ]),
    _dish("Chicken Taco", [
        ("Corn Tortilla", 30), ("Chicken Breast, cooked", 80), ("Cheddar Cheese", 15),
        ("Lettuce", 15), ("Salsa", 15),
    ]),
    _dish("Carnitas Taco", [
        ("Corn Tortilla", 30), ("Carnitas (Pork), cooked", 90), ("Onion", 10), ("Cilantro", 5), ("Lime Juice", 5),
    ]),
    _dish("Al Pastor Taco", [
        ("Corn Tortilla", 30), ("Al Pastor Pork, cooked", 90), ("Pineapple", 15), ("Onion", 10), ("Cilantro", 5),
    ]),
    _dish("Fish Taco", [
        ("Corn Tortilla", 30), ("Tilapia, cooked", 90), ("Cabbage", 20), ("Sour Cream", 15), ("Lime Juice", 5),
    ]),
    _dish("Chicken Burrito", [
        ("Flour Tortilla", 80), ("Chicken Breast, cooked", 110), ("White Rice, cooked", 100),
        ("Black Beans, cooked", 60), ("Cheddar Cheese", 25), ("Sour Cream", 15), ("Salsa", 15),
    ]),
    _dish("Beef Burrito", [
        ("Flour Tortilla", 80), ("Ground Beef 80/20, cooked", 110), ("White Rice, cooked", 100),
        ("Pinto Beans, cooked", 60), ("Cheddar Cheese", 25), ("Salsa", 15),
    ]),
    _dish("Bean Burrito", [
        ("Flour Tortilla", 80), ("Refried Beans", 130), ("White Rice, cooked", 100),
        ("Cheddar Cheese", 25), ("Salsa", 15),
    ]),
    _dish("Chicken Quesadilla", [
        ("Flour Tortilla", 80), ("Chicken Breast, cooked", 90), ("Cheddar Cheese", 40), ("Sour Cream", 15),
    ]),
    _dish("Cheese Quesadilla", [
        ("Flour Tortilla", 80), ("Cheddar Cheese", 60), ("Mozzarella Cheese", 30),
    ]),
    _dish("Chicken Enchiladas", [
        ("Corn Tortilla", 60), ("Chicken Breast, cooked", 100), ("Enchilada Sauce", 60), ("Cheddar Cheese", 30),
    ]),
    _dish("Beef Enchiladas", [
        ("Corn Tortilla", 60), ("Ground Beef 80/20, cooked", 100), ("Enchilada Sauce", 60), ("Cheddar Cheese", 30),
    ]),
    _dish("Chile Relleno", [
        ("Poblano Pepper", 100), ("Queso Fresco", 50), ("Egg, whole", 55), ("Flour, All-Purpose", 15),
    ]),
    _dish("Tamales, Pork", [
        ("Masa Dough", 120), ("Pulled Pork", 80), ("Adobo Sauce", 20),
    ]),
    _dish("Pozole, Pork", [
        ("Pork Chop, cooked", 100), ("Corn", 80), ("Adobo Sauce", 20), ("Cabbage", 20),
    ]),
    _dish("Chicken Tostada", [
        ("Tostada Shell", 30), ("Chicken Breast, cooked", 90), ("Refried Beans", 40),
        ("Lettuce", 20), ("Cotija Cheese", 15), ("Sour Cream", 10),
    ]),
    _dish("Elote, Mexican Street Corn", [
        ("Corn", 150), ("Mayonnaise", 20), ("Cotija Cheese", 15), ("Chili Powder", 2), ("Lime Juice", 5),
    ]),
    _dish("Guacamole and Chips", [
        ("Guacamole", 100), ("Tortilla Chips", 60),
    ]),
    _dish("Mexican Rice", [
        ("White Rice, cooked", 200), ("Tomato", 40), ("Onion", 15), ("Vegetable Oil", 8),
    ]),
    _dish("Refried Beans, side", [
        ("Refried Beans", 180), ("Cotija Cheese", 15),
    ]),
    _dish("Beef Nachos", [
        ("Tortilla Chips", 100), ("Ground Beef 80/20, cooked", 90), ("Cheddar Cheese", 50),
        ("Sour Cream", 25), ("Salsa", 30), ("Jalapeno Pepper", 10),
    ]),
    _dish("Chicken Fajitas", [
        ("Chicken Breast, cooked", 130), ("Bell Pepper", 60), ("Onion", 40),
        ("Flour Tortilla", 60), ("Sour Cream", 15),
    ]),
    _dish("Beef Fajitas", [
        ("Flank Steak, cooked", 130), ("Bell Pepper", 60), ("Onion", 40),
        ("Flour Tortilla", 60), ("Sour Cream", 15),
    ]),
    _dish("Chilaquiles", [
        ("Tortilla Chips", 90), ("Salsa", 60), ("Egg, whole", 55), ("Cotija Cheese", 20), ("Sour Cream", 15),
    ]),
    _dish("Huevos Rancheros", [
        ("Corn Tortilla", 50), ("Egg, whole", 110), ("Salsa", 50), ("Refried Beans", 60), ("Cotija Cheese", 15),
    ]),
    _dish("Carne Asada", [
        ("Flank Steak, cooked", 180), ("Lime Juice", 10), ("Garlic", 5), ("Cilantro", 5),
    ]),
    _dish("Mole Poblano, Chicken", [
        ("Chicken Thigh, cooked", 140), ("Mole Sauce", 70), ("White Rice, cooked", 100),
    ]),
    _dish("Sopes, Beef", [
        ("Masa Dough", 90), ("Ground Beef 80/20, cooked", 80), ("Refried Beans", 40),
        ("Lettuce", 15), ("Cotija Cheese", 15),
    ]),
    _dish("Ceviche", [
        ("Tilapia, cooked", 130), ("Lime Juice", 30), ("Tomato", 30), ("Onion", 15), ("Cilantro", 8),
    ]),
    _dish("Torta, Mexican Sandwich", [
        ("Baguette", 90), ("Carnitas (Pork), cooked", 100), ("Refried Beans", 30),
        ("Avocado", 30), ("Queso Fresco", 20),
    ]),

    # ==================================================================
    # Japanese (30)
    # ==================================================================
    _dish("California Roll", [
        ("Sushi Rice, cooked", 100), ("Nori (seaweed)", 5), ("Crab, cooked", 40),
        ("Avocado", 30), ("Cucumber", 20),
    ]),
    _dish("Salmon Nigiri", [
        ("Sushi Rice, cooked", 90), ("Salmon, cooked", 60),
    ]),
    _dish("Tuna Sashimi", [
        ("Tuna, raw (sashimi grade)", 120), ("Soy Sauce", 10), ("Wasabi", 3),
    ]),
    _dish("Chicken Katsu", [
        ("Chicken Breast, cooked", 150), ("Panko Breadcrumbs", 25),
        ("Egg White", 15), ("Vegetable Oil", 15), ("Katsu Sauce", 25),
    ]),
    _dish("Tonkatsu, Pork Cutlet", [
        ("Pork Chop, cooked", 160), ("Panko Breadcrumbs", 25),
        ("Egg White", 15), ("Vegetable Oil", 15), ("Katsu Sauce", 25),
    ]),
    _dish("Chicken Teriyaki", [
        ("Chicken Thigh, cooked", 150), ("Teriyaki Sauce", 30), ("White Rice, cooked", 150),
    ]),
    _dish("Beef Teriyaki", [
        ("Sirloin Steak, cooked", 140), ("Teriyaki Sauce", 30), ("White Rice, cooked", 150),
    ]),
    _dish("Miso Soup", [
        ("Dashi Stock", 200), ("Miso Paste", 20), ("Tofu", 40), ("Scallion", 5),
    ]),
    _dish("Tonkotsu Ramen", [
        ("Ramen Noodles, cooked", 200), ("Pork Belly, cooked", 60), ("Dashi Stock", 250),
        ("Egg, whole", 55), ("Scallion", 8),
    ]),
    _dish("Shoyu Ramen", [
        ("Ramen Noodles, cooked", 200), ("Chicken Breast, cooked", 80), ("Soy Sauce", 20),
        ("Dashi Stock", 250), ("Egg, whole", 55),
    ]),
    _dish("Udon Noodle Soup", [
        ("Udon Noodles, cooked", 220), ("Dashi Stock", 250), ("Soy Sauce", 15), ("Scallion", 8),
    ]),
    _dish("Yakisoba", [
        ("Ramen Noodles, cooked", 200), ("Pork Belly, cooked", 60), ("Cabbage", 40),
        ("Carrot", 20), ("Okonomiyaki Sauce", 25),
    ]),
    _dish("Gyoza, Pork Dumplings", [
        ("Ground Pork, cooked", 100), ("Cabbage", 30), ("Flour, All-Purpose", 30),
        ("Garlic", 5), ("Sesame Oil", 5),
    ]),
    _dish("Tempura Shrimp", [
        ("Shrimp, cooked", 120), ("Tempura Batter", 40), ("Vegetable Oil", 15),
    ]),
    _dish("Tempura Vegetable", [
        ("Sweet Potato, baked", 80), ("Bell Pepper", 40), ("Tempura Batter", 40), ("Vegetable Oil", 15),
    ]),
    _dish("Chicken Yakitori", [
        ("Chicken Thigh, cooked", 140), ("Teriyaki Sauce", 20), ("Scallion", 15),
    ]),
    _dish("Beef Sukiyaki", [
        ("Sirloin Steak, cooked", 140), ("Tofu", 60), ("Cabbage", 40),
        ("Soy Sauce", 20), ("Mirin", 15),
    ]),
    _dish("Okonomiyaki", [
        ("Cabbage", 120), ("Flour, All-Purpose", 60), ("Egg, whole", 55),
        ("Pork Belly, cooked", 40), ("Okonomiyaki Sauce", 25),
    ]),
    _dish("Takoyaki", [
        ("Octopus, cooked", 70), ("Flour, All-Purpose", 60), ("Egg, whole", 55), ("Okonomiyaki Sauce", 20),
    ]),
    _dish("Onigiri, Rice Ball", [
        ("White Rice, cooked", 130), ("Nori (seaweed)", 3), ("Salmon, cooked", 25),
    ]),
    _dish("Chirashi Bowl", [
        ("Sushi Rice, cooked", 180), ("Salmon, cooked", 60), ("Tuna, raw (sashimi grade)", 60), ("Nori (seaweed)", 3),
    ]),
    _dish("Unagi Don, Eel Rice Bowl", [
        ("White Rice, cooked", 180), ("Eel, cooked (unagi)", 100), ("Teriyaki Sauce", 20),
    ]),
    _dish("Katsu Curry", [
        ("Chicken Breast, cooked", 140), ("Panko Breadcrumbs", 25), ("Vegetable Oil", 15),
        ("Curry Roux (Japanese)", 60), ("White Rice, cooked", 180),
    ]),
    _dish("Edamame, steamed and salted", [("Edamame, cooked", 150)]),
    _dish("Seaweed Salad", [("Seaweed Salad (Wakame)", 100), ("Sesame Oil", 5), ("Sesame Seeds", 5)]),
    _dish("Agedashi Tofu", [
        ("Tofu", 150), ("Flour, All-Purpose", 15), ("Dashi Stock", 60), ("Soy Sauce", 10),
    ]),
    _dish("Chicken Karaage", [
        ("Chicken Thigh, cooked", 160), ("Flour, All-Purpose", 20),
        ("Soy Sauce", 15), ("Ginger", 5), ("Vegetable Oil", 15),
    ]),
    _dish("Beef Yakiniku", [
        ("Ribeye Steak, cooked", 150), ("Soy Sauce", 15), ("Garlic", 5), ("Sesame Oil", 8),
    ]),
    _dish("Spicy Tuna Roll", [
        ("Sushi Rice, cooked", 100), ("Nori (seaweed)", 5), ("Tuna, raw (sashimi grade)", 60), ("Mayonnaise", 15),
    ]),
    _dish("Dragon Roll", [
        ("Sushi Rice, cooked", 110), ("Nori (seaweed)", 5), ("Eel, cooked (unagi)", 50), ("Avocado", 40),
    ]),

    # ==================================================================
    # French (30)
    # ==================================================================
    _dish("Coq au Vin", [
        ("Chicken Thigh, cooked", 150), ("Red Wine", 80), ("Mushroom", 40),
        ("Bacon, cooked", 20), ("Onion", 20),
    ]),
    _dish("Beef Bourguignon", [
        ("Beef, stew meat, cooked", 160), ("Red Wine", 90), ("Carrot", 30),
        ("Onion", 25), ("Mushroom", 30),
    ]),
    _dish("Ratatouille", [
        ("Zucchini", 80), ("Bell Pepper", 60), ("Tomato", 80), ("Onion", 30), ("Olive Oil", 15),
    ]),
    _dish("Quiche Lorraine", [
        ("Puff Pastry", 60), ("Egg, whole", 110), ("Heavy Cream", 80),
        ("Bacon, cooked", 40), ("Gruyere Cheese", 30),
    ]),
    _dish("French Onion Soup", [
        ("Onion", 150), ("Baguette", 30), ("Gruyere Cheese", 30), ("Butter", 15),
    ]),
    _dish("Croque Monsieur", [
        ("White Bread", 70), ("Ham", 60), ("Gruyere Cheese", 40), ("Butter", 10),
    ]),
    _dish("Croque Madame", [
        ("White Bread", 70), ("Ham", 60), ("Gruyere Cheese", 40), ("Egg, whole", 55), ("Butter", 10),
    ]),
    _dish("Duck Confit", [
        ("Duck, cooked", 180), ("Duck Fat", 20), ("Thyme", 2), ("Garlic", 5),
    ]),
    _dish("Steak Frites", [
        ("Sirloin Steak, cooked", 180), ("Potato, baked", 200), ("Butter", 15), ("Vegetable Oil", 10),
    ]),
    _dish("Cassoulet", [
        ("Pork Belly, cooked", 90), ("Sausage (pork)", 60), ("Kidney Beans, cooked", 150), ("Duck Fat", 10),
    ]),
    _dish("Bouillabaisse", [
        ("Cod, cooked", 100), ("Shrimp, cooked", 60), ("Tomato", 60),
        ("Onion", 20), ("White Wine", 40),
    ]),
    _dish("Nicoise Salad", [
        ("Romaine Lettuce", 100), ("Tuna, canned in water", 90), ("Egg, whole", 55),
        ("Green Beans", 40), ("Olive Oil", 10),
    ]),
    _dish("Escargot", [
        ("Octopus, cooked", 90), ("Butter", 25), ("Garlic", 8),
    ]),
    _dish("Crepe, Ham and Cheese", [
        ("Flour, All-Purpose", 60), ("Whole Milk", 100), ("Egg, whole", 55),
        ("Ham", 50), ("Gruyere Cheese", 30),
    ]),
    _dish("Crepe, Nutella", [
        ("Flour, All-Purpose", 60), ("Whole Milk", 100), ("Egg, whole", 55),
        ("Milk Chocolate", 40), ("Banana", 40),
    ]),
    _dish("Quiche, Spinach and Cheese", [
        ("Puff Pastry", 60), ("Egg, whole", 110), ("Heavy Cream", 80),
        ("Spinach", 40), ("Gruyere Cheese", 30),
    ]),
    _dish("French Toast", [
        ("White Bread", 90), ("Egg, whole", 110), ("Whole Milk", 60),
        ("Maple Syrup", 30), ("Butter", 15), ("Cinnamon", 1),
    ]),
    _dish("Beef Tartare", [
        ("Sirloin Steak, cooked", 130), ("Egg Yolk", 18), ("Dijon Mustard", 10), ("Shallot", 10),
    ]),
    _dish("Chicken Cordon Bleu", [
        ("Chicken Breast, cooked", 150), ("Ham", 40), ("Gruyere Cheese", 30),
        ("Panko Breadcrumbs", 20), ("Vegetable Oil", 10),
    ]),
    _dish("Pot au Feu", [
        ("Beef Brisket, cooked", 160), ("Carrot", 40), ("Leeks", 30), ("Potato, baked", 80),
    ]),
    _dish("Tarte Tatin", [
        ("Apple", 180), ("Puff Pastry", 70), ("Butter", 25), ("Brown Sugar", 25),
    ]),
    _dish("Creme Brulee", [
        ("Heavy Cream", 150), ("Egg Yolk", 40), ("Sugar, white", 25), ("Vanilla Extract", 3),
    ]),
    _dish("Chocolate Souffle", [
        ("Dark Chocolate", 60), ("Egg, whole", 110), ("Butter", 20), ("Sugar, white", 20),
    ]),
    _dish("Macarons", [("Macarons", 60)]),
    _dish("Pain au Chocolat", [
        ("Puff Pastry", 70), ("Dark Chocolate", 25), ("Butter", 10),
    ]),
    _dish("Croissant, plain", [("Croissant", 65)]),
    _dish("Baguette Sandwich, Ham and Butter", [
        ("Baguette", 100), ("Ham", 60), ("Butter", 15),
    ]),
    _dish("Vichyssoise", [
        ("Leeks", 100), ("Potato, baked", 100), ("Heavy Cream", 60), ("Butter", 10),
    ]),
    _dish("Gratin Dauphinois", [
        ("Potato, baked", 200), ("Heavy Cream", 100), ("Gruyere Cheese", 40), ("Garlic", 4),
    ]),
    _dish("Salade Nicoise with Salmon", [
        ("Romaine Lettuce", 100), ("Salmon, cooked", 90), ("Egg, whole", 55),
        ("Green Beans", 40), ("Olive Oil", 10),
    ]),

    # ==================================================================
    # Indian (30)
    # ==================================================================
    _dish("Butter Chicken", [
        ("Chicken Thigh, cooked", 150), ("Tikka Masala Sauce", 100), ("Butter", 15), ("Heavy Cream", 30),
    ]),
    _dish("Chicken Tikka Masala", [
        ("Chicken Breast, cooked", 150), ("Tikka Masala Sauce", 110), ("Heavy Cream", 25),
    ]),
    _dish("Chana Masala", [
        ("Chickpeas, cooked", 200), ("Tomato", 60), ("Onion", 30), ("Garam Masala", 3), ("Ghee", 10),
    ]),
    _dish("Palak Paneer", [
        ("Paneer", 120), ("Spinach", 150), ("Onion", 20), ("Heavy Cream", 30), ("Garam Masala", 2),
    ]),
    _dish("Paneer Tikka", [
        ("Paneer", 150), ("Yogurt, plain whole milk", 40), ("Bell Pepper", 40), ("Garam Masala", 3),
    ]),
    _dish("Dal Makhani", [
        ("Lentils, cooked", 180), ("Kidney Beans, cooked", 60), ("Butter", 15), ("Heavy Cream", 25),
    ]),
    _dish("Chicken Biryani", [
        ("Basmati Rice, cooked", 200), ("Chicken Thigh, cooked", 130),
        ("Yogurt, plain whole milk", 30), ("Garam Masala", 3), ("Ghee", 10),
    ]),
    _dish("Lamb Biryani", [
        ("Basmati Rice, cooked", 200), ("Lamb, cooked", 130),
        ("Yogurt, plain whole milk", 30), ("Garam Masala", 3), ("Ghee", 10),
    ]),
    _dish("Tandoori Chicken", [
        ("Chicken Thigh, cooked", 180), ("Yogurt, plain whole milk", 40), ("Garam Masala", 4), ("Lime Juice", 8),
    ]),
    _dish("Aloo Gobi", [
        ("Potato, baked", 130), ("Cauliflower", 130), ("Turmeric", 2), ("Cumin", 2), ("Ghee", 10),
    ]),
    _dish("Lamb Rogan Josh", [
        ("Lamb, cooked", 160), ("Curry Sauce (Indian, general)", 100), ("Onion", 20),
    ]),
    _dish("Potato Samosa", [
        ("Potato, baked", 100), ("Flour, All-Purpose", 40), ("Vegetable Oil", 15), ("Cumin", 1),
    ]),
    _dish("Naan, plain", [("Naan", 90)]),
    _dish("Garlic Naan", [("Naan", 90), ("Garlic", 6), ("Butter", 10)]),
    _dish("Chicken Korma", [
        ("Chicken Breast, cooked", 150), ("Coconut Milk", 80), ("Heavy Cream", 30), ("Garam Masala", 3),
    ]),
    _dish("Pork Vindaloo", [
        ("Pork Chop, cooked", 150), ("Curry Sauce (Indian, general)", 100), ("Chili Powder", 3),
    ]),
    _dish("Saag Aloo", [
        ("Potato, baked", 130), ("Spinach", 130), ("Ghee", 10), ("Garam Masala", 2),
    ]),
    _dish("Rajma, Kidney Bean Curry", [
        ("Kidney Beans, cooked", 200), ("Tomato", 50), ("Onion", 25), ("Garam Masala", 3),
    ]),
    _dish("Malai Kofta", [
        ("Paneer", 100), ("Potato, baked", 60), ("Heavy Cream", 50), ("Curry Sauce (Indian, general)", 80),
    ]),
    _dish("Chicken 65", [
        ("Chicken Breast, cooked", 150), ("Yogurt, plain whole milk", 20),
        ("Chili Powder", 3), ("Curry Leaves", 3), ("Vegetable Oil", 15),
    ]),
    _dish("Pav Bhaji", [
        ("Potato, baked", 100), ("Tomato", 60), ("Bell Pepper", 40),
        ("Burger Bun", 60), ("Butter", 15),
    ]),
    _dish("Chole Bhature", [
        ("Chickpeas, cooked", 180), ("Flour, All-Purpose", 90), ("Vegetable Oil", 20), ("Onion", 20),
    ]),
    _dish("Masala Dosa", [
        ("White Rice, cooked", 120), ("Lentils, cooked", 60), ("Potato, baked", 90), ("Ghee", 10),
    ]),
    _dish("Idli with Sambar", [
        ("White Rice, cooked", 150), ("Lentils, cooked", 120), ("Onion", 15), ("Turmeric", 1),
    ]),
    _dish("Indian Fish Curry", [
        ("Cod, cooked", 150), ("Coconut Milk", 100), ("Curry Leaves", 3), ("Turmeric", 2), ("Tomato", 40),
    ]),
    _dish("Egg Curry", [
        ("Egg, whole", 165), ("Curry Sauce (Indian, general)", 110), ("Onion", 25),
    ]),
    _dish("Bhindi Masala, Okra", [
        ("Green Beans", 150), ("Onion", 25), ("Turmeric", 2), ("Vegetable Oil", 12),
    ]),
    _dish("Keema, Ground Beef Curry", [
        ("Ground Beef 90/10, cooked", 160), ("Green Peas, cooked", 40),
        ("Tomato", 40), ("Garam Masala", 3),
    ]),
    _dish("Raita", [
        ("Yogurt, plain whole milk", 150), ("Cucumber", 40), ("Cumin", 1),
    ]),
    _dish("Gulab Jamun", [
        ("Whole Milk", 60), ("Flour, All-Purpose", 30), ("Sugar, white", 60), ("Ghee", 15), ("Cardamom", 1),
    ]),

    # ==================================================================
    # Italian (30)
    # ==================================================================
    _dish("Margherita Pizza", [
        ("White Bread", 120), ("Tomato", 60), ("Mozzarella Cheese", 60), ("Basil, fresh", 5), ("Olive Oil", 8),
    ]),
    _dish("Pepperoni Pizza", [
        ("White Bread", 120), ("Tomato", 60), ("Mozzarella Cheese", 60), ("Salami", 40), ("Olive Oil", 8),
    ]),
    _dish("Spaghetti Carbonara", [
        ("Pasta, cooked", 200), ("Egg Yolk", 36), ("Pancetta", 40), ("Pecorino Romano Cheese", 30),
    ]),
    _dish("Fettuccine Alfredo", [
        ("Pasta, cooked", 200), ("Alfredo Sauce", 100), ("Parmesan Cheese", 20), ("Butter", 10),
    ]),
    _dish("Lasagna", [
        ("Lasagna Noodles, cooked", 150), ("Ground Beef 80/20, cooked", 100),
        ("Marinara Sauce", 80), ("Ricotta Cheese", 60), ("Mozzarella Cheese", 50),
    ]),
    _dish("Penne alla Vodka", [
        ("Pasta, cooked", 200), ("Marinara Sauce", 100), ("Heavy Cream", 40), ("Parmesan Cheese", 15),
    ]),
    _dish("Chicken Parmesan", [
        ("Chicken Breast, cooked", 150), ("Marinara Sauce", 60), ("Mozzarella Cheese", 40),
        ("Panko Breadcrumbs", 20), ("Parmesan Cheese", 10),
    ]),
    _dish("Eggplant Parmesan", [
        ("Eggplant", 200), ("Marinara Sauce", 80), ("Mozzarella Cheese", 50), ("Panko Breadcrumbs", 20),
    ]),
    _dish("Risotto ai Funghi, Mushroom Risotto", [
        ("Arborio Rice, cooked", 200), ("Mushroom", 80), ("Parmesan Cheese", 20), ("Butter", 15), ("White Wine", 20),
    ]),
    _dish("Risotto alla Milanese", [
        ("Arborio Rice, cooked", 200), ("Parmesan Cheese", 25), ("Butter", 20), ("White Wine", 20),
    ]),
    _dish("Gnocchi al Pomodoro", [
        ("Gnocchi, cooked", 220), ("Marinara Sauce", 100), ("Basil, fresh", 5), ("Parmesan Cheese", 15),
    ]),
    _dish("Caprese Salad", [
        ("Tomato", 100), ("Mozzarella Cheese", 80), ("Basil, fresh", 8), ("Olive Oil", 10), ("Balsamic Vinegar", 8),
    ]),
    _dish("Bruschetta", [
        ("Baguette", 60), ("Tomato", 60), ("Basil, fresh", 5), ("Olive Oil", 10), ("Garlic", 3),
    ]),
    _dish("Minestrone Soup", [
        ("Kidney Beans, cooked", 60), ("Carrot", 30), ("Zucchini", 30),
        ("Tomato", 60), ("Pasta, cooked", 60), ("Olive Oil", 8),
    ]),
    _dish("Osso Buco", [
        ("Beef, stew meat, cooked", 200), ("White Wine", 40), ("Carrot", 20), ("Tomato", 30),
    ]),
    _dish("Chicken Piccata", [
        ("Chicken Breast, cooked", 150), ("Butter", 15), ("White Wine", 25), ("Capers", 8), ("Lime Juice", 5),
    ]),
    _dish("Chicken Marsala", [
        ("Chicken Breast, cooked", 150), ("Mushroom", 50), ("Red Wine", 30), ("Butter", 10),
    ]),
    _dish("Tiramisu", [
        ("Mascarpone Cheese", 90), ("Ladyfingers (Savoiardi)", 50), ("Espresso", 30),
        ("Cocoa Powder", 5), ("Sugar, white", 15),
    ]),
    _dish("Panna Cotta", [
        ("Heavy Cream", 150), ("Sugar, white", 25), ("Vanilla Extract", 3),
    ]),
    _dish("Cannoli", [
        ("Ricotta Cheese", 100), ("Sugar, white", 20), ("Chocolate Chips", 15), ("Flour, All-Purpose", 30),
    ]),
    _dish("Prosciutto e Melone", [
        ("Prosciutto", 60), ("Cantaloupe", 120),
    ]),
    _dish("Antipasto Platter", [
        ("Prosciutto", 40), ("Salami", 30), ("Provolone Cheese", 30), ("Kalamata Olives", 20), ("Artichoke Hearts", 30),
    ]),
    _dish("Caprese Panini", [
        ("Baguette", 80), ("Mozzarella Cheese", 50), ("Tomato", 30), ("Basil, fresh", 5), ("Olive Oil", 8),
    ]),
    _dish("Stuffed Shells", [
        ("Pasta, cooked", 180), ("Ricotta Cheese", 100), ("Marinara Sauce", 80), ("Mozzarella Cheese", 30),
    ]),
    _dish("Chicken Cacciatore", [
        ("Chicken Thigh, cooked", 160), ("Tomato", 80), ("Bell Pepper", 40), ("Mushroom", 30), ("Red Wine", 20),
    ]),
    _dish("Pasta Puttanesca", [
        ("Pasta, cooked", 200), ("Marinara Sauce", 90), ("Kalamata Olives", 20), ("Capers", 8), ("Garlic", 5),
    ]),
    _dish("Pasta Primavera", [
        ("Pasta, cooked", 200), ("Zucchini", 40), ("Bell Pepper", 40), ("Broccoli", 40),
        ("Olive Oil", 10), ("Parmesan Cheese", 15),
    ]),
    _dish("Focaccia", [
        ("White Bread", 100), ("Olive Oil", 15), ("Oregano, dried", 1),
    ]),
    _dish("Arancini", [
        ("Arborio Rice, cooked", 150), ("Mozzarella Cheese", 30), ("Panko Breadcrumbs", 20),
        ("Vegetable Oil", 15), ("Marinara Sauce", 30),
    ]),
    _dish("Polenta with Sausage", [
        ("Polenta, cooked", 200), ("Italian Sausage, cooked", 100), ("Marinara Sauce", 40),
    ]),

    # ==================================================================
    # Chinese (25)
    # ==================================================================
    _dish("Kung Pao Chicken", [
        ("Chicken Breast, cooked", 150), ("Peanuts", 20), ("Bell Pepper", 40),
        ("Dark Soy Sauce", 15), ("Chili Oil", 8), ("Garlic", 5),
    ]),
    _dish("General Tso's Chicken", [
        ("Chicken Breast, cooked", 150), ("Flour, All-Purpose", 20), ("Vegetable Oil", 15),
        ("Hoisin Sauce", 20), ("Dark Soy Sauce", 10), ("Sugar, white", 10),
    ]),
    _dish("Orange Chicken", [
        ("Chicken Breast, cooked", 150), ("Flour, All-Purpose", 20), ("Vegetable Oil", 15),
        ("Orange Juice", 30), ("Sugar, white", 15), ("Dark Soy Sauce", 8),
    ]),
    _dish("Sweet and Sour Pork", [
        ("Pork Chop, cooked", 150), ("Bell Pepper", 40), ("Pineapple", 40),
        ("Ketchup", 20), ("Sugar, white", 10), ("Vegetable Oil", 10),
    ]),
    _dish("Beef and Broccoli", [
        ("Beef Strips, cooked", 150), ("Broccoli", 80), ("Dark Soy Sauce", 15), ("Garlic", 5), ("Vegetable Oil", 8),
    ]),
    _dish("Mongolian Beef", [
        ("Beef Strips, cooked", 150), ("Scallion", 20), ("Dark Soy Sauce", 20), ("Sugar, white", 10), ("Vegetable Oil", 10),
    ]),
    _dish("Mapo Tofu", [
        ("Tofu", 200), ("Ground Pork, cooked", 60), ("Chili Oil", 10),
        ("Black Bean Sauce", 15), ("Sichuan Peppercorn", 1), ("Scallion", 10),
    ]),
    _dish("Egg Drop Soup", [
        ("Dashi Stock", 200), ("Egg, whole", 55), ("Scallion", 5),
    ]),
    _dish("Hot and Sour Soup", [
        ("Dashi Stock", 200), ("Tofu", 40), ("Mushroom", 20), ("Rice Vinegar", 10), ("Egg, whole", 30),
    ]),
    _dish("Wonton Soup", [
        ("Wonton Wrapper", 40), ("Ground Pork, cooked", 60), ("Dashi Stock", 200), ("Scallion", 8),
    ]),
    _dish("Fried Rice, Chicken", [
        ("White Rice, cooked", 200), ("Chicken Breast, cooked", 80), ("Egg, whole", 55),
        ("Scallion", 10), ("Dark Soy Sauce", 10), ("Vegetable Oil", 8),
    ]),
    _dish("Fried Rice, Shrimp", [
        ("White Rice, cooked", 200), ("Shrimp, cooked", 80), ("Egg, whole", 55),
        ("Green Peas, cooked", 20), ("Dark Soy Sauce", 10),
    ]),
    _dish("Lo Mein, Beef", [
        ("Egg Noodles, cooked", 200), ("Beef Strips, cooked", 90), ("Bok Choy", 40),
        ("Dark Soy Sauce", 15), ("Sesame Oil", 5),
    ]),
    _dish("Chow Mein, Chicken", [
        ("Egg Noodles, cooked", 200), ("Chicken Breast, cooked", 90), ("Bean Sprouts", 40),
        ("Napa Cabbage", 30), ("Dark Soy Sauce", 15),
    ]),
    _dish("Dan Dan Noodles", [
        ("Egg Noodles, cooked", 200), ("Ground Pork, cooked", 70), ("Chili Oil", 12), ("Sesame Oil", 5), ("Scallion", 8),
    ]),
    _dish("Peking Duck", [
        ("Duck, cooked", 150), ("Mandarin Pancake", 60), ("Hoisin Sauce", 20), ("Scallion", 10),
    ]),
    _dish("Char Siu Rice Bowl", [
        ("White Rice, cooked", 200), ("Char Siu Pork, cooked", 130), ("Scallion", 8), ("Hoisin Sauce", 15),
    ]),
    _dish("Chinese Broccoli with Oyster Sauce", [
        ("Broccoli", 200), ("Oyster Sauce", 20), ("Garlic", 5), ("Vegetable Oil", 8),
    ]),
    _dish("Dumplings, Pork Steamed", [
        ("Wonton Wrapper", 60), ("Ground Pork, cooked", 100), ("Napa Cabbage", 30), ("Sesame Oil", 5),
    ]),
    _dish("Spring Rolls, Vegetable", [
        ("Wonton Wrapper", 50), ("Cabbage", 40), ("Carrot", 20), ("Bean Sprouts", 20), ("Vegetable Oil", 15),
    ]),
    _dish("Egg Foo Young", [
        ("Egg, whole", 165), ("Bean Sprouts", 40), ("Bamboo Shoots", 20), ("Scallion", 10), ("Vegetable Oil", 10),
    ]),
    _dish("Salt and Pepper Shrimp", [
        ("Shrimp, cooked", 150), ("Flour, All-Purpose", 15), ("Vegetable Oil", 15), ("Sichuan Peppercorn", 1), ("Scallion", 8),
    ]),
    _dish("Beef Chow Fun", [
        ("Rice Noodles, cooked", 200), ("Beef Strips, cooked", 100), ("Bean Sprouts", 30),
        ("Dark Soy Sauce", 15), ("Scallion", 10),
    ]),
    _dish("Congee, Chicken", [
        ("White Rice, cooked", 250), ("Chicken Breast, cooked", 60), ("Ginger", 5), ("Scallion", 5),
    ]),
    _dish("Sesame Chicken", [
        ("Chicken Breast, cooked", 150), ("Flour, All-Purpose", 20), ("Vegetable Oil", 15),
        ("Sesame Seeds", 10), ("Sugar, white", 12), ("Dark Soy Sauce", 10),
    ]),

    # ==================================================================
    # Korean (15)
    # ==================================================================
    _dish("Bibimbap", [
        ("White Rice, cooked", 200), ("Bulgogi Beef, cooked", 100), ("Spinach", 40),
        ("Carrot", 30), ("Bean Sprouts", 30), ("Egg, whole", 55), ("Gochujang", 15),
    ]),
    _dish("Bulgogi", [
        ("Bulgogi Beef, cooked", 180), ("White Rice, cooked", 150), ("Scallion", 10), ("Sesame Oil", 5),
    ]),
    _dish("Kimchi Fried Rice", [
        ("White Rice, cooked", 200), ("Kimchi", 80), ("Ground Pork, cooked", 60), ("Egg, whole", 55), ("Gochujang", 10),
    ]),
    _dish("Korean Fried Chicken", [
        ("Chicken (bone-in), fried", 200), ("Gochujang", 20), ("Sugar, white", 10), ("Sesame Seeds", 5),
    ]),
    _dish("Japchae", [
        ("Glass Noodles, cooked", 180), ("Beef Strips, cooked", 80), ("Spinach", 30),
        ("Carrot", 30), ("Soy Sauce", 15), ("Sesame Oil", 8),
    ]),
    _dish("Tteokbokki", [
        ("Rice Cake (Tteok)", 200), ("Gochujang", 30), ("Sugar, white", 10), ("Fish Sauce", 5), ("Scallion", 10),
    ]),
    _dish("Kimchi Jjigae", [
        ("Kimchi", 150), ("Tofu", 80), ("Ground Pork, cooked", 60), ("Gochugaru", 3), ("Dashi Stock", 100),
    ]),
    _dish("Doenjang Jjigae", [
        ("Doenjang", 30), ("Tofu", 80), ("Zucchini", 40), ("Onion", 20), ("Dashi Stock", 150),
    ]),
    _dish("Galbi, Korean Short Ribs", [
        ("Korean Short Rib, cooked", 200), ("Korean BBQ Sauce", 30), ("Scallion", 8),
    ]),
    _dish("Korean Corn Dog", [
        ("Hot Dog Sausage", 60), ("Flour, All-Purpose", 40), ("Rice Cake (Tteok)", 20),
        ("Vegetable Oil", 15), ("Sugar, white", 10),
    ]),
    _dish("Sundubu Jjigae, Soft Tofu Stew", [
        ("Tofu", 200), ("Shrimp, cooked", 40), ("Gochugaru", 3), ("Dashi Stock", 150), ("Egg, whole", 55),
    ]),
    _dish("Samgyeopsal, Grilled Pork Belly", [
        ("Pork Belly, cooked", 200), ("Perilla Leaves", 10), ("Gochujang", 10), ("Garlic", 5),
    ]),
    _dish("Japchae-bap, Japchae Rice Bowl", [
        ("Glass Noodles, cooked", 120), ("White Rice, cooked", 120), ("Beef Strips, cooked", 60),
        ("Spinach", 20), ("Carrot", 20),
    ]),
    _dish("Korean Fish Cake Soup", [
        ("Korean Fish Cake", 150), ("Dashi Stock", 250), ("Scallion", 8), ("Napa Cabbage", 30),
    ]),
    _dish("Gimbap", [
        ("White Rice, cooked", 150), ("Nori (seaweed)", 5), ("Egg, whole", 40),
        ("Carrot", 20), ("Spinach", 20), ("Ham", 20),
    ]),

    # ==================================================================
    # Vietnamese (10)
    # ==================================================================
    _dish("Pho Bo, Beef Pho", [
        ("Pho Broth", 300), ("Rice Noodles, cooked", 180), ("Flank Steak, cooked", 90),
        ("Bean Sprouts", 30), ("Thai Basil", 5), ("Lime Juice", 5),
    ]),
    _dish("Pho Ga, Chicken Pho", [
        ("Pho Broth", 300), ("Rice Noodles, cooked", 180), ("Chicken Breast, cooked", 90),
        ("Bean Sprouts", 30), ("Cilantro", 5),
    ]),
    _dish("Banh Mi, Pork", [
        ("Baguette", 90), ("Carnitas (Pork), cooked", 90), ("Cucumber", 20),
        ("Carrot", 15), ("Cilantro", 5), ("Mayonnaise", 10),
    ]),
    _dish("Banh Mi, Chicken", [
        ("Baguette", 90), ("Chicken Breast, cooked", 90), ("Cucumber", 20),
        ("Carrot", 15), ("Cilantro", 5), ("Mayonnaise", 10),
    ]),
    _dish("Fresh Spring Rolls, Goi Cuon", [
        ("Rice Paper", 20), ("Shrimp, cooked", 60), ("Vermicelli Noodles, cooked", 60),
        ("Mint, fresh", 5), ("Lettuce", 10),
    ]),
    _dish("Bun Cha", [
        ("Vermicelli Noodles, cooked", 150), ("Ground Pork, cooked", 120),
        ("Fish Sauce", 15), ("Carrot", 20), ("Mint, fresh", 5),
    ]),
    _dish("Bun Bo Hue", [
        ("Pho Broth", 300), ("Vermicelli Noodles, cooked", 180), ("Beef Brisket, cooked", 90),
        ("Lemongrass", 8), ("Chili Pepper", 4),
    ]),
    _dish("Vietnamese Caramel Pork, Thit Kho", [
        ("Pork Belly, cooked", 180), ("Palm Sugar", 15), ("Fish Sauce", 10), ("Egg, whole", 55),
    ]),
    _dish("Vietnamese Grilled Chicken, Com Ga", [
        ("Chicken Thigh, cooked", 150), ("White Rice, cooked", 180), ("Fish Sauce", 10), ("Lime Juice", 8),
    ]),
    _dish("Vietnamese Iced Coffee", [
        ("Coffee, black", 150), ("Whole Milk", 40), ("Sugar, white", 15),
    ]),

    # ==================================================================
    # Greek & Mediterranean (20)
    # ==================================================================
    _dish("Greek Salad", [
        ("Cucumber", 60), ("Tomato", 80), ("Kalamata Olives", 20), ("Feta Cheese", 40), ("Olive Oil", 10),
    ]),
    _dish("Chicken Souvlaki", [
        ("Chicken Breast, cooked", 150), ("Pita Bread", 60), ("Tzatziki", 30), ("Tomato", 20), ("Onion", 15),
    ]),
    _dish("Gyro, Lamb", [
        ("Ground Lamb, cooked", 150), ("Pita Bread", 60), ("Tzatziki", 30), ("Tomato", 20), ("Onion", 15),
    ]),
    _dish("Gyro, Chicken", [
        ("Chicken Thigh, cooked", 150), ("Pita Bread", 60), ("Tzatziki", 30), ("Tomato", 20), ("Onion", 15),
    ]),
    _dish("Moussaka", [
        ("Eggplant", 150), ("Ground Lamb, cooked", 120), ("Tomato", 60), ("Heavy Cream", 40), ("Parmesan Cheese", 15),
    ]),
    _dish("Spanakopita", [
        ("Phyllo Dough", 90), ("Spinach", 150), ("Feta Cheese", 60), ("Butter", 20),
    ]),
    _dish("Tiropita", [
        ("Phyllo Dough", 90), ("Feta Cheese", 80), ("Egg, whole", 55), ("Butter", 15),
    ]),
    _dish("Dolmades", [
        ("Grape Leaves", 100), ("White Rice, cooked", 100), ("Onion", 20), ("Olive Oil", 10), ("Lime Juice", 8),
    ]),
    _dish("Hummus and Pita", [
        ("Hummus", 150), ("Pita Bread", 60), ("Olive Oil", 8),
    ]),
    _dish("Falafel Wrap", [
        ("Falafel, fried", 150), ("Pita Bread", 60), ("Tzatziki", 25), ("Tomato", 20), ("Lettuce", 15),
    ]),
    _dish("Avgolemono, Greek Lemon Chicken Soup", [
        ("Chicken Breast, cooked", 90), ("White Rice, cooked", 60), ("Egg, whole", 55), ("Lime Juice", 10),
    ]),
    _dish("Baklava", [
        ("Phyllo Dough", 60), ("Walnuts", 40), ("Honey", 30), ("Butter", 20),
    ]),
    _dish("Grilled Halloumi Salad", [
        ("Halloumi Cheese", 100), ("Romaine Lettuce", 80), ("Tomato", 40), ("Olive Oil", 10),
    ]),
    _dish("Shrimp Saganaki", [
        ("Shrimp, cooked", 150), ("Tomato", 60), ("Feta Cheese", 30), ("Olive Oil", 10),
    ]),
    _dish("Greek Orzo Salad", [
        ("Orzo, cooked", 150), ("Cucumber", 40), ("Tomato", 40), ("Feta Cheese", 30),
        ("Olive Oil", 10), ("Kalamata Olives", 15),
    ]),
    _dish("Lamb Kebabs", [
        ("Ground Lamb, cooked", 180), ("Onion", 20), ("Bell Pepper", 30), ("Olive Oil", 8),
    ]),
    _dish("Chicken Gyro Plate", [
        ("Chicken Thigh, cooked", 150), ("White Rice, cooked", 120), ("Tzatziki", 30), ("Tomato", 20),
    ]),
    _dish("Baba Ghanoush and Pita", [
        ("Baba Ghanoush", 130), ("Pita Bread", 60), ("Olive Oil", 8),
    ]),
    _dish("Pomegranate Chicken", [
        ("Chicken Breast, cooked", 150), ("Pomegranate Seeds", 30), ("Onion", 20), ("Olive Oil", 8),
    ]),
    _dish("Greek Yogurt Parfait", [
        ("Greek Yogurt, plain nonfat", 200), ("Honey", 20), ("Walnuts", 15), ("Blueberries", 40),
    ]),

    # ==================================================================
    # Middle Eastern (12)
    # ==================================================================
    _dish("Chicken Shawarma Plate", [
        ("Shawarma Chicken, cooked", 180), ("White Rice, cooked", 150), ("Tahini", 15), ("Tomato", 20),
    ]),
    _dish("Lamb Shawarma Wrap", [
        ("Shawarma Lamb, cooked", 150), ("Lavash Flatbread", 60), ("Tahini", 15), ("Onion", 15), ("Pickles", 10),
    ]),
    _dish("Falafel Plate", [
        ("Falafel, fried", 180), ("Hummus", 60), ("Pita Bread", 60), ("Tomato", 20),
    ]),
    _dish("Kibbeh", [
        ("Ground Beef 90/10, cooked", 150), ("Bulgur, cooked", 60), ("Onion", 20), ("Cumin", 2),
    ]),
    _dish("Shakshuka", [
        ("Egg, whole", 110), ("Tomato", 150), ("Bell Pepper", 40), ("Onion", 20), ("Za'atar", 2), ("Olive Oil", 8),
    ]),
    _dish("Fattoush", [
        ("Romaine Lettuce", 120), ("Tomato", 60), ("Cucumber", 50), ("Pita Bread", 30), ("Sumac", 2), ("Olive Oil", 10),
    ]),
    _dish("Tabbouleh", [
        ("Bulgur, cooked", 100), ("Cilantro", 15), ("Tomato", 60), ("Lime Juice", 10), ("Olive Oil", 10),
    ]),
    _dish("Muhammara", [
        ("Bell Pepper", 100), ("Walnuts", 40), ("Pomegranate Seeds", 15), ("Olive Oil", 10),
    ]),
    _dish("Chicken Kebab, Middle Eastern", [
        ("Chicken Breast, cooked", 180), ("Za'atar", 3), ("Olive Oil", 8), ("Onion", 15),
    ]),
    _dish("Labneh and Za'atar", [
        ("Labneh", 150), ("Za'atar", 5), ("Olive Oil", 10), ("Pita Bread", 40),
    ]),
    _dish("Lamb Kofta", [
        ("Ground Lamb, cooked", 180), ("Onion", 20), ("Cumin", 2), ("Sumac", 2),
    ]),
    _dish("Baba Ghanoush Mezze Plate", [
        ("Baba Ghanoush", 100), ("Hummus", 100), ("Pita Bread", 60), ("Kalamata Olives", 20),
    ]),

    # ==================================================================
    # Breakfast & miscellaneous (10)
    # ==================================================================
    _dish("Corn Flakes with Milk", [
        ("Corn Flakes", 40), ("Whole Milk", 150),
    ]),
    _dish("Granola with Yogurt", [
        ("Granola", 60), ("Greek Yogurt, plain nonfat", 150), ("Blueberries", 40), ("Honey", 10),
    ]),
    _dish("Breakfast Burrito", [
        ("Flour Tortilla", 80), ("Egg, whole", 110), ("Sausage (pork)", 60),
        ("Cheddar Cheese", 25), ("Hash Browns", 60),
    ]),
    _dish("Bagel with Cream Cheese", [
        ("Bagel", 90), ("Cream Cheese", 30),
    ]),
    _dish("PB&J Sandwich", [
        ("White Bread", 70), ("Peanut Butter", 30), ("Fruit Jam", 20),
    ]),
    _dish("Nutella Toast", [
        ("White Bread", 40), ("Nutella", 25),
    ]),
    _dish("Protein Shake, Chocolate", [
        ("Whey Protein Powder", 35), ("Whole Milk", 250), ("Banana", 60),
    ]),
    _dish("Avocado Toast", [
        ("Sourdough Bread", 60), ("Avocado", 80), ("Olive Oil", 5), ("Chili Pepper", 2),
    ]),
    _dish("Steak and Eggs", [
        ("Sirloin Steak, cooked", 180), ("Egg, whole", 110), ("Butter", 10),
    ]),
    _dish("Waffle with Berries and Whipped Cream", [
        ("Flour, All-Purpose", 90), ("Whole Milk", 120), ("Egg, whole", 55),
        ("Strawberries", 60), ("Whipped Cream", 30), ("Maple Syrup", 20),
    ]),

    # ==================================================================
    # Commercial brands & restaurant chains
    # Each wraps a single raw ingredient above at that item's typical
    # whole-item weight, so "1 serving" in the amount editor means "one
    # Big Mac" / "one shake" / etc. rather than an arbitrary 100g -- same
    # pattern as "Croissant, plain" wrapping "Croissant" earlier in this
    # file.
    # ==================================================================
    _dish("Big Mac (McDonald's)", [("Big Mac", 219)]),
    _dish("McChicken (McDonald's)", [("McChicken", 143)]),
    _dish("Quarter Pounder with Cheese (McDonald's)", [("Quarter Pounder with Cheese", 199)]),
    _dish("Fries, Medium (McDonald's)", [("McDonald's Fries", 117)]),
    _dish("Chicken McNuggets, 10pc (McDonald's)", [("McDonald's Chicken McNuggets", 160)]),
    _dish("Egg McMuffin (McDonald's)", [("Egg McMuffin", 136)]),
    _dish("McFlurry with M&Ms (McDonald's)", [("McFlurry with M&Ms", 348)]),
    _dish("Original Recipe Chicken Breast (KFC)", [("KFC Original Recipe Chicken Breast", 161)]),
    _dish("Popcorn Chicken (KFC)", [("KFC Popcorn Chicken", 114)]),
    _dish("Chicken Sandwich (KFC)", [("KFC Chicken Sandwich", 215)]),
    _dish("Mashed Potatoes with Gravy (KFC)", [("KFC Mashed Potatoes with Gravy", 136)]),
    _dish("Coleslaw (KFC)", [("KFC Coleslaw", 130)]),
    _dish("Pepperoni Pan Pizza, 1 slice (Pizza Hut)", [("Pizza Hut Pepperoni Pan Pizza", 100)]),
    _dish("Stuffed Crust Pizza, 1 slice (Pizza Hut)", [("Pizza Hut Stuffed Crust Pizza", 130)]),
    _dish("Breadstick (Pizza Hut)", [("Pizza Hut Breadstick", 45)]),
    _dish("Crunchwrap Supreme (Taco Bell)", [("Taco Bell Crunchwrap Supreme", 254)]),
    _dish("Beef Burrito Supreme (Taco Bell)", [("Taco Bell Beef Burrito Supreme", 248)]),
    _dish("Crunchy Taco (Taco Bell)", [("Taco Bell Crunchy Taco", 78)]),
    _dish("Chicken Quesadilla (Taco Bell)", [("Taco Bell Chicken Quesadilla", 184)]),
    _dish("Classic Bone-In Wings, 6pc (Wingstop)", [("Wingstop Classic Bone-In Wings", 270)]),
    _dish("Boneless Wings, 6pc (Wingstop)", [("Wingstop Boneless Wings", 220)]),
    _dish("Fries (Wingstop)", [("Wingstop Fries", 140)]),
    _dish("Cheeseburger (Five Guys)", [("Five Guys Cheeseburger", 340)]),
    _dish("Little Fries (Five Guys)", [("Five Guys Fries", 200)]),
    _dish("ShackBurger (Shake Shack)", [("Shake Shack ShackBurger", 180)]),
    _dish("Crinkle Fries (Shake Shack)", [("Shake Shack Crinkle Fries", 220)]),
    _dish("Vanilla Shake (Shake Shack)", [("Shake Shack Vanilla Shake", 400)]),
    _dish("Classic Milk Tea (Chagee)", [("Chagee Classic Milk Tea", 500)]),
    _dish("Original Milk Tea with Pearls (Koi The)", [("Koi The Original Milk Tea with Pearls", 500)]),
    _dish("Meiji Milk, 1 carton", [("Meiji Milk", 200)]),
    _dish("Cup Noodles, Tom Yum Shrimp, prepared (Mama)", [("Mama Cup Noodles, Tom Yum Shrimp, prepared", 380)]),
]


def _compute_dish_macros(dishes, raw_by_name):
    for dish in dishes:
        total_g = total_cal = total_carb = total_fat = total_protein = 0.0
        total_sodium = total_sugar = 0.0
        for ing in dish["ingredients"]:
            base = raw_by_name.get(ing["name"])
            if base is None:
                raise ValueError(f"Unknown ingredient '{ing['name']}' in dish '{dish['name']}'")
            grams = ing["grams"]
            scale = grams / 100
            total_g += grams
            total_cal += base["calories"] * scale
            total_carb += base["carbs"] * scale
            total_fat += base["fat"] * scale
            total_protein += base["protein"] * scale
            total_sodium += base["sodium_mg"] * scale
            total_sugar += base["sugar_g"] * scale
        if total_g <= 0:
            total_g = 100  # avoid div by zero for any zero-weight placeholder
        dish["calories"] = round(total_cal / total_g * 100)
        dish["carbs"] = round(total_carb / total_g * 100, 1)
        dish["fat"] = round(total_fat / total_g * 100, 1)
        dish["protein"] = round(total_protein / total_g * 100, 1)
        dish["sodium_mg"] = round(total_sodium / total_g * 100)
        dish["sugar_g"] = round(total_sugar / total_g * 100, 1)


for _ingredient in RAW_INGREDIENTS:
    _vals = MICRONUTRIENTS.get(_ingredient["name"], {"sodium_mg": 0, "sugar_g": 0})
    _ingredient["sodium_mg"] = _vals["sodium_mg"]
    _ingredient["sugar_g"] = _vals["sugar_g"]

_raw_by_name = {item["name"]: item for item in RAW_INGREDIENTS}
_compute_dish_macros(DISHES, _raw_by_name)

FOOD_LIBRARY = RAW_INGREDIENTS + DISHES
