import * as vscode from "vscode";
import {
  clearLoginCookie,
  getLoginStatus,
  getQuestionOtherAnswers,
  getRecommendDetail,
  getRecommendations,
  reportRecommendOpen,
  saveLoginCookie,
} from "./api";
import { QrLogin } from "./zhihu/qr-login";
import { DetailPanel } from "./detailPanel";
import { getWebviewHtml } from "./html";
import {
  isAnswerType,
  type OtherAnswerItem,
  type RecommendDetail,
  type RecommendItem,
} from "./types";

export class RecommendViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "zhihu.recommend";

  private view?: vscode.WebviewView;
  private items: RecommendItem[] = [];
  private articleHtml = new Map<string, string>();
  private nextUrl: string | null = null;
  private selected?: RecommendItem;
  private detail?: RecommendDetail;
  private detailStack: Array<{
    item: RecommendItem;
    detail: RecommendDetail;
    otherAnswers: OtherAnswerItem[];
    otherAnswersNext: string | null;
    showOtherAnswers: boolean;
  }> = [];
  private otherAnswersNext: string | null = null;
  private otherAnswersCache: OtherAnswerItem[] = [];
  private showOtherAnswers = false;
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
    this.detailStack = [];
    this.otherAnswersNext = null;
    this.otherAnswersCache = [];
    this.showOtherAnswers = false;
    this.post({ type: "showList" });
  }

  /** Back from nested other-answer detail, or to the recommend list. */
  goBack(): void {
    const prev = this.detailStack.pop();
    if (!prev) {
      this.showList();
      return;
    }
    this.selected = prev.item;
    this.detail = prev.detail;
    this.otherAnswersCache = prev.otherAnswers.slice();
    this.otherAnswersNext = prev.otherAnswersNext;
    this.showOtherAnswers = prev.showOtherAnswers;
    // Old page DOM stays mounted; just pop the top layer.
    this.post({
      type: "popDetail",
      hasMore: !!prev.otherAnswersNext,
      showOtherAnswers: prev.showOtherAnswers,
    });
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
          this.detailStack = [];
          await this.openItem(String(msg.id), String(msg.itemType ?? ""), false);
          break;
        case "loadOtherAnswers":
          await this.loadOtherAnswers(!!msg.append);
          break;
        case "openOtherAnswer":
          await this.openOtherAnswer(String(msg.id ?? ""));
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
      this.post({ type: "error", message, request: msg.type });
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

  private async openItem(id: string, type: string, pushCurrent: boolean): Promise<void> {
    const fromList = this.items.find((it) => String(it.id) === id && (!type || it.type === type));
    const fromOther = this.otherAnswersCache.find((it) => String(it.id) === id);
    if (!fromList && !fromOther) {
      throw new Error("未找到该推荐条目");
    }
    const recommendItem: RecommendItem = fromList
      ? { ...fromList }
      : {
          type: fromOther!.type || "回答",
          id: fromOther!.id,
          question_id: fromOther!.question_id,
          title: fromOther!.title,
          author: fromOther!.author,
          voteup: fromOther!.voteup,
          comments: fromOther!.comments,
          excerpt: fromOther!.excerpt,
          url: fromOther!.url,
          created_time: fromOther!.created_time,
        };
    if (pushCurrent && this.selected && this.detail) {
      this.detailStack.push({
        item: this.selected,
        detail: this.detail,
        otherAnswers: this.otherAnswersCache.slice(),
        otherAnswersNext: this.otherAnswersNext,
        showOtherAnswers: this.showOtherAnswers,
      });
    }
    this.selected = recommendItem;
    this.detail = undefined;
    // Nested "other answer" pages should not show another other-answers list.
    this.showOtherAnswers =
      !pushCurrent && isAnswerType(recommendItem.type) && recommendItem.question_id != null;
    this.otherAnswersNext = null;
    this.otherAnswersCache = [];
    this.post({ type: "detailLoading", item: recommendItem, push: pushCurrent });
    // Match website: touch first, then read. Do not block detail loading.
    void reportRecommendOpen(recommendItem.id, recommendItem.type);
    const detail = await getRecommendDetail(recommendItem.id, recommendItem.type, {
      title: recommendItem.title,
      author: recommendItem.author,
      html: this.articleHtml.get(String(recommendItem.id)),
    });
    this.detail = detail;
    this.post({
      type: "detailResult",
      item: recommendItem,
      detail,
      canComment: isAnswerType(recommendItem.type),
      showOtherAnswers: this.showOtherAnswers,
      push: pushCurrent,
    });
  }

  private async loadOtherAnswers(append: boolean): Promise<void> {
    const item = this.selected;
    if (!this.showOtherAnswers || !item || !isAnswerType(item.type) || item.question_id == null) {
      this.post({ type: "otherAnswersResult", data: [], hasMore: false, append: false });
      return;
    }
    if (append && !this.otherAnswersNext) {
      this.post({ type: "otherAnswersResult", data: [], hasMore: false, append: true });
      return;
    }
    this.post({ type: "otherAnswersLoading", append });
    const page = await getQuestionOtherAnswers(item.question_id, {
      excludeAnswerId: item.id,
      nextUrl: append ? this.otherAnswersNext : null,
    });
    this.otherAnswersNext = page.next;
    this.otherAnswersCache = append ? this.otherAnswersCache.concat(page.data) : page.data.slice();
    this.post({
      type: "otherAnswersResult",
      data: page.data,
      hasMore: !!page.next,
      append,
    });
  }

  private async openOtherAnswer(id: string): Promise<void> {
    if (!id) return;
    if (this.selected && String(this.selected.id) === id) return;
    const cached = this.otherAnswersCache.find((it) => String(it.id) === id);
    if (!cached) {
      throw new Error("未找到该回答");
    }
    await this.openItem(id, cached.type || "回答", true);
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
