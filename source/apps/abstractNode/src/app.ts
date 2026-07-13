// Renderer boot entry. Bundled as renderer/main.mjs and loaded by index.html.
// The only job here is: find the app mount point, hand it to AppController,
// and let AppController own everything else (layout, state, IPC).
import { AppController } from "./ui/appController.js";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app not found");
}

const app = new AppController(root);
app.launch();
