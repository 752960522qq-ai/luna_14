# 银翼凌云

Android 离线 3D 空战游戏，基于 v17 的 11 架战机、研发与 GP 经济、5 对 5 空域争夺和朝鲜战役。

v18 修复加载重试、存档失败回滚、模型实例资源释放、地图高度采样与临时对象分配；添加新名称、用户提供的战机图标和菜单循环 BGM-1。

## 开发

```sh
npm ci
npm run build:source
npm run check
npx playwright install --with-deps chromium
npm run check:browser
```

可编辑源码位于 `src/`，按飞行、操控、武器、AI、对局、地图、音频、进度和界面划分。`src/parts.json` 明确构建顺序；运行时可变数据归属七个状态对象。子系统目前仍在一个编译作用域中协作，避免在这次修复中同时改变飞行与对局协议。

飞机模型、飞行、武器、AI、研发成本、备弹和音效信息统一在 `data/aircraft.json`。图鉴数字从同一份数据计算，不再手工维护平行表。`game.mjs` 与 Android assets 中的 `index.html` 是确定性构建产物，请通过 `npm run build:source` 更新。

模型 GLB 克隆共享几何、材质与纹理；只有实例创建的螺旋桨模糊面和起落架舱门等资源由实例释放。炸弹拥有自己的几何与材质，离场和重置均释放。

BGM-1 使用 `audio/menu-bgm-1.mp3`，所有菜单与结算页面共用一个循环音频实例。进入对局、暂停、观战与切到后台停止菜单音乐，返回菜单恢复。Android WebView 允许菜单自动播放；普通浏览器可能需要第一次点击。

## Android 构建

使用 JDK 17、Gradle 8.9、Android SDK / Build Tools 35：

```sh
gradle --no-daemon assembleDebug
```

CI 会验证生成文件、运行逻辑回归、地形 GLB 采样检查和真实 Chromium WebGL/音频/UI 检查，再输出 APK。浏览器检查使用软件渲染，不能代替 Android 真机帧率与听音验收。

应用包名保持 `com.luna.skyduel`，版本为 `1.1.0` / `versionCode 18`。最终交付 APK 使用已恢复的原游戏签名，证书与 v17 一致，可覆盖同签名旧版并保留应用存档。CI 的中间 debug APK 使用临时调试签名，最终签名步骤在仓库外执行；签名私钥与密码不进入 Git。

历史补丁、快照与旧检查已归档到 `tools/legacy/`，不再是当前源码或构建输入。
