import "./zhihu/native-fetch";
import * as vscode from "vscode";
import { importFromSetting, initCookieStore } from "./cookieStore";
import { DecodeViewProvider } from "./decodeView";
import { RecommendViewProvider } from "./recommendView";
import { setNotoCacheDir } from "./zhihu/outline";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await initCookieStore(context);
  setNotoCacheDir(context.globalStorageUri.fsPath);

  const recommend = new RecommendViewProvider(context);
  const decode = new DecodeViewProvider(context);
  recommend.setDecodeOpener((url) => decode.openAndDecode(url));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RecommendViewProvider.viewType, recommend, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(DecodeViewProvider.viewType, decode, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("zhihu.backRecommend", () => recommend.goBack()),
    vscode.commands.registerCommand("zhihu.refreshRecommend", () => recommend.refresh()),
    vscode.commands.registerCommand("zhihu.openInEditor", () => recommend.openInEditor()),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("zhihu.cookie")) {
        if (await importFromSetting()) recommend.refresh();
        return;
      }
      // Page size only affects the next load, so no need to reset the list.
      if (
        e.affectsConfiguration("zhihu.recommendPageSize") ||
        e.affectsConfiguration("zhihu.otherAnswersPageSize")
      ) {
        recommend.notifyPageSizeChanged();
      }
    }),
  );
}

export function deactivate(): void {}
