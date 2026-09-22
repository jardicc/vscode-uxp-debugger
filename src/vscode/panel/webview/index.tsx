import "@vscode/codicons/dist/codicon.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (container) {
    createRoot(container).render(<App />);
}
