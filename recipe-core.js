export function normalizeAnswer(value = "") {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[«»"'`]/g, "").replace(/[.,;:!?()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

const OPTIONAL_ANSWER_WORDS = new Set(["перец", "сыр"]);

function answerTokens(value) {
  const tokens = value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((token) => !OPTIONAL_ANSWER_WORDS.has(token));
  return (meaningful.length ? meaningful : tokens).sort((a, b) => a.localeCompare(b, "ru"));
}

export function answersMatch(input, expected) {
  const actualTokens = answerTokens(input);
  const expectedTokens = answerTokens(expected);
  return actualTokens.length > 0 && actualTokens.length === expectedTokens.length && actualTokens.every((token, index) => token === expectedTokens[index]);
}

function cleanName(value = "") {
  return value.replace(/^\[|\]$/g, "").replace(/[*_~`]/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return {};
  const result = {};
  for (const line of markdown.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    if (key === "categories" || key === "category") result.categories = value.replace(/^\[|\]$/g, "").split(",").map(cleanName).filter(Boolean);
    else if (key === "title" || key === "name") result.title = cleanName(value);
    else if (key === "type" || key === "kind") result.kind = normalizeAnswer(value);
  }
  return result;
}

function extractComposition(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+состав\s*$/i.test(line.trim()));
  if (start < 0) return [];
  const headingLevel = lines[start].match(/^#+/)[0].length;
  const section = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const heading = lines[i].match(/^(#{1,6})(?:\s+|$)/);
    if (heading && heading[1].length <= headingLevel) break;
    section.push(lines[i]);
  }
  return section;
}

function parseIngredientText(value) {
  let raw = value.replace(/^(?:\[[ xX]\]\s*)/, "").trim();
  const wiki = raw.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/);
  const link = raw.match(/\[([^\]]+)\]\(([^)]+\.md)(?:#[^)]+)?\)/i);
  const ref = wiki ? cleanName(wiki[1].split(/[\\/]/).pop()) : link ? cleanName(link[2].split(/[\\/]/).pop().replace(/\.md$/i, "")) : null;
  if (wiki) raw = raw.replace(wiki[0], wiki[2] || wiki[1]);
  if (link) raw = raw.replace(link[0], link[1]);
  const name = cleanName(raw);
  return name ? { name, ref, key: normalizeAnswer(name), children: [] } : null;
}

function deduplicateIngredients(items) {
  const result = [];
  const byKey = new Map();
  for (const item of items) {
    item.children = deduplicateIngredients(item.children || []);
    const existing = byKey.get(item.key);
    if (existing) {
      existing.children = deduplicateIngredients([...existing.children, ...item.children]);
      existing.ref ||= item.ref;
    } else {
      byKey.set(item.key, item);
      result.push(item);
    }
  }
  return result;
}

function parseIngredientTree(lines) {
  const root = [];
  const stack = [{ indent: -1, items: root }];
  for (const line of lines) {
    const bullet = line.match(/^([\t ]*)[-+*]\s+(.+?)\s*$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, "    ").length;
      const ingredient = parseIngredientText(bullet[2]);
      if (!ingredient) continue;
      while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
      stack.at(-1).items.push(ingredient);
      stack.push({ indent, items: ingredient.children });
      continue;
    }
    // Восстанавливаем короткий ингредиент, у которого случайно потерян маркер списка.
    const recovered = line.match(/^[ ]{1,3}([^#|>].{0,70}?)\s*$/);
    if (recovered && recovered[1].trim()) {
      const ingredient = parseIngredientText(recovered[1]);
      if (ingredient) root.push(ingredient);
    }
  }
  return deduplicateIngredients(root);
}

function pathMetadata(filename, inputPath, frontMatter) {
  const relativePath = (inputPath || filename).replace(/\\/g, "/");
  const segments = relativePath.split("/").filter(Boolean);
  const folder = segments.length > 1 ? segments.at(-2) : "";
  const componentFolder = segments.some((part) => /^(определения|components?|компоненты|заготовки|полуфабрикаты)/i.test(part));
  const templateFolder = segments.some((part) => /^(templates?|шаблоны)/i.test(part));
  const componentKind = frontMatter.kind && /^(component|компонент|заготовка)/.test(frontMatter.kind);
  return {
    relativePath,
    categories: frontMatter.categories?.length ? frontMatter.categories : [folder || "Без категории"],
    selectable: !(componentFolder || componentKind),
    ignored: templateFolder
  };
}

const META_HEADINGS = new Set(["состав", "технология приготовления", "технология", "сочетания", "что можем убрать"]);

function entrySections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = lines.map((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) return null;
    const title = cleanName(match[2].replace(/^#+\s*/, ""));
    return { index, level: match[1].length, title };
  }).filter(Boolean);
  if (!headings.length) return [];
  const topLevel = Math.min(...headings.map((heading) => heading.level));
  const candidates = headings.filter((heading) => heading.level === topLevel && !META_HEADINGS.has(normalizeAnswer(heading.title)));
  if (candidates.length < 2) return [];
  return candidates.map((heading) => {
    const end = headings.find((next) => next.index > heading.index && next.level <= heading.level)?.index ?? lines.length;
    return { title: heading.title, text: lines.slice(heading.index + 1, end).join("\n") };
  });
}

function makeRecipe({ filename, metadata, name, text, suffix = "" }) {
  return {
    id: normalizeAnswer(`${metadata.relativePath}${suffix}`), name, filename,
    path: metadata.relativePath, sourcePath: metadata.relativePath,
    categories: metadata.categories, selectable: metadata.selectable,
    ingredients: parseIngredientTree(extractComposition(text))
  };
}

export function parseRecipes({ filename, path = "", text }) {
  const frontMatter = parseFrontMatter(text);
  const metadata = pathMetadata(filename, path, frontMatter);
  if (metadata.ignored) return [];
  const sections = entrySections(text);
  if (sections.length) return sections.map((section, index) => makeRecipe({ filename, metadata, name: section.title, text: section.text, suffix: `#${index + 1}:${section.title}` }));

  const ingredients = parseIngredientTree(extractComposition(text));
  if (!ingredients.length && metadata.selectable) return [];
  const fileStem = filename.replace(/\.md$/i, "");
  return [{
    id: normalizeAnswer(metadata.relativePath || filename), name: frontMatter.title || cleanName(fileStem), filename,
    path: metadata.relativePath, sourcePath: metadata.relativePath,
    categories: metadata.categories, selectable: metadata.selectable, ingredients
  }];
}

export function parseRecipe(input) {
  return parseRecipes(input)[0] || {
    id: normalizeAnswer(input.path || input.filename), name: cleanName(input.filename.replace(/\.md$/i, "")), filename: input.filename,
    path: (input.path || input.filename).replace(/\\/g, "/"), sourcePath: (input.path || input.filename).replace(/\\/g, "/"),
    categories: ["Без категории"], selectable: true, ingredients: []
  };
}

function recipeLookup(recipes) {
  const byName = new Map();
  const register = (key, recipe) => {
    const normalized = normalizeAnswer(key);
    const current = byName.get(normalized);
    if (!current || (current.selectable !== false && recipe.selectable === false)) byName.set(normalized, recipe);
  };
  for (const recipe of recipes) {
    register(recipe.name, recipe);
    register(recipe.filename.replace(/\.md$/i, ""), recipe);
  }
  return byName;
}

export function buildStagePlan(rootRecipe, recipes) {
  const byName = recipeLookup(recipes);
  const visited = new Set();
  const buildNode = (recipe, breadcrumb) => {
    if (!recipe?.ingredients.length || visited.has(recipe.id)) return null;
    visited.add(recipe.id);
    const flattened = [];
    const flattenedByKey = new Map();
    const appendIngredient = (ingredient) => {
      const existing = flattenedByKey.get(ingredient.key);
      if (existing) existing.ref ||= ingredient.ref;
      else {
        const flatIngredient = { ...ingredient, children: [] };
        flattenedByKey.set(ingredient.key, flatIngredient);
        flattened.push(flatIngredient);
      }
      (ingredient.children || []).forEach(appendIngredient);
    };
    recipe.ingredients.forEach(appendIngredient);
    const stageRecipe = flattened.length === recipe.ingredients.length && recipe.ingredients.every((item) => !item.children?.length)
      ? recipe
      : { ...recipe, ingredients: flattened };
    const node = { recipe: stageRecipe, breadcrumb, children: flattened.map(() => []) };
    flattened.forEach((ingredient, index) => {
      if (ingredient.ref) {
        const nested = byName.get(normalizeAnswer(ingredient.ref));
        const child = buildNode(nested, [...breadcrumb, nested?.name || ingredient.name]);
        if (child) node.children[index].push(child);
      }
    });
    return node;
  };
  return buildNode(rootRecipe, [rootRecipe.name]);
}

export function buildStages(rootRecipe, recipes) {
  const plan = buildStagePlan(rootRecipe, recipes);
  const stages = [];
  const visit = (node) => {
    if (!node) return;
    stages.push({ recipe: node.recipe, breadcrumb: node.breadcrumb });
    node.children.flat().forEach(visit);
  };
  visit(plan);
  return stages;
}

export function selectWeakRecipe(recipes, stats) {
  const ranked = recipes.filter((recipe) => recipe.selectable !== false && recipe.ingredients.length).map((recipe) => {
    const item = stats[recipe.id] || {};
    return { recipe, score: (item.errors || 0) * 3 + (item.attempts || 0) - (item.completed || 0) * 0.25 };
  }).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].recipe : null;
}
