import * as vscode from "vscode";
import { decodeUrl } from "./api";
import { getWebviewHtml } from "./html";

export class DecodeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zhihu.decode";

  private view?: vscode.WebviewView;
  private ready = false;
  private pendingUrl?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Show the Decode view and start decoding this Zhihu URL. */
  openAndDecode(url: string): void {
    const trimmed = url.trim();
    if (!trimmed) return;
    this.pendingUrl = trimmed;
    void vscode.commands.executeCommand("zhihu.decode.focus");
    this.flushPending();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = getWebviewHtml({
      webview: webviewView.webview,
      extensionUri: this.context.extensionUri,
      title: "Decode",
      scripts: ["decode.js"],
      body: decodeBody,
    });
    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg);
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private flushPending(): void {
    if (!this.ready || !this.view || !this.pendingUrl) return;
    const url = this.pendingUrl;
    this.pendingUrl = undefined;
    this.post({ type: "startDecode", url });
  }

  private async handleMessage(msg: { type: string; url?: string }): Promise<void> {
    if (msg.type === "ready") {
      this.ready = true;
      this.flushPending();
      return;
    }
    if (msg.type !== "decode") {
      return;
    }
    const url = (msg.url ?? "").trim();
    if (!url) {
      this.post({ type: "error", message: "请输入盐选链接" });
      return;
    }
    this.post({ type: "decodeLoading", loading: true });
    try {
      const data = await decodeUrl(url);
      this.post({ type: "decodeResult", data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
    } finally {
      this.post({ type: "decodeLoading", loading: false });
    }
  }
}

const decodeBody = `
<div id="app" class="decode-app">
  <div class="decode-input">
    <input id="url" type="text" placeholder="粘贴知乎盐选 / 付费专栏链接" />
    <button id="btn-decode" class="icon-btn" type="button" data-icon="decode" title="解码" aria-label="解码"></button>
  </div>
  <div id="loading" class="loading hidden">解码中，可能需要数十秒...</div>
  <div id="result"></div>
</div>
`;
