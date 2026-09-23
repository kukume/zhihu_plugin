import * as vscode from "vscode";
import {
  clearLoginCookie,
  getLoginStatus,
  getRecommendDetail,
  getRecommendations,
  reportRecommendOpen,
  saveLoginCookie,
} from "./api";
import { QrLogin } from "./zhihu/qr-login";
import { DetailPanel } from "./detailPanel";
import { getWebviewHtml } from "./html";
import { isAnswerType, type RecommendDetail, type RecommendItem } from "./types";

export class RecommendViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zhihu.recommend";

  private view?: vscode.WebviewView;
  private items: RecommendItem[] = [];
  private articleHtml = new Map<string, string>();
  private nextUrl: string | null = null;
  private selected?: RecommendItem;
  private detail?: RecommendDetail;
  private qr?: QrLogin;
  private qrTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = getWebviewHtml({
      webview: webviewView.webview,
      extensionUri: this.context.extensionUri,
      title: "知乎推荐",
      scripts: ["recommend.js"],
      body: recommendBody,
    });
    webviewView.webview.onDidReceiveMessage((msg) => {
      void this.handleMessage(msg);
    });
  }

  refresh(): void {
    void this.loadList(true);
  }

  showList(): void {
    this.post({ type: "showList" });
  }

  openInEditor(): void {
    if (!this.selected || !this.detail) {
      vscode.window.showInformationMessage("请先在推荐列表中打开一条内容");
      return;
    }
    DetailPanel.createOrShow(this.context.extensionUri, this.selected, this.detail);
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private rememberArticles(items: RecommendItem[]): RecommendItem[] {
    return items.map((item) => {
      if ((item.type === "文章" || item.type === "article") && item.content?.includes("<")) {
        this.articleHtml.set(String(item.id), item.content);
        return { ...item, content: undefined };
      }
      return item;
    });
  }

  private async handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          await this.loadList(true);
          break;
        case "refresh":
          await this.loadList(true);
          break;
        case "loadMore":
          await this.loadList(false);
          break;
        case "startQrLogin":
          await this.startQrLogin();
          break;
        case "cancelQrLogin":
          this.stopQr();
          break;
        case "openItem":
          await this.openItem(String(msg.id), String(msg.itemType ?? ""));
          break;
        case "openInEditor":
          this.openInEditor();
          break;
        case "viewMode":
          await vscode.commands.executeCommand("setContext", "zhihu.recommendDetail", !!msg.detail);
          break;
        case "openUrl":
          if (typeof msg.url === "string") {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
    }
  }

  private stopQr(): void {
    if (this.qrTimer) clearInterval(this.qrTimer);
    this.qrTimer = undefined;
    this.qr = undefined;
  }

  private async startQrLogin(): Promise<void> {
    this.stopQr();
    const qr = new QrLogin();
    this.qr = qr;
    const started = await qr.start();
    if (this.qr !== qr) return;
    this.post({ type: "qrLogin", image: started.image, message: started.message });
    this.qrTimer = setInterval(() => void this.pollQr(), 1500);
  }

  private async pollQr(): Promise<void> {
    const qr = this.qr;
    if (!qr) return;
    const result = await qr.poll();
    if (this.qr !== qr) return;
    if (result.phase === "success") {
      this.stopQr();
      await saveLoginCookie(result.cookie);
      await this.loadList(true);
      return;
    }
    if (result.phase === "done") {
      this.stopQr();
      this.post({ type: "qrStatus", message: result.message, failed: true });
      return;
    }
    this.post({ type: "qrStatus", message: result.message });
  }

  private async loadList(reset: boolean): Promise<void> {
    if (reset) this.stopQr();
    this.post({ type: "listLoading", reset });
    try {
      const status = await getLoginStatus();
      if (!status.logged_in) {
        this.items = [];
        this.nextUrl = null;
        this.post({
          type: "listResult",
          data: [],
          hasMore: false,
          status,
        });
        return;
      }
      if (!reset && !this.nextUrl) {
        this.post({
          type: "listResult",
          data: this.items,
          hasMore: false,
          status,
        });
        return;
      }
      const result = await getRecommendations(reset ? null : this.nextUrl);
      const incoming = this.rememberArticles(result.data ?? []);
      this.items = reset ? incoming : appendRecommendations(this.items, incoming);
      this.nextUrl = result.next;
      this.post({
        type: "listResult",
        data: this.items,
        hasMore: Boolean(this.nextUrl),
        status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "登录已失效") {
        await clearLoginCookie();
        this.items = [];
        this.nextUrl = null;
        this.post({
          type: "listResult",
          data: [],
          hasMore: false,
          status: { logged_in: false, message: "登录已失效" },
        });
        return;
      }
      this.post({ type: "error", message });
    }
  }

  private async openItem(id: string, type: string): Promise<void> {
    const item = this.items.find((it) => String(it.id) === id && (!type || it.type === type));
    if (!item) {
      throw new Error("未找到该推荐条目");
    }
    this.selected = item;
    this.detail = undefined;
    this.post({ type: "detailLoading", item });
    // Match website: touch first, then read. Do not block detail loading.
    void reportRecommendOpen(item.id, item.type);
    const detail = await getRecommendDetail(item.id, item.type, {
      title: item.title,
      author: item.author,
      html: this.articleHtml.get(String(item.id)),
    });
    this.detail = detail;
    this.post({
      type: "detailResult",
      item,
      detail,
      canComment: isAnswerType(item.type),
    });
  }
}

function recommendationKey(item: RecommendItem): string {
  return [item.type, item.id ?? "", item.url ?? "", item.title ?? ""].join(":");
}

function appendRecommendations(current: RecommendItem[], incoming: RecommendItem[]): RecommendItem[] {
  const seen = new Set(current.map(recommendationKey));
  const next = current.slice();
  for (const item of incoming) {
    const key = recommendationKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

const recommendBody = `
<div id="app" class="recommend-app">
  <section id="list-page">
    <div id="list"></div>
    <div id="list-loading" class="loading hidden">加载中...</div>
  </section>
  <section id="detail-page" class="pane-back">
    <div id="detail"></div>
  </section>
</div>
`;
