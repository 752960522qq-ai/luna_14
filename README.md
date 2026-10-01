# 天空决斗 / Sky Duel

离线 Android 3D 空战游戏，适配手机横屏。v14 包含 MiG-15、F-86F-2、Meteor、B-29、I-15bis、Bf-109 B-1、P-36A 和 F3F-2，以及空域争夺与“米格之舞”战役。

## v14

- 图鉴统一使用“水平转弯性能”和“垂直转弯性能”；航速值去除括号说明，删除追尾视角、起落架项目及介绍中的低速失速句。
- 空域争夺模式为玩家与 7 架我方 AI 对抗 8 架敌方 AI。双方 AI 均从玩家飞机 BR ±1.0 的机型池匹配。
- 地图为 6 × 6 km，基地位于两个对角，中央为 A。标记显示 A 的高度；半径 300 m 的三维球形占领范围不显示。
- 初始进度及双方积分均为 0。人数更多的一方推进占领，平局或无人时冻结进度；中立点需 15 秒，敌占点需 30 秒。占领方每秒获得 1 分，先到 100 分或全歼对方获胜。
- 回到己方基地 300 m 内，每秒恢复最大生命和弹药的 10%。每架飞机独立管理生命、弹药、冷却和目标；AI 会在生命或弹药不足时返航。
- 全员不可复活。玩家阵亡后观战存活队友，可用左右按钮或 Q/E 切换；暂停和继续不会复活玩家。
- 保留 F3F-2、战斗起落架、原机型数值、飞行物理、音效和战役。详情及验证限制见 [v14 更新说明](docs/v14-update.md)。

## v13

- F3F-2：美系 I 级，权重 1.3，耐久 360，机长 7.06 m。满油门平飞调校至 425 km/h，失速临界 118 km/h，爬升参数 14 m/s，水平回转参数 16.5 s，垂直转向参数 10.1 s。
- 两挺独立机枪：M2 为 860 m/s、750 发/分、200 发、伤害 34；7.62 mm 为 810 m/s、1000 发/分、500 发、伤害 13。
- F3F-2 与 P-36A 在战斗中向后收起主轮和尾轮；图鉴保留原始模型姿态。克隆实例独立设置，不改写模型模板。
- F3F-2 的黄色机翼模型与原上传文件字节一致，运行时按 7.06 m 缩放，机头 -Z、上方 +Y。追尾相机位于机尾后 2.3 m、机体上方 2.3 m。
- 活塞飞机支持螺旋桨启动、油门/RPM、发动机关停和击毁减速，以及高速模糊。

v10–v12 的瞄准环/摇杆切换、真实枪口准星与预瞄点、统一玩家/AI 飞行控制、AI 追击与护航、权重 ±1.0 匹配、越界倒计时以及短枪声音效和稳定发动机循环均已包含。

完整数据和验证限制见 [v13 更新说明](docs/v13-update.md)，音效说明见 [v12 音效说明](docs/v12-audio-update.md)。

## 操作

主页面设置可切换摇杆或瞄准环，并保存灵敏度。战斗中按住开火键射击，油门控制发动机输出；桌面调试支持 WASD/方向键和空格开火。“米格之舞”沿用 MiG-15 拦截 B-29 编队与 F-86 护航的战役规则。

## 源码与验证

`app/src/main/assets/index.html` 是 Android 实际加载的完整页面；`game.mjs` 是同一嵌入模块的副本。所有模型、音效、Three.js 和 Draco 解码器已包含，游戏无需网络读取资源。

需要 Python 3 和 Node.js 18+，逻辑检查不需要安装 npm 依赖：

```bash
python3 update-v14.py
npm run check
node validation/check-simulation-v14.mjs
```

`update-v14.py` 使用锁定的 `baseline/v13-index.html` 和 `airspace-systems-v14.mjs` 生成 v14 页面。检查覆盖八机型匹配、三维球、15/30 秒占领、补给、无复活、观战、暂停、胜负、原战役，以及飞行、双武器和音效。`validation/` 保存可重复执行的脚本与结果。

浏览器模型检查需要 Playwright 与 Chromium：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
SKY_DUEL_CHROME=/absolute/path/to/chromium npm run check:browser
```

也可用 `CODEX_PRIMARY_RUNTIME_NODE_MODULES` 指定已有 Playwright 模块目录。浏览器检查使用真实 GLTF/Draco 解码、Web Audio 和 SwiftShader WebGL，并控制动画帧；未进行 Android 真机安装测试。

## 构建 APK

GitHub Actions 的 **Build Android APK** 工作流在 `main` 推送、面向 `main` 的 PR 和手动运行时执行源码生成检查、逻辑检查及 Android 构建。构建环境为 JDK 17、Gradle 8.9、Android SDK 35。产物 `sky-duel-v14-debug-apk` 内含 `app-debug.apk`。

本地安装相同工具后可运行：

```bash
gradle --no-daemon assembleDebug
```

已交付的 `sky-duel-airspace-v14.apk` 使用原游戏签名，versionCode 为 14，可覆盖原签名的旧版；Actions 生成的默认 debug APK 使用构建环境的调试签名，证书可能不同。仓库不包含签名私钥或密码。

保留原生壳、使用已交付 v13 APK 更新资源的复现方式：

```bash
python3 package-v14.py /absolute/path/sky-duel-f3f2-v13.apk
zipalign -f -p 4 unsigned-v14.apk aligned-v14.apk
apksigner sign --ks /absolute/path/authorized-game-key.p12 --ks-pass file:/absolute/path/password-file --out sky-duel-airspace-v14.apk aligned-v14.apk
apksigner verify --verbose --print-certs sky-duel-airspace-v14.apk
zipalign -c -p 4 sky-duel-airspace-v14.apk
```

v13 基线 SHA-256：`94bb52cbe867026467b3932fe41030f59019372b557c945489b39adbddaa2d3f`。打包验证只有页面与 manifest 改变，65 个模型、音效、解码器和原生壳文件内容不变。

B-29 模型由 Sketchfab 用户 manilov.ap 提供，采用 CC BY 4.0 许可：[模型来源](https://sketchfab.com/3d-models/b29-48aa117b88a34c5194370e868114484c)。其他新飞机模型由用户提供。音效来源见 [SOUNDS_CREDITS.md](SOUNDS_CREDITS.md)。
