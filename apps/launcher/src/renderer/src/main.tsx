import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

async function bootstrap(): Promise<void> {
  if (
    !window.lapis &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
    window.location.port === "5173"
  ) {
    const { installBrowserDevBridge } = await import("./dev-browser.js");
    installBrowserDevBridge();
  }
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}

void bootstrap();
