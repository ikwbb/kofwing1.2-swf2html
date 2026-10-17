# kofwing1.2-swf2html

把 Flash 小游戏《拳皇 Wing 1.2》（`kof_wing_12.swf`，Flash 8 / ActionScript 2）转成**原生 HTML5**（Canvas 2D + JavaScript）的工具集。

转出来的游戏不需要 Flash、不需要 Ruffle，浏览器运行时也不读 SWF、不解释执行任何 Flash 字节码。SWF 只在构建时拆解一次，变成“图片 + 音效 + 数据 + JavaScript”。

> **本 repo 不包含任何游戏内容。** 没有 SWF、没有转换后的游戏代码、图片、音效、字体或时间轴数据。你必须自己提供 `kof_wing_12.swf`，构建结果（`build/`、`dist/`）只供个人使用，请勿分发。游戏的版权属于原作者。

---

## 用法

### 需要的东西

- Python 3.8 以上，加上 Pillow（需支持 WebP，一般 pip 安装的版本都有）
- Java 8 以上（只用来运行 FFDec 导出图形和音效）
- 你自己的 `kof_wing_12.swf`（测试过的版本 SHA-256：`96a16c32ca98ad391cd5e56109d9ca5f0bc64b17e705ae31e7d2a71df6306b40`）
- 可选：Node.js（检查生成的 JS、跑自动测试）

### 三条命令

```bash
python3 -m pip install -r requirements.txt   # Pillow
python3 tools/get_ffdec.py                   # 下载 JPEXS FFDec 22.0.2 到 third_party/（只需一次）
python3 build.py /path/to/kof_wing_12.swf    # 生成 dist/
```

完成后打开 `dist/index.html` 就能玩。直接双击打开（`file://`）可以，用本地服务器也可以：

```bash
cd dist && python3 -m http.server 8000      # 然后开 http://localhost:8000
```

一般电脑上整个构建大约几分钟，大部分时间花在 FFDec 渲染和反混淆。每一步的输出都会留在 `build/`，再跑一次会跳过已完成的步骤；加 `--clean` 可以全部重做。

其他选项：

```
python3 build.py kof_wing_12.swf -o 其他输出文件夹
python3 build.py kof_wing_12.swf --ffdec /path/to/ffdec.jar    # 或设置环境变量 FFDEC_JAR
```

如果机器无法连上 GitHub，可以先在别处下载 [`ffdec_22.0.2.zip`](https://github.com/jindrapetrik/jpexs-decompiler/releases/tag/version22.0.2)，再运行 `python3 tools/get_ffdec.py ffdec_22.0.2.zip`。

### 操作方式（原游戏的按键）

| | 移动 | 拳 | 脚 | 轻拳 | 轻脚 | 特殊（O / L） | 确认 |
|---|---|---|---|---|---|---|---|
| 1P | W A S D | J | K | U | I | O、L | J |
| 2P | 方向键 | 数字键 1 | 数字键 2 | 数字键 4 | 数字键 5 | 数字键 6、3 | 数字键 1 |

F1–F4 是游戏本身的快捷键（声音、全屏幕、回主菜单）。存盘和按键设置会存在浏览器的 `localStorage`。

### 自动测试（可选）

```bash
cd test && npm install && npx playwright install chromium
node smoke.js ../dist/index.html     # 开机 → 菜单 → 选人 → 对战，确认有扣血、没有脚本错误
```

---

## 原理

### 0. 源文件案

| 项目 | 数值 |
|---|---|
| 格式 | SWF 第 8 版，未压缩（`FWS`），约 18.6 MB |
| 语言 | ActionScript 2（AVM1 字节码） |
| 舞台 | 660 × 485，每秒 40 格 |
| 内容 | 约 1,500 个视频片段、4,872 个矢量图形、236 个音效、字体、按钮、文本 |
| 代码 | 5,466 段脚本（帧脚本、`#initclip` 类定义、`onClipEvent`、按钮事件） |

现成的反编译器（例如 FFDec）在这个文件上不是卡死就是输出空白，因为**所有脚本都被混淆过**。所以 FFDec 只用来导出图形和音效，代码部分全部由本 repo 自己处理。

### 1. 混淆手法：控制流程平坦化

每一段脚本都被改写成这种形式（示意）：

```
\x01 = 37;                      // 状态变量，名字是控制字符
loop:
  if (\x01 == 37) { ...一小段真正的程序...; \x01 = \x04\x05(\x01, 12); goto loop }
  if (\x01 == 91) { ... }
```

- 状态变量名称是 `\x01`、`\x03` 这类控制字符，另有辅助函数 `\x04\x05` 计算下一个状态。
- 原本循序的程序被切成小块，由分派器依状态值跳来跳去，if / else、循环的结构完全看不出来。
- 跳转目标落在垃圾标签（SWF 标签类型 253、255）里，一般反编译器把它们当未知数据略过，指令流因此断掉。
- `&&`、`||`、`?:` 也被拆成条件跳转，混在分派逻辑中。

### 2. 反混淆与反编译：`tools/deobjs.py`

`tools/avm1.py` 是 AVM1 指令解码器，`deobjs.py` 在它上面做了一个追踪器（Tracer），把**混淆器的变量和游戏本身的变量分开处理**：

1. **混淆变量用实际值运行。** 碰到状态变量或 `\x04\x05` 的调用就真的算出结果，所以每次分派跳到哪里都是确定的，整个分派器被“拉直”。
2. **游戏变量用符号处理。** 真正的游戏逻辑（例如 `this.life_now - r4`）不求值，建成表达式树，最后输出成代码。
3. **还原短路运算。** 可能是 `&&` / `||` / `?:` 的分支先推测运行两边；如果在同一位置、以相同堆栈状态会合，就合并回一个表达式。推测运行有 40 万步上限，避免病态程序段让构建卡住。
4. **重建结构。** 拉直后的“带 goto 的程序”转成嵌套 `if / else`；少数无法干净还原的地方（多半是循环）输出成 `$loop: for(;;) switch($L) { … }` 小状态机，语意正确，只是较难读。
5. **AVM1 细节。** `DefineFunction2` 会把 `this`、`arguments`、`super`、`_root`、`_parent`、`_global` 预载到寄存器，追踪器会换回名称；`for..in` 压进堆栈的一串键仿真成迭代器 `$.forin(obj)`。

`tools/build_code.py` 用多个行程平行处理全部脚本，输出 `code.js`。测试过的 SWF 上 5,466 段全部转换成功、0 错误，约 12.5 万行 JavaScript。

### 3. AS2 → JavaScript 的翻译规则

| AS2 的行为 | 对应做法 |
|---|---|
| 访问 `undefined.x` 不会报错，只得到 `undefined` | 成员访问一律用 `$.m(obj, "x")`、`$.sm(obj, "x", v)`、`$.cm(obj, "f", [args])`，遇到空值安静传回 |
| 变量查找走作用域链：目前片段 → `_global` → 内置对象 | 每段程序包在 `with ($sc) { … }` 里，`$sc` 是 Proxy，依序查片段本身、`KOF.G`（`_global`）、`KOF.B`（内置对象） |
| 类用 `function` + `prototype` + `extends`、`super` | `$.ext(sub, sup)` 设原型链与 `__constructor__`；`super(...)`、`super.method()` 转成 `$.supc` / `$.supm` |
| `Object.registerClass("链接名称", 类)` | 存进 `KOF.classes`，创建实例时套用原型并调用构造函数 |
| 弱类型的 `+`、`==` | 依 AVM1 规则输出，例如 `Number(a) + Number(b)`、`$.eq1` |

生成的每段程序长这样（键名 = 片段 ID、帧、第几段）：

```js
"f2568_1_0": function ($sc) {
  var r0, r1, r2, r3;
  with ($sc) {
    $.T($sc).stop();
    this._visible = false;
    ...
  }
},
```

### 4. 素材：`tools/swfparse.py`、`tools/build_data.py`

- **SWF 解析。** 自制解析器读出所有标签：每个片段的帧、放置、移除、标签、声音指令，以及文本、字体（字形路径）、按钮、导出名称，写成 `data.js`。
- **图形。** FFDec 把矢量图形渲染成 PNG，再转成无失真 WebP（约小一半）。完全不透明的矩形图形会加上标记，当遮罩时可以直接用裁切路径。
- **变形图形（Morph Shape）。** 从 FFDec 输出的 SVG 取起点与终点的路径与颜色，运行时依比例插值，直接用矢量画。
- **音效。** 原版 MP3 以 base64 打包进 `sounds.js`。

### 5. 运行环境：`runtime/`（手写，约 2,000 行）

只实现这款游戏用到的 Flash 功能：

- **`as2.js`**：AS2 语言层。作用域 Proxy、路径解析（`_root.a.b`、`../x`）、`$` 辅助函数、`getTimer`、由帧时钟驱动的 `setInterval`、`Array.sortOn`、`watch` / `addProperty`、以 `localStorage` 实现的 `SharedObject`。
- **`engine.js`**：显示清单与时间轴。预先算好每帧的放置状态，跳帧时依记录 ID 决定保留／添加／移除子对象；动作队列分 `#initclip`、构造函数、一般帧脚本三种优先级；实现 `attachMovie`、`duplicateMovieClip`、`swapDepths`、`hitTest`、`getBounds`、`localToGlobal`、`setMask`、`createTextField`、绘图 API 等。
- **`render.js`**：Canvas 2D 绘图。预算好的位图、色彩转换（用合成模式实现，`file://` 也能用）、遮罩、内嵌字体文本、按钮四种状态、`Color`、`TextFormat`、`TextField`。
- **`input.js`**：`Key` 与键盘事件（用 `e.code` 换算 Flash 键码，中文输入法开着也不会卡键）、鼠标与按钮事件、Web Audio、`BitmapData`、固定每秒 40 格的主循环。
- **`patches.js`**：游戏专用的修补，以代码在运行时套用，不修改任何生成出来的游戏代码：
  - 原 SWF 内置的第三方广告 SDK 换成空壳，否则菜单会被卡住；
  - 换局时停掉上一局胜利动作残留的前进处理。
- **`main.js`**、`index.html`：预载图形、按下 Start 后开机。

### 6. 必须重现的 Flash 特殊行为

代码转对了，游戏却还是不对的地方，都在运行环境里补上：

| 行为 | 不处理会怎样 |
|---|---|
| `_lockroot`：角色内部的 `_root` 要指向角色自己 | 攻击判定找不到对手，永远打不中 |
| `BitmapData.draw` / `copyPixels` | 舞台背景全黑 |
| `gotoAndStop(["sk1"])`：单元素数组先转字符串再找标签 | 必杀技打不出来，角色卡在出招状态 |
| 同时按下的方向键依序送入（间隔至少 12 ms） | 游戏会丢掉间隔小于 10 ms 的输入，S+D 这类斜向输入失败 |
| 帧标签不分大小写 | 1P 名字显示错误 |
| 放置子对象前先同步运行该格的 `#initclip` | 组件在类注册前就被创建 |
| 以 `Function.prototype.apply.call` 调用构造函数 | `__proto__ = Math` 的类没有 `.apply` |

### 构建流程总览

```
kof_wing_12.swf ──FFDec──▶ build/ffdec/{shapes/*.png, morphshapes/*.svg, sounds/*.mp3}
       │                                   │
       ├──build_code.py (deobjs.py)──▶ build/code.js
       │                                   ▼
       └──build_data.py (swfparse.py)──▶ dist/{data.js, sounds.js, assets/shapes/*.webp}
                                     runtime/ ──copy──▶ dist/{index.html, js/*.js, code.js}
```

## 目录

```
build.py              一条命令完成全部构建
tools/
  avm1.py             AVM1 指令解码
  deobjs.py           反混淆 + 反编译成 JS
  build_code.py       平行转换所有脚本 → code.js
  swfparse.py         SWF 标签解析
  build_data.py       时间轴／字体／文本／音效／图形 → data.js、sounds.js、WebP
  get_ffdec.py        下载并验证 FFDec
runtime/              手写的 AS2 兼容运行环境与网页
test/                 Playwright 自动测试
```

## 已知限制

- 只针对《拳皇 Wing 1.2》测试过。其他 AS2 游戏可以参考，但运行环境只实现了这款游戏用到的 Flash 功能，混淆器的辨识规则也是针对这个文件。
- 尚未逐一测试每个角色的必杀技、2P 对战、训练模式、破关流程等。
- 有 1 处 AS2 的 `with` 叙述还不支持。

## 授权

本 repo 的代码以 [MIT License](LICENSE) 发布。授权不涵盖游戏本身、SWF 文件，以及任何从 SWF 生成的文件。第三方工具与授权见 [THIRD_PARTY.md](THIRD_PARTY.md)。
