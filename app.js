import { answersMatch, buildStagePlan, normalizeAnswer, parseRecipe, parseRecipes, selectWeakRecipe } from "./recipe-core.js";

const LIBRARY_KEY = "lernmenu.library.v1";
const STATS_KEY = "lernmenu.stats.v2";
const PREFS_KEY = "lernmenu.prefs.v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let recipes = readJson(LIBRARY_KEY, []);
let stats = readJson(STATS_KEY, {});
let prefs = readJson(PREFS_KEY, { showCount: true, countErrors: true, dark: false });
let session = null;
let selectedRecipeIds = new Set();
let practiceQueue = [];
let practiceMode = null;

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function persist(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function randomItem(items) { return items[Math.floor(Math.random() * items.length)]; }
function shuffled(items) { return [...items].sort(() => Math.random() - 0.5); }

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
  if (name === "stats") renderStats();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function categoryList() {
  return [...new Set(recipes.filter(isDish).flatMap((recipe) => recipe.categories))].sort((a, b) => a.localeCompare(b, "ru"));
}

function isDish(recipe) { return recipe.selectable !== false; }

function flattenIngredients(items) {
  return items.flatMap((item) => [item, ...flattenIngredients(item.children || [])]);
}

function selectedCategories() {
  return $$('#categoryFilters input:checked').map((input) => input.value);
}

function eligibleRecipes() {
  const selected = selectedCategories();
  return recipes.filter((recipe) => isDish(recipe) && recipe.ingredients.length && recipe.categories.some((category) => selected.includes(category)));
}

function renderLibrary(message = "") {
  const dishes = recipes.filter(isDish);
  const components = recipes.filter((recipe) => !isDish(recipe));
  $("#heroCount").textContent = dishes.length;
  $("#clearLibrary").classList.toggle("hidden", !recipes.length);
  $("#importSummary").innerHTML = message || (recipes.length ? `<strong>Блюд: ${dishes.length}.</strong> Внутренних компонентов: ${components.length}.` : "Поддерживаются списки в разделе «### Состав», вложенные пункты и ссылки [[на внутренние компоненты]].");
  const categories = categoryList();
  $("#categoryFilters").innerHTML = categories.length ? categories.map((category) => {
    const count = dishes.filter((recipe) => recipe.categories.includes(category)).length;
    return `<label class="chip"><input type="checkbox" value="${escapeHtml(category)}" checked /><span>${escapeHtml(category)} <b>${count}</b></span></label>`;
  }).join("") : '<span class="empty-note">Сначала загрузите рецепты</span>';
  $("#databaseBrowser").classList.toggle("hidden", !recipes.length);
  renderRecipeList();
  updateStartButtons();
}

function renderRecipeList() {
  const query = normalizeAnswer($("#recipeSearch")?.value || "");
  const visible = recipes
    .filter((recipe) => !query || normalizeAnswer(`${recipe.name} ${recipe.categories.join(" ")} ${flattenIngredients(recipe.ingredients).map((item) => item.name).join(" ")}`).includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  $("#recipeListEmpty").classList.toggle("hidden", !!visible.length);
  $("#recipeList").innerHTML = visible.map((recipe) => {
    const encodedId = encodeURIComponent(recipe.id);
    const ingredients = recipe.ingredients.length
      ? renderIngredientTree(recipe.ingredients)
      : '<p class="no-composition">Раздел «Состав» не найден</p>';
    const type = isDish(recipe) ? "Блюдо" : "Внутренний компонент";
    const selected = selectedRecipeIds.has(recipe.id);
    const canTrain = isDish(recipe) && recipe.ingredients.length;
    return `<details class="recipe-card ${selected ? "selected" : ""}">
      <summary>
        <span class="recipe-card-title"><strong>${escapeHtml(recipe.name)} <i class="recipe-type ${isDish(recipe) ? "" : "component"}">${type}</i></strong><small>${escapeHtml(recipe.categories.join(" · "))} · ${escapeHtml(recipe.filename)}</small></span>
        <span class="recipe-card-count" title="Ингредиентов">${recipe.ingredients.length}</span>
        ${canTrain ? `<button type="button" class="select-recipe" data-select-recipe="${encodedId}">${selected ? "✓ Выбрано" : "+ Выбрать"}</button>` : ""}
      </summary>
      <div class="recipe-card-body">${ingredients}<button class="delete-recipe" data-recipe-id="${encodedId}">Удалить блюдо</button></div>
    </details>`;
  }).join("");
  updateSelectionUI();
}

function renderIngredientTree(items) {
  return `<ul>${items.map((item) => `<li><span>${escapeHtml(item.name)}${item.ref ? " ↗" : ""}</span>${item.children?.length ? renderIngredientTree(item.children) : ""}</li>`).join("")}</ul>`;
}

function deleteRecipe(id) {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe || !confirm(`Удалить «${recipe.name}» из базы? История этого блюда также будет удалена.`)) return;
  recipes = recipes.filter((item) => item.id !== id);
  selectedRecipeIds.delete(id);
  delete stats[id];
  persist(LIBRARY_KEY, recipes);
  persist(STATS_KEY, stats);
  renderLibrary(`<strong>Блюдо «${escapeHtml(recipe.name)}» удалено.</strong> В базе осталось: ${recipes.length}.`);
}

function selectedRecipes() {
  return recipes.filter((recipe) => selectedRecipeIds.has(recipe.id) && isDish(recipe) && recipe.ingredients.length);
}

function updateSelectionUI() {
  selectedRecipeIds = new Set([...selectedRecipeIds].filter((id) => recipes.some((recipe) => recipe.id === id && isDish(recipe) && recipe.ingredients.length)));
  const count = selectedRecipes().length;
  $("#selectionCount").textContent = count ? `Выбрано блюд: ${count}` : "Ничего не выбрано";
  $("#startSelected").disabled = !count;
  $("#clearRecipeSelection").classList.toggle("hidden", !count);
}

function startBatch(items, mode) {
  const queue = shuffled(items.filter((recipe) => isDish(recipe) && recipe.ingredients.length));
  if (!queue.length) return;
  practiceMode = mode;
  const first = queue.shift();
  practiceQueue = queue.map((recipe) => recipe.id);
  startRecipe(first, true);
}

function updateStartButtons() {
  const available = eligibleRecipes();
  $("#startRandom").disabled = !available.length;
  $("#startWeak").disabled = !selectWeakRecipe(available, stats);
}

function escapeHtml(value) {
  const el = document.createElement("div");
  el.textContent = value;
  return el.innerHTML;
}

async function importFiles(fileList) {
  const files = [...fileList].filter((file) => file.name.toLowerCase().endsWith(".md"));
  if (!files.length) return renderLibrary('<span class="danger">Не найдено ни одного .md-файла.</span>');
  const sourcePaths = new Set(files.map((file) => (file.webkitRelativePath || file.name).replace(/\\/g, "/")));
  const imported = (await Promise.all(files.map(async (file) => parseRecipes({ filename: file.name, path: file.webkitRelativePath || file.name, text: await file.text() })))).flat();
  const merged = new Map(recipes.filter((recipe) => !sourcePaths.has(recipe.sourcePath || recipe.path)).map((recipe) => [recipe.id, recipe]));
  imported.forEach((recipe) => merged.set(recipe.id, recipe));
  recipes = [...merged.values()];
  persist(LIBRARY_KEY, recipes);
  const importedDishes = imported.filter(isDish);
  const importedComponents = imported.filter((recipe) => !isDish(recipe));
  renderLibrary(`<strong>Обработано файлов: ${files.length}.</strong> Найдено блюд: ${importedDishes.length}; внутренних компонентов: ${importedComponents.length}.`);
}

function startRecipe(recipe, keepPracticeQueue = false) {
  if (!recipe) return;
  if (!keepPracticeQueue) {
    practiceMode = null;
    practiceQueue = [];
  }
  const plan = buildStagePlan(recipe, recipes);
  if (!plan) return;
  session = { root: recipe, frames: [makeFrame(plan)], pendingNodes: [], totalStages: countPlanNodes(plan), completedStages: 0, errors: 0, correct: 0 };
  const item = stats[recipe.id] ||= { attempts: 0, completed: 0, errors: 0, correct: 0, ingredients: {} };
  item.attempts += 1;
  persist(STATS_KEY, stats);
  showView("quiz");
  renderStage();
}

function makeFrame(node) {
  return { node, guessed: new Set(), revealed: new Set(), pendingErrors: 0 };
}

function countPlanNodes(node) {
  return node ? 1 + node.children.flat().reduce((sum, child) => sum + countPlanNodes(child), 0) : 0;
}

function currentFrame() { return session?.frames.at(-1); }
function currentStage() { return currentFrame()?.node; }

function renderStage() {
  const stage = currentStage();
  if (!stage) return finishSession();
  const isRoot = stage.breadcrumb.length === 1;
  $("#stageLabel").textContent = isRoot ? "Основной состав" : `Внутренний состав · уровень ${stage.breadcrumb.length}`;
  $("#quizTitle").textContent = stage.recipe.name;
  $("#breadcrumbs").innerHTML = stage.breadcrumb.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  $("#answerInput").value = "";
  $("#answerInput").disabled = false;
  $("#knowStage").classList.toggle("hidden", isRoot);
  $("#feedback").textContent = "Порядок слов и знаки не важны; «перец» и «сыр» можно не писать";
  $("#feedback").className = "feedback";
  renderAnswers();
  setTimeout(() => $("#answerInput").focus(), 50);
}

function renderAnswers() {
  const stage = currentStage();
  const frame = currentFrame();
  const total = stage.recipe.ingredients.length;
  const done = frame.guessed.size + frame.revealed.size;
  $("#foundCount").textContent = `${done} / ${total}`;
  $("#progressText").textContent = prefs.showCount ? `Найдено ${done} из ${total}` : done === total ? "Состав завершён" : "Вспоминайте состав";
  $("#errorText").textContent = prefs.countErrors ? `Ошибок: ${session.errors}` : "";
  $("#progressBar").style.width = `${total ? done / total * 100 : 0}%`;
  $("#answerList").innerHTML = renderAnswerTree(stage.displayIngredients || stage.recipe.ingredients, frame);
}

function renderAnswerTree(ingredients, frame) {
  return ingredients.map((ingredient) => {
    const found = frame.guessed.has(ingredient.key);
    const revealed = frame.revealed.has(ingredient.key);
    const children = ingredient.children?.length
      ? `<div class="answer-children">${renderAnswerTree(ingredient.children, frame)}</div>`
      : "";
    return `<div class="answer-node"><div class="answer-item ${found ? "found" : ""} ${revealed ? "revealed" : ""}">${found || revealed ? escapeHtml(ingredient.name) : "скрыто"}</div>${children}</div>`;
  }).join("");
}

function recordError(recipe, ingredient = null) {
  if (!prefs.countErrors) return;
  const item = stats[session.root.id];
  item.errors += 1;
  if (ingredient) markIngredientDifficulty(recipe, ingredient, 1);
  persist(STATS_KEY, stats);
}

function markIngredientDifficulty(recipe, ingredient, amount) {
  const item = stats[session.root.id];
  const key = `${recipe.name} → ${ingredient}`;
  item.ingredients[key] = (item.ingredients[key] || 0) + amount;
}

function flash(type, message) {
  const wrap = $(".answer-wrap");
  wrap.classList.remove("correct", "wrong");
  void wrap.offsetWidth;
  wrap.classList.add(type === "good" ? "correct" : "wrong");
  $("#feedback").textContent = message;
  $("#feedback").className = `feedback ${type}`;
  setTimeout(() => wrap.classList.remove("correct", "wrong"), 450);
}

function submitAnswer(event) {
  event.preventDefault();
  const input = $("#answerInput");
  const answer = input.value.trim();
  if (!answer) return;
  const stage = currentStage();
  const frame = currentFrame();
  const candidates = stage.recipe.ingredients.filter((ingredient) => answersMatch(answer, ingredient.name));
  const available = candidates.filter((ingredient) => !frame.guessed.has(ingredient.key) && !frame.revealed.has(ingredient.key));
  const match = available.find((ingredient) => normalizeAnswer(ingredient.name) === normalizeAnswer(answer)) || available[0] || candidates[0];
  if (match && !frame.guessed.has(match.key) && !frame.revealed.has(match.key)) {
    frame.guessed.add(match.key);
    session.correct += 1;
    if (prefs.countErrors && frame.pendingErrors) {
      markIngredientDifficulty(stage.recipe, match.name, frame.pendingErrors);
      frame.pendingErrors = 0;
    }
    stats[session.root.id].correct += 1;
    persist(STATS_KEY, stats);
    input.value = "";
    flash("good", `Верно: ${match.name}`);
    renderAnswers();
    continueAfterIngredient(match);
  } else if (match) {
    input.value = "";
    flash("bad", "Этот ингредиент уже найден");
  } else {
    session.errors += 1;
    frame.pendingErrors += 1;
    recordError(stage.recipe);
    flash("bad", "Такого ингредиента в текущем составе нет");
    input.select();
    renderAnswers();
  }
}

function revealOne() {
  const stage = currentStage();
  const frame = currentFrame();
  const next = stage.recipe.ingredients.find((item) => !frame.guessed.has(item.key) && !frame.revealed.has(item.key));
  if (!next) return;
  if (prefs.countErrors && frame.pendingErrors) {
    markIngredientDifficulty(stage.recipe, next.name, frame.pendingErrors);
    frame.pendingErrors = 0;
  }
  frame.revealed.add(next.key);
  session.errors += 1;
  recordError(stage.recipe, next.name);
  flash("bad", `Ответ открыт: ${next.name}`);
  renderAnswers();
  continueAfterIngredient(next);
}

function knowCurrentStage() {
  const stage = currentStage();
  const frame = currentFrame();
  if (!stage || stage.breadcrumb.length === 1) return;
  const remaining = stage.recipe.ingredients.filter((item) => !frame.guessed.has(item.key) && !frame.revealed.has(item.key));
  if (!remaining.length) return;
  remaining.forEach((item) => frame.guessed.add(item.key));
  frame.pendingErrors = 0;
  session.correct += remaining.length;
  stats[session.root.id].correct += remaining.length;
  persist(STATS_KEY, stats);
  flash("good", `Состав отмечен как известный: ${remaining.length}`);
  renderAnswers();
  advanceIfComplete();
}

function continueAfterIngredient() {
  advanceIfComplete();
}

function advanceIfComplete() {
  const frame = currentFrame();
  const total = currentStage().recipe.ingredients.length;
  if (frame.guessed.size + frame.revealed.size < total) return;
  $("#answerInput").disabled = true;
  const activeSession = session;
  setTimeout(() => { if (session === activeSession) completeCurrentStage(); }, 650);
}

function completeCurrentStage() {
  const completedFrame = currentFrame();
  const nestedStages = completedFrame.node.children.flat();
  session.completedStages += 1;
  session.frames.pop();
  session.pendingNodes = [...nestedStages, ...session.pendingNodes];
  const next = session.pendingNodes.shift();
  if (!next) return finishSession();
  session.frames.push(makeFrame(next));
  renderStage();
}

function finishSession() {
  const item = stats[session.root.id];
  item.completed += 1;
  item.lastAt = new Date().toISOString();
  persist(STATS_KEY, stats);
  $("#completeTitle").textContent = session.root.name;
  $("#completeMetrics").innerHTML = `<div><strong>${session.correct}</strong><span>вспомнили</span></div><div><strong>${session.errors}</strong><span>ошибок</span></div><div><strong>${session.totalStages}</strong><span>составов</span></div>`;
  const nextLabel = $("#nextDish span");
  if (practiceMode && practiceQueue.length) nextLabel.textContent = `Следующее блюдо · осталось ${practiceQueue.length}`;
  else if (practiceMode) nextLabel.textContent = "Завершить подборку";
  else nextLabel.textContent = eligibleRecipes().length ? "Следующее блюдо" : "Вернуться в библиотеку";
  showView("complete");
}

function advancePracticeBatch() {
  while (practiceQueue.length) {
    const nextId = practiceQueue.shift();
    const nextRecipe = recipes.find((recipe) => recipe.id === nextId && isDish(recipe) && recipe.ingredients.length);
    if (nextRecipe) {
      startRecipe(nextRecipe, true);
      return;
    }
  }
  practiceMode = null;
  practiceQueue = [];
  showView("library");
}

function renderStats() {
  const entries = recipes.map((recipe) => ({ recipe, data: stats[recipe.id] })).filter((item) => item.data?.attempts);
  const attempts = entries.reduce((sum, item) => sum + item.data.attempts, 0);
  const completed = entries.reduce((sum, item) => sum + item.data.completed, 0);
  const errors = entries.reduce((sum, item) => sum + item.data.errors, 0);
  $("#repeatAllErrors").disabled = !recipes.some((recipe) => isDish(recipe) && recipe.ingredients.length && (stats[recipe.id]?.errors || 0) > 0);
  $("#statsCards").innerHTML = `<div class="stat-card"><span>Тренировок</span><strong>${attempts}</strong></div><div class="stat-card"><span>Завершено</span><strong>${completed}</strong></div><div class="stat-card"><span>Ошибок</span><strong>${errors}</strong></div>`;
  $("#statsEmpty").classList.toggle("hidden", !!entries.length);
  $("#statsTable").innerHTML = entries.sort((a, b) => (b.data.errors || 0) - (a.data.errors || 0)).map(({ recipe, data }) => {
    const total = (data.correct || 0) + (data.errors || 0);
    const score = total ? Math.round(data.correct / total * 100) : 0;
    const hard = Object.entries(data.ingredients || {}).sort((a, b) => b[1] - a[1])[0];
    return `<tr><td>${escapeHtml(recipe.name)}${hard ? `<small style="display:block;color:var(--muted);margin-top:4px">Чаще всего: ${escapeHtml(hard[0])}</small>` : ""}</td><td>${data.attempts}</td><td>${data.errors || 0}</td><td><span class="score"><i style="--score:${score}%"></i>${score}%</span></td><td><button class="table-button" data-recipe="${encodeURIComponent(recipe.id)}">Повторить</button></td></tr>`;
  }).join("");
}

async function loadBundledSample() {
  if (recipes.length) return;
  if (window.Capacitor?.isNativePlatform?.()) return;
  try {
    const filename = "Томаты кимчи с муссом из феты.md";
    const response = await fetch(encodeURI(filename));
    if (!response.ok) return;
    recipes = [parseRecipe({ filename, path: filename, text: await response.text() })];
    persist(LIBRARY_KEY, recipes);
  } catch { /* File uploads still work when index.html is opened without a server. */ }
}

function wireEvents() {
  $$('[data-view]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $("#pickFiles").addEventListener("click", () => $("#fileInput").click());
  $("#pickFolder").addEventListener("click", async () => {
    const nativePicker = window.Capacitor?.Plugins?.FolderPicker;
    if (!nativePicker) {
      $("#folderInput").click();
      return;
    }
    try {
      const result = await nativePicker.pickFolder();
      const files = (result.files || []).map((file) => ({
        name: file.name,
        webkitRelativePath: file.path,
        text: async () => file.text
      }));
      if (files.length) await importFiles(files);
    } catch (error) {
      renderLibrary(`<span class="danger">Не удалось прочитать папку: ${escapeHtml(error?.message || String(error))}</span>`);
    }
  });
  $("#fileInput").addEventListener("change", (event) => importFiles(event.target.files));
  $("#folderInput").addEventListener("change", (event) => importFiles(event.target.files));
  const dropzone = $("#dropzone");
  ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove("dragging"); }));
  dropzone.addEventListener("drop", (event) => importFiles(event.dataTransfer.files));
  $("#recipeSearch").addEventListener("input", renderRecipeList);
  $("#recipeList").addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-select-recipe]");
    if (selectButton) {
      event.preventDefault();
      event.stopPropagation();
      const id = decodeURIComponent(selectButton.dataset.selectRecipe);
      if (selectedRecipeIds.has(id)) selectedRecipeIds.delete(id); else selectedRecipeIds.add(id);
      renderRecipeList();
      return;
    }
    const encodedId = event.target.closest("[data-recipe-id]")?.dataset.recipeId;
    if (encodedId) deleteRecipe(decodeURIComponent(encodedId));
  });
  $("#selectVisibleRecipes").addEventListener("click", () => {
    const query = normalizeAnswer($("#recipeSearch").value || "");
    recipes.filter((recipe) => isDish(recipe) && recipe.ingredients.length && (!query || normalizeAnswer(`${recipe.name} ${recipe.categories.join(" ")} ${flattenIngredients(recipe.ingredients).map((item) => item.name).join(" ")}`).includes(query))).forEach((recipe) => selectedRecipeIds.add(recipe.id));
    renderRecipeList();
  });
  $("#clearRecipeSelection").addEventListener("click", () => { selectedRecipeIds.clear(); renderRecipeList(); });
  $("#startSelected").addEventListener("click", () => startBatch(selectedRecipes(), "selected"));
  $("#categoryFilters").addEventListener("change", updateStartButtons);
  $("#toggleCategories").addEventListener("click", () => {
    const inputs = $$('#categoryFilters input');
    const allSelected = inputs.every((input) => input.checked);
    inputs.forEach((input) => { input.checked = !allSelected; });
    $("#toggleCategories").textContent = allSelected ? "Выбрать все" : "Снять все";
    updateStartButtons();
  });
  $("#showCount").addEventListener("change", (event) => { prefs.showCount = event.target.checked; persist(PREFS_KEY, prefs); });
  $("#countErrors").addEventListener("change", (event) => { prefs.countErrors = event.target.checked; persist(PREFS_KEY, prefs); });
  $("#startRandom").addEventListener("click", () => startBatch(eligibleRecipes(), "categories"));
  $("#startWeak").addEventListener("click", () => startRecipe(selectWeakRecipe(eligibleRecipes(), stats)));
  $("#answerForm").addEventListener("submit", submitAnswer);
  $("#revealAnswer").addEventListener("click", revealOne);
  $("#knowStage").addEventListener("click", knowCurrentStage);
  $("#exitQuiz").addEventListener("click", () => { session = null; practiceMode = null; practiceQueue = []; showView("library"); });
  $("#nextDish").addEventListener("click", () => {
    if (practiceMode) advancePracticeBatch();
    else {
      const available = eligibleRecipes();
      if (available.length) startRecipe(randomItem(available));
      else showView("library");
    }
  });
  $("#repeatAllErrors").addEventListener("click", () => {
    const failed = recipes.filter((recipe) => isDish(recipe) && recipe.ingredients.length && (stats[recipe.id]?.errors || 0) > 0).sort((a, b) => stats[b.id].errors - stats[a.id].errors);
    startBatch(failed, "errors");
  });
  $("#statsTable").addEventListener("click", (event) => { const id = event.target.dataset.recipe; if (id) startRecipe(recipes.find((r) => r.id === decodeURIComponent(id))); });
  $("#clearLibrary").addEventListener("click", () => { if (confirm("Удалить все загруженные рецепты из браузера?")) { recipes = []; persist(LIBRARY_KEY, recipes); renderLibrary(); } });
  $("#resetStats").addEventListener("click", () => { if (confirm("Сбросить всю статистику тренировок?")) { stats = {}; persist(STATS_KEY, stats); renderStats(); updateStartButtons(); } });
  $("#themeToggle").addEventListener("click", () => { prefs.dark = !prefs.dark; document.body.classList.toggle("dark", prefs.dark); persist(PREFS_KEY, prefs); });
}

await loadBundledSample();
document.body.classList.toggle("dark", prefs.dark);
$("#showCount").checked = prefs.showCount;
$("#countErrors").checked = prefs.countErrors;
wireEvents();
renderLibrary();
