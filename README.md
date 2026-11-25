# 鳥籠 · 纯前端版

这个目录不跑 `server.py`。聊天由浏览器直接请求 OpenAI 兼容接口，记忆/历史/场景状态只存在当前设备的浏览器里。

## 本机预览

```bash
cd dist-pure
python -m http.server 8740
# 浏览器打开 http://127.0.0.1:8740
```

不要直接双击 `index.html`：`file://` 下模型请求和部分浏览器能力会被限制。HBuilderX 打包壳或 GitHub Pages 都可以。

## GitHub Pages

把 `dist-pure` 里的**全部文件**上传到仓库根目录（或 `docs/`），在 Settings → Pages 选择对应分支/目录。网页地址会是 `https://<用户名>.github.io/<仓库名>/`，本目录全部用相对路径，能直接跑。

注意：仓库里不要放 `config.json`，也不要把 API Key 写进任何文件。首次打开后在「设置」里填 Base URL / Key / 模型名，Key 只保存在这台设备的浏览器。

> 隐私提醒：人设文本（含 `我的档案.md`）会打包进 `pure-data.js` 才能在浏览器里拼提示词。GitHub Pages 是公开站点，别人能直接打开这个 JS；不想公开人设，就用 HBuilderX 打本地壳，或部署到不公开的静态空间。

## 手机端

部署到 Pages 后，iPhone Safari 打开网址 → 分享 → 添加到主屏幕。顶栏会避开刘海，屏幕底部会避开 Home 指示条。
如果之前已经从主屏幕打开过旧版，先长按图标删除，再用 Safari 重新添加一次；iOS 会缓存旧的 manifest。

## 数据

- 记忆 / 历史 / 当前场景 / 设置：`localStorage`，换设备或清缓存会丢。
- 素材：`assets/` 全部是原包文件。
- 附件：纯前端先支持 txt / md / csv / json / html / py / js 等文本；PDF / Word 正文提取暂不支持。

## 体积

完整素材约 262MB（BGM 150MB、立绘 43MB、背景 30MB、CG 8.6MB）。GitHub Pages 单站点上限 1GB，够用；首次打开不会一次加载全部，只有当前背景/立绘/BGM 会被请求。
