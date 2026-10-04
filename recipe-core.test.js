import test from "node:test";
import assert from "node:assert/strict";
import { answersMatch, buildStagePlan, buildStages, normalizeAnswer, parseRecipe, parseRecipes } from "./recipe-core.js";

test("normalizes case, ё and punctuation", () => {
  assert.equal(normalizeAnswer("  СЁМГА, Гриль! "), "семга гриль");
});

test("matches answers regardless of word order and punctuation", () => {
  assert.equal(answersMatch("чили, красный", "Красный: чили"), true);
  assert.equal(answersMatch("сливки 33", "33% сливки"), true);
  assert.equal(answersMatch("грибы шиитаке", "Шиитаке — грибы"), true);
});

test("allows generic ingredient words to be omitted", () => {
  assert.equal(answersMatch("чили", "Перец чили"), true);
  assert.equal(answersMatch("дор блю", "Сыр Дор Блю"), true);
  assert.equal(answersMatch("кинза чатни", "Соус Кинза чатни"), false);
  assert.equal(answersMatch("чатни соус кинза", "Соус Кинза чатни"), true);
  assert.equal(answersMatch("перец", "Перец чили"), false);
  assert.equal(answersMatch("соус", "Соус Кинза"), false);
  assert.equal(answersMatch("сыр", "Сыр"), true);
});

test("extracts composition and wiki references", () => {
  const recipe = parseRecipe({ filename: "Блюдо.md", path: "Закуски/Блюдо.md", text: "Текст\n### Состав\n- [[Соус|Соус фирменный]]\n- *Кунжут*\n### Технология\n- не ингредиент" });
  assert.equal(recipe.name, "Блюдо");
  assert.deepEqual(recipe.categories, ["Закуски"]);
  assert.deepEqual(recipe.ingredients.map((x) => x.name), ["Соус фирменный", "Кунжут"]);
  assert.equal(recipe.ingredients[0].ref, "Соус");
});

test("builds nested stages and stops cycles", () => {
  const dish = parseRecipe({ filename: "Блюдо.md", text: "### Состав\n- [[Соус]]" });
  const sauce = parseRecipe({ filename: "Соус.md", text: "### Состав\n- Соль\n- [[Блюдо]]" });
  const stages = buildStages(dish, [dish, sauce]);
  assert.deepEqual(stages.map((x) => x.recipe.name), ["Блюдо", "Соус"]);
});

test("splits a file containing several menu positions", () => {
  const recipes = parseRecipes({
    filename: "Допы.md",
    path: "Бизнес Ланч/Допы.md",
    text: "### Роти\n#### Состав\n- Мука\n### Наан\n#### Состав\n- Дрожжи\n### Чай"
  });
  assert.deepEqual(recipes.map((recipe) => recipe.name), ["Роти", "Наан", "Чай"]);
  assert.deepEqual(recipes.map((recipe) => recipe.ingredients.length), [1, 1, 0]);
});

test("promotes indented ingredients into the same composition", () => {
  const recipe = parseRecipe({
    filename: "Карри.md",
    text: "### Состав\n- Соус\n\t- Паста\n\t\t- Перец\n- Рис"
  });
  const stages = buildStages(recipe, [recipe]);
  assert.deepEqual(stages.map((stage) => stage.recipe.name), ["Карри"]);
  assert.deepEqual(stages[0].recipe.ingredients.map((item) => item.name), ["Соус", "Паста", "Перец", "Рис"]);
});

test("opens linked compositions only as stages after the parent composition", () => {
  const dish = parseRecipe({ filename: "Блюдо.md", text: "### Состав\n- [[Соус]]\n  - Украшение\n- Рис" });
  const sauce = parseRecipe({ filename: "Соус.md", path: "ОпределенияCey/Соус.md", text: "### Состав\n- Специи\n  - Корица\n- Соль" });
  const plan = buildStagePlan(dish, [dish, sauce]);
  assert.deepEqual(plan.recipe.ingredients.map((item) => item.name), ["Соус", "Украшение", "Рис"]);
  assert.equal(plan.children[0][0].recipe.name, "Соус");
  assert.deepEqual(plan.children[0][0].recipe.ingredients.map((item) => item.name), ["Специи", "Корица", "Соль"]);
});

test("marks definition folders as components and deduplicates ingredients", () => {
  const recipe = parseRecipe({
    filename: "Соус.md",
    path: "ceylon/ОпределенияCey/Соус.md",
    text: "### Состав\n- Соль\n- Соль"
  });
  assert.equal(recipe.selectable, false);
  assert.equal(recipe.ingredients.length, 1);
});
