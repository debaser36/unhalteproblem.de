import { assert, describe, it } from "@effect/vitest";
import {
  dietOfName,
  dietOfProduct,
  exclusionTerms,
  isExcluded,
  isGrocery,
  nameOfCategory,
  packageOfTitle,
} from "./Classification.ts";

describe("packageOfTitle", () => {
  it("reads masses and volumes in g and ml", () => {
    assert.deepStrictEqual(packageOfTitle("Bananas, 1kg"), {
      amount: 1000,
      unit: "g",
    });
    assert.deepStrictEqual(
      packageOfTitle("Sultanas (supermarket only), 375g"),
      {
        amount: 375,
        unit: "g",
      },
    );
    assert.deepStrictEqual(
      packageOfTitle("Flour - white (supermarket only), 1.5kg"),
      {
        amount: 1500,
        unit: "g",
      },
    );
    assert.deepStrictEqual(
      packageOfTitle("Milk - standard homogenised, 2 litres"),
      {
        amount: 2000,
        unit: "ml",
      },
    );
    assert.deepStrictEqual(packageOfTitle("Bottled water, 750ml"), {
      amount: 750,
      unit: "ml",
    });
  });

  it("multiplies packs", () => {
    assert.deepStrictEqual(
      packageOfTitle(
        "Yoghurt - flavoured, 150g pottle (supermarket only), pk of 6",
      ),
      { amount: 900, unit: "g" },
    );
    assert.deepStrictEqual(packageOfTitle("Breakfast drink, 250ml, 6 pack"), {
      amount: 1500,
      unit: "ml",
    });
  });

  it("counts pieces", () => {
    assert.deepStrictEqual(packageOfTitle("Eggs, dozen"), {
      amount: 12,
      unit: "piece",
    });
    assert.deepStrictEqual(packageOfTitle("Eggs, free range, 6 pack"), {
      amount: 6,
      unit: "piece",
    });
    assert.deepStrictEqual(
      packageOfTitle("Tea bags (supermarket only), box of 100"),
      {
        amount: 100,
        unit: "piece",
      },
    );
    assert.deepStrictEqual(packageOfTitle("Meat pie - hot, each"), {
      amount: 1,
      unit: "piece",
    });
  });

  it("is null without a quantity", () => {
    assert.isNull(packageOfTitle("Grapes, green or red"));
    assert.isNull(packageOfTitle("Flat bread - pita, tortilla, or other type"));
  });
});

describe("dietOfName", () => {
  it("knows meat and fish", () => {
    for (const name of [
      "Beef - mince, 1kg",
      "Chicken pieces (excluding breast), boneless or bone in, 1kg",
      "Tuna - canned (supermarket only), 185g",
      "Bacon - middle rashers (supermarket only), 700g",
      "en:chicken-breasts",
    ]) {
      assert.deepStrictEqual(
        dietOfName(name),
        { vegetarian: false, vegan: false },
        name,
      );
    }
  });

  it("knows dairy and eggs as vegetarian but not vegan", () => {
    for (const name of [
      "Cheese - mild cheddar, 1kg",
      "Eggs, dozen",
      "Butter - salted, 500g",
    ]) {
      assert.deepStrictEqual(
        dietOfName(name),
        { vegetarian: true, vegan: false },
        name,
      );
    }
  });

  it("knows plain plants as vegan", () => {
    for (const name of [
      "Bananas, 1kg",
      "Kumara, 1kg",
      "en:apples",
      "Rice - long grain, white, 1kg",
    ]) {
      assert.deepStrictEqual(
        dietOfName(name),
        { vegetarian: true, vegan: true },
        name,
      );
    }
  });

  it("does not take eggplant for egg", () => {
    assert.notStrictEqual(dietOfName("en:eggplants").vegan, false);
  });

  it("never calls peanut butter or milk drinks vegan", () => {
    assert.isFalse(dietOfName("Peanut butter, not salt free, 375g").vegan);
    assert.isFalse(dietOfName("Soy milk, unflavoured, 1 litre").vegan);
  });

  it("stays unknown for prepared foods", () => {
    for (const name of [
      "Biscuits - chocolate, 200g",
      "Pizza, fresh or frozen, with any standard topping, each",
      "Dried pasta, spaghetti or other type, 500g",
    ]) {
      assert.deepStrictEqual(
        dietOfName(name),
        { vegetarian: null, vegan: null },
        name,
      );
    }
  });
});

describe("dietOfProduct", () => {
  it("trusts labels and the ingredient analysis", () => {
    assert.deepStrictEqual(dietOfProduct(["en:vegan"], []), {
      vegetarian: true,
      vegan: true,
    });
    assert.deepStrictEqual(
      dietOfProduct([], ["en:non-vegan", "en:vegetarian"]),
      {
        vegetarian: true,
        vegan: false,
      },
    );
  });

  it("believes the stricter tag when tags contradict each other", () => {
    assert.deepStrictEqual(
      dietOfProduct([], ["en:non-vegetarian", "en:vegan"]),
      {
        vegetarian: false,
        vegan: false,
      },
    );
  });

  it("leaves maybe and unknown as null", () => {
    assert.deepStrictEqual(
      dietOfProduct([], ["en:maybe-vegan", "en:vegetarian-status-unknown"]),
      { vegetarian: null, vegan: null },
    );
  });
});

describe("isGrocery", () => {
  it("leaves out takeaway, baby food and chewing gum", () => {
    assert.isFalse(isGrocery("Fish and chips, One fish/chips"));
    assert.isFalse(isGrocery("Coffee, takeway, each"));
    assert.isFalse(isGrocery("Pizza, takeaway"));
    assert.isFalse(isGrocery("Baby food, 110g"));
    assert.isFalse(isGrocery("Chewing gum, packet, each"));
    assert.isTrue(isGrocery("Potatoes, 1kg"));
    assert.isTrue(isGrocery("Chicken breast, 1kg"));
  });
});

describe("nameOfCategory", () => {
  it("makes tags readable", () => {
    assert.strictEqual(nameOfCategory("en:green-beans"), "Green beans");
    assert.strictEqual(nameOfCategory("de:feldsalat"), "Feldsalat");
  });
});

describe("exclusions", () => {
  it("match singular and plural", () => {
    assert.deepStrictEqual(exclusionTerms(" Apples "), ["apples", "apple"]);
    assert.deepStrictEqual(exclusionTerms("berries"), ["berries", "berry"]);
    assert.deepStrictEqual(exclusionTerms("tomatoes"), ["tomatoes", "tomato"]);
    assert.deepStrictEqual(exclusionTerms("glass"), ["glass"]);
    assert.deepStrictEqual(exclusionTerms("  "), []);
  });

  const food = {
    name: "Apfelmus",
    brand: "Odenwald",
    categories: ["en:plant-based-foods", "en:fruit-purees"],
    ingredients: ["en:apple", "en:sugar"],
    allergens: [],
  };

  it("hit ingredient tags whatever the product's language", () => {
    assert.isTrue(isExcluded(food, ["apples"]));
    assert.isTrue(isExcluded(food, ["Sugar"]));
    assert.isFalse(isExcluded(food, ["peanuts"]));
    assert.isFalse(isExcluded(food, []));
  });

  it("hit names and brands as words, not inside other words", () => {
    const pineapple = {
      ...food,
      name: "Pineapple, 1kg",
      ingredients: [],
      categories: [],
    };
    assert.isFalse(isExcluded(pineapple, ["apple"]));
    assert.isTrue(isExcluded(pineapple, ["pineapples"]));
    assert.isTrue(isExcluded(food, ["odenwald"]));
  });

  it("hit allergens", () => {
    const bread = { ...food, ingredients: [], allergens: ["en:gluten"] };
    assert.isTrue(isExcluded(bread, ["gluten"]));
  });

  it("treat regular expression characters literally", () => {
    assert.isFalse(isExcluded(food, ["a.*"]));
  });
});
