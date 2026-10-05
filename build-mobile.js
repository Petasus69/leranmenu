import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const output = join(root, "www");
const webFiles = ["index.html", "styles.css", "app.js", "recipe-core.js"];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(webFiles.map((filename) => cp(join(root, filename), join(output, filename))));
console.log("Мобильная оболочка подготовлена. База меню выбирается пользователем на устройстве.");
