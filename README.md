# 知乎 VS Code / Cursor 插件

侧栏浏览知乎推荐、解码盐选。

## 1. 配置

安装插件后，打开设置，搜索 **知乎**，填写：

| 配置项 | 说明 |
| --- | --- |
| `zhihu.cookie` | 知乎 Cookie（从浏览器复制登录后的 Cookie 头，需包含 `z_c0`）。 |


## 2. 安装插件

1. 打开本仓库的 [Releases](https://github.com/kukume/zhihu_plugin/releases/latest)，下载 `zhihu.vsix`。
2. 在 VS Code / Cursor 中：扩展视图 → `...` → **Install from VSIX...**（从 VSIX 安装），选刚下载的文件。

命令行也可以：

```bash
code --install-extension zhihu.vsix
```

Cursor 同理，把 `code` 换成 `cursor`。

## 本地开发

```bash
npm install
npm run compile
```

用 VS Code / Cursor 打开本目录，按 `F5` 启动扩展开发宿主。

本地打包：

```bash
npm run package
```
