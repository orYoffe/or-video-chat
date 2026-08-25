import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)), "public");
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function isInsideRoot(filePath) {
  return filePath === root || filePath.startsWith(`${root}${sep}`);
}

const server = createServer(async (request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (requestPath.startsWith("/__")) {
    response.writeHead(404);
    response.end();
    return;
  }

  const requestedFile = normalize(join(root, decodeURIComponent(requestPath)));
  const filePath = isInsideRoot(requestedFile) ? requestedFile : join(root, "index.html");

  let resolvedPath = filePath;
  try {
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      resolvedPath = join(root, "index.html");
    }
  } catch {
    resolvedPath = join(root, "index.html");
  }

  try {
    const body = await readFile(resolvedPath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(resolvedPath)] || "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end("Unable to serve the test app");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving public/ at http://127.0.0.1:${port}`);
});
