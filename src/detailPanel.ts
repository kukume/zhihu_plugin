import * as vscode from "vscode";
import { getChildComments, getComments } from "./api";
import { getWebviewHtml } from "./html";
import { isAnswerType, type RecommendDetail, type RecommendItem } from "./types";

export class DetailPanel {
  private static instance?: DetailPanel;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(
    extensionUri: vscode.Uri,
    item: RecommendItem,
    detail: RecommendDetail,
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (DetailPanel.instance) {
      DetailPanel.instance.panel.reveal(column, true);
      DetailPanel.instance.setContent(item, detail);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "zhihu.detail",
      detail.title || "知乎详情",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );
    DetailPanel.instance = new DetailPanel(panel, extensionUri, item, detail);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private item: RecommendItem,
    private detail: RecommendDetail,
  ) {
    this.panel = panel;
    this.panel.webview.html = getWebviewHtml({
      webview: panel.webview,
      extensionUri,
      title: "知乎详情",
      scripts: ["detail.js"],
      body: detailBody,
    });
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        void this.handleMessage(msg);
      },
      null,
      this.disposables,
    );
  }

  private setContent(item: RecommendItem, detail: RecommendDetail): void {
    this.item = item;
    this.detail = detail;
    this.panel.title = detail.title || item.title || "知乎详情";
    this.post({
      type: "init",
      item,
      detail,
      canComment: isAnswerType(item.type),
    });
  }

  private post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }

  private async handleMessage(msg: {
    type: string;
    offset?: string;
    append?: boolean;
    commentId?: string | number;
    url?: string;
  }): Promise<void> {
    try {
      switch (msg.type) {
        case "ready":
          this.setContent(this.item, this.detail);
          break;
        case "loadComments":
          await this.loadComments(msg.offset ?? "", !!msg.append);
          break;
        case "loadChildComments":
          if (msg.commentId == null) {
            return;
          }
          await this.loadChildComments(msg.commentId, msg.offset ?? "");
          break;
        case "openUrl":
          if (msg.url) {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: "error", message });
    }
  }

  private async loadComments(offset: string, append: boolean): Promise<void> {
    this.post({ type: "commentsLoading" });
    const data = await getComments(this.item.id, 20, offset);
    this.post({ type: "commentsResult", data, append });
  }

  private async loadChildComments(commentId: string | number, offset: string): Promise<void> {
    this.post({ type: "commentsLoading" });
    const data = await getChildComments(commentId, 20, offset);
    this.post({ type: "childCommentsResult", data, commentId });
  }

  private dispose(): void {
    DetailPanel.instance = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

const detailBody = `
<div id="app" class="detail-app">
  <div id="article"></div>
  <div class="divider"></div>
  <section id="comments-section">
    <div class="comments-header">
      <h3>评论</h3>
      <button id="btn-refresh-comments" class="icon-btn" type="button" data-icon="refresh" title="刷新评论" aria-label="刷新评论"></button>
    </div>
    <div id="comments-list"></div>
    <div id="comments-pager"></div>
    <div id="comments-loading" class="loading hidden">加载评论...</div>
  </section>
</div>
`;
