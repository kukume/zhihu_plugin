# 知乎 VS Code / Cursor 插件

侧栏浏览知乎推荐、解码盐选。

## 1. 后端

本插件依赖 [kukume/zhihu](https://github.com/kukume/zhihu) 的 HTTP API，需要先自行部署该后端。

## 2. 配置地址

安装插件后，打开设置，搜索 **知乎**，填写：

| 配置项 | 说明 |
| --- | --- |
| `zhihu.baseUrl` | 已部署后端的地址，不要末尾斜杠。必须配置，没有默认值 |
| `zhihu.cookie` | 知乎 Cookie（从浏览器复制登录后的 Cookie 头）。后端用无头浏览器刷新后会自动覆盖 |
| `zhihu.recommendLimit` | 推荐列表每次条数，1–20，默认 8 |

## 3. 安装插件

GitHub Actions 会在每次推送到默认分支时打包 `.vsix`，并**覆盖**名为 `latest` 的 Release（不会保留历史包）。

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

生成的 `zhihu.vsix` 同样可以用「从 VSIX 安装」。
