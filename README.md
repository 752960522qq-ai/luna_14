# 天空决斗 / Sky Duel

离线 Android 3D 空战游戏，适配手机横屏。本仓库现已恢复到 v13：包含 MiG-15、F-86F-2、Meteor、B-29、I-15bis、Bf-109 B-1、P-36A 和 F3F-2，以及海面和朝鲜地形。

## v13

- F3F-2：美系 I 级，权重 1.3，耐久 360，机长 7.06 m。满油门平飞调校至 425 km/h，失速临界 118 km/h，爬升参数 14 m/s，水平回转参数 16.5 s，垂直转向参数 10.1 s。
- 两挺独立机枪：M2 为 860 m/s、750 发/分、200 发、伤害 34；7.62 mm 为 810 m/s、1000 发/分、500 发、伤害 13。
- F3F-2 与 P-36A 在战斗中向后收起主轮和尾轮；图鉴保留原始模型姿态。克隆实例独立设置，不改写模型模板。
- F3F-2 的黄色机翼模型与原上传文件字节一致，运行时按 7.06 m 缩放，机头 -Z、上方 +Y。追尾相机位于机尾后 2.3 m、机体上方 2.3 m。
- 活塞飞机支持螺旋桨启动、油门/RPM、发动机关停和击毁减速，以及高速模糊。

v10–v12 的瞄准环/摇杆切换、真实枪口准星与预瞄点、统一玩家/AI 飞行控制、AI 追击与护航、权重 ±1.0 匹配、越界倒计时以及短枪声音效和稳定发动机循环均已包含。

完整数据和验证限制见 [v13 更新说明](docs/v13-update.md)，音效说明见 [v12 音效说明](docs/v12-audio-update.md)。

## 操作

主页面设置可切换摇杆或瞄准环，并保存灵敏度。战斗中按住开火键射击，油门控制发动机输出；桌面调试支持 WASD/方向键和空格开火。AI 对战匹配权重相近的飞机；“米格之舞”沿用 MiG-15 拦截 B-29 编队与 F-86 护航的战役规则。

## 源码与验证

`app/src/main/assets/index.html` 是 Android 实际加载的完整页面；`game.mjs` 是同一嵌入模块的副本。所有模型、音效、Three.js 和 Draco 解码器已包含，游戏无需网络读取资源。

需要 Python 3 和 Node.js 18+，逻辑检查不需要安装 npm 依赖：

```bash
python3 update-v13.py
npm run check
```

`update-v13.py` 使用锁定的 `baseline/v12-index.html` 和 `aircraft-systems-v13.mjs` 生成 v13 页面。检查覆盖原机型配置、新机双武器/飞行、音效、机动和完整页面流程。`validation/` 包含可重复执行的脚本、结果及战斗/图鉴外观截图。

浏览器模型检查需要 Playwright 与 Chromium：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
SKY_DUEL_CHROME=/absolute/path/to/chromium npm run check:browser
```

也可用 `CODEX_PRIMARY_RUNTIME_NODE_MODULES` 指定已有 Playwright 模块目录。浏览器检查使用真实 GLTF/Draco 解码、Web Audio 和 SwiftShader WebGL，并控制动画帧；未进行 Android 真机安装测试。

## 构建 APK

GitHub Actions 的 **Build Android APK** 工作流在 `main` 推送、面向 `main` 的 PR 和手动运行时执行源码生成检查、逻辑检查及 Android 构建。构建环境为 JDK 17、Gradle 8.9、Android SDK 35。产物 `sky-duel-v13-debug-apk` 内含 `app-debug.apk`。

本地安装相同工具后可运行：

```bash
gradle --no-daemon assembleDebug
```

已交付的 `sky-duel-f3f2-v13.apk` 使用与 v12 相同的原游戏签名，可覆盖 v12；Actions 生成的默认 debug APK 使用构建环境的调试签名，证书可能不同。仓库不包含签名私钥或密码。

保留原生壳、使用已交付 v12 APK 更新资源的复现方式：

```bash
python3 package-v13.py /absolute/path/sky-duel-audio-v12.apk
zipalign -f -p 4 unsigned-v13.apk aligned-v13.apk
apksigner sign --ks /absolute/path/authorized-game-key.p12 --ks-pass file:/absolute/path/password-file --out sky-duel-f3f2-v13.apk aligned-v13.apk
apksigner verify --verbose --print-certs sky-duel-f3f2-v13.apk
zipalign -c -p 4 sky-duel-f3f2-v13.apk
```

v12 基线 SHA-256：`d3ce5696d2dd523fff08ad0561205879a4887761a80c2cac95ebf85b5245f187`。

B-29 模型由 Sketchfab 用户 manilov.ap 提供，采用 CC BY 4.0 许可：[模型来源](https://sketchfab.com/3d-models/b29-48aa117b88a34c5194370e868114484c)。其他新飞机模型由用户提供。音效来源见 [SOUNDS_CREDITS.md](SOUNDS_CREDITS.md)。
