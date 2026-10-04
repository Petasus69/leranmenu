import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { unlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const stateFile = join(root, ".lernmenu-server.json");
const shutdownToken = randomUUID();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (req.method === "POST" && pathname === "/__lernmenu_stop") {
      if (req.headers["x-lernmenu-token"] !== shutdownToken) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Stopping");
      setImmediate(() => server.close(() => process.exit(0)));
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const path = normalize(join(root, relative));
    if (!path.startsWith(root)) throw new Error("Forbidden");
    const info = await stat(path);
    const finalPath = info.isDirectory() ? join(path, "index.html") : path;
    res.writeHead(200, { "Content-Type": types[extname(finalPath)] || "application/octet-stream" });
    res.end(await readFile(finalPath));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Порт ${port} уже занят. Приложение, вероятно, уже запущено: http://127.0.0.1:${port}`);
    console.error("Чтобы остановить сервер этого проекта, выполните в другом терминале: npm stop");
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  writeFileSync(stateFile, JSON.stringify({ port, token: shutdownToken }), "utf8");
  console.log(`Lernmenu: http://127.0.0.1:${port}`);
  console.log("Для остановки нажмите Ctrl+C или выполните npm stop в другом терминале.");
});

function cleanup() {
  try { unlinkSync(stateFile); } catch { /* Файл уже удалён или не был создан. */ }
}

process.on("exit", cleanup);
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
