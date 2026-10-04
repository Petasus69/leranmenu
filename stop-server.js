import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const stateFile = join(process.cwd(), ".lernmenu-server.json");

try {
  const { port, token } = JSON.parse(await readFile(stateFile, "utf8"));
  const response = await fetch(`http://127.0.0.1:${port}/__lernmenu_stop`, {
    method: "POST",
    headers: { "x-lernmenu-token": token }
  });
  if (!response.ok) throw new Error("Сервер не подтвердил остановку");
  console.log(`Сервер Lernmenu на порту ${port} остановлен.`);
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("Сервер Lernmenu не запущен.");
  } else {
    console.error(`Не удалось остановить сервер: ${error.message}`);
    try { await unlink(stateFile); } catch { /* Нечего очищать. */ }
    process.exitCode = 1;
  }
}
