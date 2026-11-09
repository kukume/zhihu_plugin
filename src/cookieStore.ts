import * as vscode from "vscode";

const SECRET_KEY = "zhihu.cookie";
const SETTING = "cookie";

let secrets: vscode.SecretStorage | undefined;
let cached = "";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("zhihu");
}

async function clearSetting(target: vscode.ConfigurationTarget): Promise<void> {
  try {
    await config().update(SETTING, undefined, target);
  } catch {
    // Target may not exist (e.g. no workspace folder open).
  }
}

/**
 * Load the cookie from SecretStorage. A value left in settings.json is imported
 * once and then removed, so a login cookie never sits in a committable file.
 */
export async function initCookieStore(context: vscode.ExtensionContext): Promise<void> {
  secrets = context.secrets;
  cached = (await context.secrets.get(SECRET_KEY)) ?? "";
  await importFromSetting();
}

/** Import a manually pasted `zhihu.cookie` setting, then clear it. */
export async function importFromSetting(): Promise<boolean> {
  const legacy = (config().get<string>(SETTING) ?? "").trim();
  if (!legacy) return false;

  cached = legacy;
  if (secrets) await secrets.store(SECRET_KEY, legacy);
  await clearSetting(vscode.ConfigurationTarget.Global);
  await clearSetting(vscode.ConfigurationTarget.Workspace);
  await clearSetting(vscode.ConfigurationTarget.WorkspaceFolder);
  return true;
}

export function getCookie(): string {
  return cached;
}

export async function setCookie(cookie: string): Promise<void> {
  cached = cookie;
  if (!secrets) return;
  if (cookie) await secrets.store(SECRET_KEY, cookie);
  else await secrets.delete(SECRET_KEY);
}
