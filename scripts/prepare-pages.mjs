import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const siteDir = path.join(root, "site");
const distDir = path.join(root, "dist");
const assetsDir = path.join(root, "assets");

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(path.join(distDir, "manifest.json")))) {
  throw new Error("Webpack manifest is missing. Run the production build first.");
}

const manifest = JSON.parse(
  await fs.readFile(path.join(distDir, "manifest.json"), "utf8")
);

const bundle = manifest["main.js"];
if (typeof bundle !== "string" || bundle.length === 0) {
  throw new Error('Could not find the "main.js" entry in dist/manifest.json.');
}

await fs.rm(siteDir, { recursive: true, force: true });
await fs.mkdir(siteDir, { recursive: true });

// Copy the built JavaScript and all app assets into the Pages output.
await fs.cp(distDir, path.join(siteDir, "dist"), { recursive: true });
await fs.cp(assetsDir, path.join(siteDir, "assets"), { recursive: true });

// Convert the PHP template into a static HTML entry point.
// The only PHP expression in this template selects the hashed Webpack bundle.
let html = await fs.readFile(path.join(root, "index.php"), "utf8");
html = html.replace(/^<\?php[\s\S]*?\?>\s*/, "");

const relativeBundle = "./" + bundle.replace(/^\/+/, "");
const phpBundleExpression = /<\?=\s*getAssetPath\(["']main\.js["']\)\s*\?>/;
if (!phpBundleExpression.test(html)) {
  throw new Error("Could not locate the PHP bundle reference in index.php.");
}
html = html.replace(phpBundleExpression, relativeBundle);

// Project Pages sites live below /<repository-name>/, not at the domain root.
// Convert root-relative asset URLs to paths relative to the published site.
html = html.replaceAll("/assets/", "./assets/");

await fs.writeFile(path.join(siteDir, "index.html"), html, "utf8");

// Rewrite absolute asset references embedded in the compiled TypeScript bundle.
async function rewriteJavaScript(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteJavaScript(filePath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const contents = await fs.readFile(filePath, "utf8");
      await fs.writeFile(filePath, contents.replaceAll("/assets/", "./assets/"), "utf8");
    }
  }
}
await rewriteJavaScript(path.join(siteDir, "dist"));

// CSS is served from assets/css/, so font URLs are relative to that folder.
const cssPath = path.join(siteDir, "assets", "css", "style.css");
if (await exists(cssPath)) {
  const css = await fs.readFile(cssPath, "utf8");
  await fs.writeFile(
    cssPath,
    css.replaceAll("/assets/font/", "../font/"),
    "utf8"
  );
}

// Prevent GitHub Pages from trying to process the generated site with Jekyll.
await fs.writeFile(path.join(siteDir, ".nojekyll"), "", "utf8");

// Fail early if the generated entry point references a bundle that was not copied.
const publishedBundle = path.join(siteDir, relativeBundle.replace(/^\.\//, ""));
if (!(await exists(publishedBundle))) {
  throw new Error(`The compiled bundle was not copied to the site: ${relativeBundle}`);
}

console.log("GitHub Pages static site prepared successfully.");
console.log(`Published bundle: ${relativeBundle}`);
