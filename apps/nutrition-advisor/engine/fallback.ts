// A few foods the app knows without a model: used when GEMINI_API_KEY is not
// set or a card call fails, so the app still answers the common first
// questions. Typical USDA reference figures for a default portion; every card
// here is an estimate with an assumed portion, and says so.
import { sameFood } from './advisor.ts';
import type { NutritionData } from './types.ts';

type BuiltIn = { aliases: string[]; card: Omit<NutritionData, 'source' | 'portion_assumed'> };

const card = (
  product_name: string, serving_size: string, calories: number,
  [protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg]: number[],
  health_score: number, health_summary: string, recipes: [string, string][],
) => ({
  product_name, serving_size, calories, health_score, health_summary,
  nutrients: { protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg },
  recipes: recipes.map(([name, description]) => ({ name, description })),
});

const BUILT_IN: BuiltIn[] = [
  {
    aliases: ['banana', 'medium banana'],
    card: card('Medium banana', '1 medium (118 g)', 105, [1.3, 27, 0.4, 3.1, 14.4, 1], 9,
      'A naturally sweet fruit with fiber and potassium; its sugar is the fruit’s own, not added.',
      [['Banana oat smoothie', 'Blend a banana with oats, milk and a spoon of yogurt.'], ['Peanut butter banana toast', 'Sliced banana on wholegrain toast with peanut butter.'], ['Banana oat pancakes', 'Mash a banana with oats and an egg, then cook in small rounds.']]),
  },
  {
    aliases: ['apple', 'medium apple'],
    card: card('Medium apple', '1 medium (182 g)', 95, [0.5, 25, 0.3, 4.4, 19, 2], 9,
      'Crisp and filling for its calories, with good fiber, most of it in the skin.',
      [['Apple cinnamon oats', 'Stir grated apple and cinnamon into warm oats.'], ['Apple peanut butter slices', 'Apple wedges with a spoon of peanut butter.'], ['Baked cinnamon apples', 'Halved apples baked soft with cinnamon and a few oats.']]),
  },
  {
    aliases: ['greek yogurt', 'greek yoghurt', 'yogurt', 'yoghurt', 'plain greek yogurt'],
    card: card('Greek yogurt, plain nonfat', '1 pot (170 g)', 100, [17, 6, 0.7, 0, 6, 61], 9,
      'High in protein and low in sugar for a dairy snack, since the plain kind has nothing added.',
      [['Berry parfait', 'Layer yogurt with berries and a little granola.'], ['Tzatziki dip', 'Yogurt with grated cucumber, garlic and lemon.'], ['Honey walnut yogurt bowl', 'Yogurt topped with walnuts and a drizzle of honey.']]),
  },
  {
    aliases: ['egg', 'large egg', 'boiled egg', 'hard boiled egg'],
    card: card('Large egg', '1 large (50 g)', 72, [6.3, 0.4, 4.8, 0, 0.2, 71], 8,
      'A compact source of protein with almost no carbs, and most of its nutrients in the yolk.',
      [['Veggie scramble', 'Eggs scrambled with spinach, peppers and onion.'], ['Shakshuka', 'Eggs poached in a spiced tomato and pepper sauce.'], ['Egg fried rice', 'Day-old rice stir-fried with egg, peas and spring onion.']]),
  },
  {
    aliases: ['avocado', 'medium avocado'],
    card: card('Medium avocado', '1 medium, flesh only (150 g)', 240, [3, 12.8, 22, 10, 1, 11], 8,
      'Rich in fat, mostly the unsaturated kind, and one of the highest-fiber fruits there is.',
      [['Avocado toast', 'Mashed avocado on wholegrain toast with lemon and chili flakes.'], ['Guacamole', 'Avocado mashed with lime, onion, tomato and cilantro.'], ['Avocado chickpea salad', 'Chickpeas, avocado, cucumber and lemon in one bowl.']]),
  },
  {
    aliases: ['oats', 'rolled oats', 'oatmeal', 'porridge', 'porridge oats'],
    card: card('Rolled oats', '1/2 cup dry (40 g)', 150, [5, 27, 2.5, 4, 1, 0], 9,
      'A whole grain with soluble fiber and steady carbs, and almost no sugar or salt of its own.',
      [['Overnight oats', 'Oats soaked overnight in milk with fruit and seeds.'], ['Banana oat pancakes', 'Oats blended with banana and egg, cooked in small rounds.'], ['Baked oatmeal cups', 'Oats, milk, egg and fruit baked in a muffin tin.']]),
  },
];

/** The app's own sample photo: a plate of grilled salmon, rice, broccoli and green beans. */
export const SAMPLE_CARD: NutritionData = {
  ...card('Grilled salmon with rice and greens', '1 plate, about 450 g (salmon 150 g, rice 150 g, greens 150 g)', 560, [42, 52, 19, 7, 4, 300], 8,
    'A balanced plate: plenty of protein and omega-3 fats from the salmon, fiber from the greens and steady carbs from the rice.',
    [['Salmon rice bowl', 'Flaked salmon over rice with cucumber and a soy-sesame dressing.'], ['Sheet-pan salmon and greens', 'Salmon roasted on one tray with broccoli and green beans.'], ['Salmon fried rice', 'Leftover rice stir-fried with salmon, egg and peas.']]),
  source: 'estimate',
  portion_assumed: true,
};

/** A built-in card for a food the user named, or null. Only for the default portion: a stated quantity needs the model. */
export function builtInCard(name: string): NutritionData | null {
  const found = BUILT_IN.find((entry) => entry.aliases.some((alias) => sameFood(alias, name)));
  return found ? { ...structuredClone(found.card), source: 'estimate', portion_assumed: true } : null;
}
