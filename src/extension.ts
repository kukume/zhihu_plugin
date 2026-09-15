import * as vscode from "vscode";
import { DecodeViewProvider } from "./decodeView";
import { RecommendViewProvider } from "./recommendView";

export function activate(context: vscode.ExtensionContext): void {
  const recommend = new RecommendViewProvider(context);
  const decode = new DecodeViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RecommendViewProvider.viewType, recommend, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(DecodeViewProvider.viewType, decode, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("zhihu.refreshRecommend", () => recommend.refresh()),
    vscode.commands.registerCommand("zhihu.openInEditor", () => recommend.openInEditor()),
  );
}

export function deactivate(): void {}
