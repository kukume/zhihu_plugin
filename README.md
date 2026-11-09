# 知乎 VS Code 插件

浏览知乎推荐、解码盐选。无需浏览器。

## 环境要求

VS Code **1.123.0** 或更高版本。

## 登录

打开侧栏的 **知乎** 图标，未登录时点 **扫码登录**，用知乎 App 扫一扫并在手机上确认即可。

也可以手动粘贴 Cookie：在设置里填写 `zhihu.cookie`，扩展会把它导入加密存储并自动清空该设置项。

## 安装插件

**方式一：扩展市场（推荐）**

在 VS Code / Cursor 的扩展视图搜索 **zhihu**，或直接打开 [Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=kukume.zhihu) 点击 Install。

**方式二：从 VSIX 安装**

1. 打开本仓库的 [Releases](https://github.com/kukume/zhihu_plugin/releases/latest)，下载 `zhihu.vsix`。
2. 在 VS Code / Cursor 中：扩展视图 → `...` → **Install from VSIX...**（从 VSIX 安装），选刚下载的文件。

命令行也可以：

```bash
code --install-extension zhihu.vsix
```

## 本地开发

```bash
npm install
npm run compile
```

用 VS Code 打开本目录，按 `F5` 启动扩展开发宿主。

本地打包：

```bash
npm run package
```

## 许可证

[GNU General Public License v3.0](LICENSE)
