import * as vscode from "vscode";
import { getLoginStatus, getRecommendDetail, getRecommendLimit, getRecommendations } from "./api";
import { DetailPanel } from "./detailPanel";
import { getWebviewHtml } from "./html";
import { isAnswerType, type RecommendDetail, type RecommendItem } from "./types";

export class RecommendViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zhihu.recommend";

  private view?: vscode.WebviewView;
  private items: RecommendItem[] = [];
  private selected?: RecommendItem;
  private detail?: RecommendDetail;
  private limit = getRecommendLimit();

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
    this.limit = getRecommendLimit();
    void this.loadList(true);
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

  private async handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          await this.loadList(true);
          break;
        case "refresh":
          this.limit = getRecommendLimit();
          await this.loadList(true);
          break;
        case "loadMore":
          this.limit = Math.min(20, this.limit + getRecommendLimit());
          await this.loadList(false);
          break;
        case "openItem":
          await this.openItem(String(msg.id), String(msg.itemType ?? ""));
          break;
        case "openInEditor":
          this.openInEditor();
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

  private async loadList(reset: boolean): Promise<void> {
    this.post({ type: "listLoading", reset });
    try {
      const status = await getLoginStatus();
      if (!status.logged_in) {
        this.items = [];
        this.post({
          type: "listResult",
          data: [],
          hasMore: false,
          status,
        });
        return;
      }
      const result = await getRecommendations(this.limit);
      this.items = result.data ?? [];
      this.post({
        type: "listResult",
        data: this.items,
        hasMore: this.items.length >= this.limit && this.limit < 20,
        status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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
    const detail = await getRecommendDetail(item.id, item.type);
    this.detail = detail;
    this.post({
      type: "detailResult",
      item,
      detail,
      canComment: isAnswerType(item.type),
    });
  }
}

const recommendBody = `
<div id="app">
  <section id="list-page">
    <div id="list"></div>
    <div id="list-loading" class="loading hidden">加载中...</div>
    <button id="btn-more" class="icon-btn icon-btn-block hidden" type="button" data-icon="more" title="加载更多" aria-label="加载更多"></button>
  </section>
  <section id="detail-page" class="hidden">
    <div class="toolbar sticky">
      <button id="btn-back" class="icon-btn" type="button" data-icon="back" title="返回" aria-label="返回"></button>
      <button id="btn-editor" class="icon-btn" type="button" data-icon="editor" title="在编辑器打开" aria-label="在编辑器打开" disabled></button>
    </div>
    <div id="detail"></div>
  </section>
</div>
`;
