// Renderer build orchestrator, run via `npm run renderer:build` /
// `npm run renderer:watch` (see package.json). It does not compile TypeScript
// itself — it writes a throwaway rspack config + renderer/index.html into the
// `renderer/` output folder, then shells out to `npx rspack` to actually
// bundle source/apps/abstractNode/src/app.ts into renderer/main.mjs.
// Electron's main process (source/main.ts) loads renderer/index.html directly.
import fsPromise from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

type AbstractNodeMode = "build" | "watch";

interface AbstractNodeBuildOptions {
  mode?: AbstractNodeMode;
}

class AbstractNodeBuilder {
  public rootFolder: string;
  public rendererFolder: string;
  public frameworkSourceFolder: string;
  public appEntryPath: string;
  public rendererEntryPath: string;
  public rendererHtmlPath: string;
  public rspackConfigPath: string;

  constructor() {
    this.rootFolder = process.cwd();
    this.rendererFolder = path.join(this.rootFolder, "renderer");
    this.frameworkSourceFolder = path.join(this.rootFolder, "source", "apps", "abstractNode", "src");
    this.appEntryPath = path.join(this.frameworkSourceFolder, "app.ts");
    this.rendererEntryPath = path.join(this.rendererFolder, "main.mjs");
    this.rendererHtmlPath = path.join(this.rendererFolder, "index.html");
    this.rspackConfigPath = path.join(this.frameworkSourceFolder, "rspack.config.mjs");
  }

  // Regenerated on every build so the CSP/meta tags here stay the single
  // source of truth rather than a hand-maintained HTML file drifting from it.
  public ensureRendererHtml = async (): Promise<void> => {
    await fsPromise.mkdir(this.rendererFolder, { recursive: true });
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';">
  <title>EpubChecker</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.mjs"></script>
</body>
</html>
`;
    await fsPromise.writeFile(this.rendererHtmlPath, html, "utf8");
  };

  // Written out fresh each run instead of committed as a static file, so the
  // entry/output paths always match the current checkout location.
  public ensureRspackConfig = async (): Promise<void> => {
    const entry = this.appEntryPath.replace(/\\/g, "\\\\");
    const outputPath = this.rendererFolder.replace(/\\/g, "\\\\");
    const config = `import path from "path";

export default {
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
  target: "web",
  entry: {
    main: "${entry}",
  },
  output: {
    path: "${outputPath}",
    filename: "main.mjs",
    chunkFilename: "[name].mjs",
    module: true,
    clean: false,
  },
  experiments: {
    outputModule: true,
  },
  resolve: {
    extensions: [".ts", ".js", ".mjs"],
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  module: {
    rules: [
      {
        test: /\\.ts$/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
            },
            target: "es2022",
          },
        },
        type: "javascript/auto",
      },
    ],
  },
  optimization: {
    minimize: process.env.NODE_ENV === "production",
  },
  devtool: process.env.NODE_ENV === "production" ? false : "source-map",
};
`;
    await fsPromise.writeFile(this.rspackConfigPath, config, "utf8");
  };

  public runRspack = async (mode: AbstractNodeMode): Promise<void> => {
    // Resolve rspack's actual JS entry point and run it via `node` directly
    // rather than shelling out to `npx`/`npx.cmd`. Spawning `.cmd` shims
    // without `shell: true` throws `spawn EINVAL` on Windows (Node.js
    // enforces this since the child_process security fix in 18.20.2/20.12.2),
    // and invoking `node <script.js>` sidesteps the shim entirely on every OS.
    // "@rspack/cli"'s package.json "exports" map only exposes "." and
    // "./package.json" — resolving "./bin/rspack.js" directly throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the (exported) package.json
    // instead and derive the bin path from its own "bin" field.
    const rspackPkgPath = require.resolve("@rspack/cli/package.json", { paths: [this.rootFolder] });
    const rspackPkg = require(rspackPkgPath) as { bin?: Record<string, string> };
    const rspackBin = path.join(path.dirname(rspackPkgPath), rspackPkg.bin?.rspack ?? "bin/rspack.js");
    const args = [rspackBin, mode === "watch" ? "watch" : "build", "--config", this.rspackConfigPath];

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: this.rootFolder,
        env: process.env,
        stdio: "inherit",
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`rspack exited with code ${code}`));
        }
      });
    });
  };

  public build = async (options: AbstractNodeBuildOptions = {}): Promise<void> => {
    const mode = options.mode ?? "build";
    await this.ensureRendererHtml();
    await this.ensureRspackConfig();
    await this.runRspack(mode);
  };
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const mode: AbstractNodeMode = process.argv.includes("watch") ? "watch" : "build";
  const builder = new AbstractNodeBuilder();
  builder.build({ mode }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { AbstractNodeBuilder };
