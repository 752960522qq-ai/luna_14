# 天空决斗 / Sky Duel

一款为手机横屏设计的 3D 喷气式战机空战原型，驾驶 F-86 佩刀或米格-15，在海面与云层上空同敌机缠斗。

## 操作

- 方向键：控制俯仰与转向
- 开火：按住发射机炮
- 加力：短时提高速度，可自动恢复
- 击落 3 架敌机完成 sortie

## 构建 APK

在 GitHub Actions 的 **Build Android APK** 工作流中手动运行，或推送至 `main` 自动构建。生成的 `sky-duel-debug-apk` artifact 内含可安装的 debug APK。

Three.js 已随 APK 一同打包，游戏运行无需网络。
