/**
 * Rules that read what a food is from what the sources say about it: its
 * package from a title, whether it is vegetarian or vegan, whether it is a
 * grocery at all, and whether a user's exclusion hits it. Pure functions,
 * so the importers and the planner agree.
 */

/** A package: in grams, millilitres or pieces. */
export interface Package {
  readonly amount: number;
  readonly unit: "g" | "ml" | "piece";
}

/** Whether a food is vegetarian and vegan; `null` where nobody can tell. */
export interface DietFacts {
  readonly vegetarian: boolean | null;
  readonly vegan: boolean | null;
}

const unknownDiet: DietFacts = { vegetarian: null, vegan: null };

const massOrVolume = /(\d+(?:\.\d+)?)\s*(kg|g|ml|litres?|liters?|l)\b/iu;
const multiples =
  /\b(?:pk of|pack of|multipack,?|box of)\s*(\d+)\b|\b(\d+)\s*(?:pack|pk)\b/iu;

/**
 * The package a title like Stats NZ's names: `Bananas, 1kg` (1000 g),
 * `Milk - standard homogenised, 2 litres` (2000 ml), `Eggs, dozen`
 * (12 pieces), `Yoghurt - flavoured, 150g pottle, pk of 6` (900 g),
 * `Tea bags, box of 100` (100 pieces), `Meat pie - hot, each` (1 piece).
 * `null` if the title names none (`Grapes, green or red`).
 */
export const packageOfTitle = (title: string): Package | null => {
  const count = multiples.exec(title);
  const times = count === null ? 1 : Number(count[1] ?? count[2]);
  const measure = massOrVolume.exec(title);
  if (measure !== null) {
    const value = Number(measure[1]);
    const unit = measure[2]!.toLowerCase();
    const amount = unit === "kg" || unit.startsWith("l") ? value * 1000 : value;
    return amount > 0
      ? {
          amount: amount * times,
          unit: unit === "kg" || unit === "g" ? "g" : "ml",
        }
      : null;
  }
  if (/\bdozen\b/iu.test(title)) return { amount: 12 * times, unit: "piece" };
  if (count !== null && times > 0) return { amount: times, unit: "piece" };
  if (/\beach\b/iu.test(title)) return { amount: 1, unit: "piece" };
  return null;
};

// Words that make a food neither vegetarian nor vegan. Generic names only
// (Stats NZ items, Open Prices categories); products have Open Food Facts'
// own analysis instead.
const meatOrFish = [
  "beef",
  "pork",
  "lamb",
  "hogget",
  "mutton",
  "veal",
  "chicken",
  "turkey",
  "duck",
  "bacon",
  "ham",
  "sausage",
  "salami",
  "mince",
  "steak",
  "meat",
  "corned",
  "fish",
  "tuna",
  "salmon",
  "prawn",
  "shrimp",
  "mussel",
  "oyster",
  "anchov",
  "sardine",
  "gelatin",
];
// Vegetarian, but not vegan.
const animalProducts = [
  "milk",
  "cheese",
  "camembert",
  "cheddar",
  "yoghurt",
  "yogurt",
  "butter",
  "cream",
  "eggs?\\b",
  "honey",
  "mayonnaise",
  "ice cream",
  "infant formula",
];
// Plants with nothing added: vegan.
const plants = [
  "orange",
  "banana",
  "apple",
  "kiwifruit",
  "sultana",
  "apricot",
  "avocado",
  "pear",
  "peach",
  "pineapple",
  "mandarin",
  "grape",
  "berr",
  "lettuce",
  "broccoli",
  "cabbage",
  "tomato",
  "carrot",
  "mushroom",
  "potato",
  "kumara",
  "peas",
  "beans",
  "capsicum",
  "cauliflower",
  "courgette",
  "cucumber",
  "onion",
  "parsnip",
  "pumpkin",
  "vegetable",
  "herbs",
  "salad, leaf",
  "flour",
  "rice",
  "sugar",
  "olive oil",
  "vinegar",
  "soy milk",
  "soy sauce",
  "peanut",
  "olives",
  "coffee",
  "tea bags",
  "bottled water",
  "fruit juice",
  "orange juice",
  "hummus",
  "jam",
  "lentil",
  "chickpea",
  "oat",
  "tofu",
];

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/^[a-z]{2}:/u, "")
    .replace(/-/gu, " ");

const mentions = (text: string, list: ReadonlyArray<string>) =>
  list.some((word) => new RegExp(`\\b${word}`, "u").test(text));

/**
 * Whether a generically named food (`Beef - mince, 1kg`, `en:apples`) is
 * vegetarian or vegan, from the words in its name. Meat and fish come
 * first, so `Chicken pieces` is neither, and anything not clearly a plant
 * or a dairy/egg product stays unknown (`Biscuits - chocolate`, `Pizza`).
 */
export const dietOfName = (name: string): DietFacts => {
  const text = words(name);
  if (/\bvegan\b/u.test(text)) return { vegetarian: true, vegan: true };
  if (mentions(text, meatOrFish)) return { vegetarian: false, vegan: false };
  if (/\bvegetarian\b/u.test(text)) return { vegetarian: true, vegan: null };
  if (mentions(text, animalProducts)) return { vegetarian: true, vegan: false };
  if (mentions(text, plants)) return { vegetarian: true, vegan: true };
  return unknownDiet;
};

/**
 * Whether an Open Food Facts product is vegetarian or vegan: its labels
 * (`en:vegan`, `en:vegetarian`) win, then Open Food Facts' analysis of the
 * ingredients (`en:non-vegetarian`, `en:maybe-vegan`, ...). Only clear
 * answers count; "maybe" and "unknown" stay `null`.
 */
export const dietOfProduct = (
  labels: ReadonlyArray<string>,
  analysis: ReadonlyArray<string>,
): DietFacts => {
  const has = (tag: string) => labels.includes(tag) || analysis.includes(tag);
  // Records contradict themselves at times; then the stricter reading
  // wins, since wrongly calling a product vegan is worse than missing it.
  const nonVegetarian = has("en:non-vegetarian");
  const vegan =
    nonVegetarian || has("en:non-vegan")
      ? false
      : has("en:vegan")
        ? true
        : null;
  const vegetarian = nonVegetarian
    ? false
    : vegan === true || has("en:vegetarian")
      ? true
      : null;
  return { vegetarian, vegan };
};

const takeaway = [
  "takeaway",
  "takeway",
  "hot chips",
  "fish and chips",
  "burger",
  "sandwich",
  "poured",
  "bread rolls, filled",
  "meat pie",
  "fried and other",
  "chicken, cooked",
  "baby food",
  "infant formula",
  "chewing gum",
];

/**
 * Whether a food is something to cook with or eat at home in a weekly plan:
 * not takeaway food, baby food or chewing gum.
 */
export const isGrocery = (name: string): boolean =>
  !takeaway.some((word) => name.toLowerCase().includes(word));

/**
 * A readable name for an Open Food Facts category tag: `en:green-beans` →
 * `Green beans`; tags in other languages (`de:feldsalat`) as well.
 */
export const nameOfCategory = (tag: string): string => {
  const text = tag
    .replace(/^[a-z]{2}:/u, "")
    .replace(/-/gu, " ")
    .trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** A user's exclusion, lowercased, singular and plural: `apples` → both. */
export const exclusionTerms = (exclusion: string): ReadonlyArray<string> => {
  const term = exclusion.trim().toLowerCase().replace(/\s+/gu, " ");
  if (term === "") return [];
  const singular = term.endsWith("ies")
    ? `${term.slice(0, -3)}y`
    : term.endsWith("oes") || term.endsWith("ches") || term.endsWith("shes")
      ? term.slice(0, -2)
      : term.endsWith("s") && !term.endsWith("ss")
        ? term.slice(0, -1)
        : term;
  return [...new Set([term, singular])];
};

/** What an exclusion is matched against. */
export interface Excludable {
  readonly name: string;
  readonly brand: string | null;
  readonly categories: ReadonlyArray<string>;
  readonly ingredients: ReadonlyArray<string>;
  readonly allergens: ReadonlyArray<string>;
}

/**
 * Whether any of the user's exclusions (`apples`, `peanuts`, `milk`) hits a
 * food: as a word in its name or brand, or in one of its category,
 * ingredient or allergen tags. Tags are English (`en:apple`) whatever the
 * product's language, so English exclusions also work for German products
 * that Open Food Facts has analysed.
 */
export const exclusionMatcher = (
  exclusions: ReadonlyArray<string>,
): ((food: Excludable) => boolean) => {
  // Built once per plan: a plan checks thousands of foods.
  const patterns = exclusions
    .flatMap(exclusionTerms)
    .map(
      (term) =>
        new RegExp(
          `(^|[^\\p{L}])${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`,
          "u",
        ),
    );
  if (patterns.length === 0) return () => false;
  return (food) => {
    const text = `${food.name} ${food.brand ?? ""}`.toLowerCase();
    const tags = [
      ...food.categories,
      ...food.ingredients,
      ...food.allergens,
    ].map(words);
    return patterns.some(
      (pattern) => pattern.test(text) || tags.some((tag) => pattern.test(tag)),
    );
  };
};

/** `exclusionMatcher` for a single food. */
export const isExcluded = (
  food: Excludable,
  exclusions: ReadonlyArray<string>,
): boolean => exclusionMatcher(exclusions)(food);
