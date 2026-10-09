# 气泡环形舞台 CSS 表面改造方案

## 1. 目标与边界

本方案只改变“执行今天 / 准备明天”气泡环形舞台的表面视觉，不改变当前布局和交互。

允许修改的文件：

- `src/features/day-plan/components/todayStage.css`
- `src/features/day-plan/components/todayBubbleMotion.css`

禁止修改的内容：

- `src/features/day-plan/components/TodayBubbleStage.tsx`
- 气泡数量、节点顺序、角度、半径和环形位置
- `.bubble-canvas` 的尺寸和宽高比
- `.rhythm-bubble` 的尺寸逻辑
- `.progress-orb` 的中心定位和整体尺寸逻辑
- JSX 中的 inline `transform`
- 点击、长按、完成、安排、查看详情等交互
- 数据层、路由模型和业务状态计算

当前组件通过 JSX inline `transform` 负责把气泡放到环形轨道上。动效只能使用独立的 `translate` 和 `rotate` 属性，不能在 `@keyframes` 中重新写 `transform`，否则会覆盖环形定位。

## 2. 总体视觉方向

推荐方向：**柔雾半透明气泡**。

目标是让气泡看起来有轻微的材质和悬浮感，但仍然保持清晰、安静、适合日程执行场景。不要使用强烈玻璃拟态、霓虹发光或大幅漂移。

核心原则：

- 使用暖白半透明背景，形成柔和的层次。
- 使用细边框、顶部高光和非常淡的内阴影表现材质。
- 使用带暖色倾向的扩散阴影，让气泡从页面背景中轻轻浮起。
- 透明度只用于背景、边框和阴影，不降低整颗气泡的 `opacity`。
- 当前任务用酒红色强调，已完成用低饱和绿色，待完成用低饱和金色。
- 未安排和只读状态降低背景、边框和阴影对比度，但保持文字可读。
- 中间进度圆保持现有位置和尺寸，只调整轨道、内芯、高光和阴影。

## 3. `todayStage.css` 改造方案

建议把下面的覆盖规则放在现有气泡、图标和进度环规则之后，减少对原有布局规则的影响。

### 3.1 舞台视觉变量

```css
.bubble-stage {
  --bubble-surface: rgba(255, 252, 249, 0.78);
  --bubble-line: rgba(218, 198, 189, 0.84);
  --bubble-shadow: rgba(109, 71, 56, 0.1);
  --bubble-highlight: rgba(255, 255, 255, 0.86);
}
```

这些变量只控制材质，不参与节点定位。

### 3.2 普通气泡材质

```css
.rhythm-bubble {
  background: var(--bubble-surface);
  border-color: var(--bubble-line);
  box-shadow:
    0 8px 20px var(--bubble-shadow),
    inset 0 1px 0 var(--bubble-highlight),
    inset 0 -7px 15px rgba(154, 111, 93, 0.045);
  backdrop-filter: blur(8px) saturate(108%);
  -webkit-backdrop-filter: blur(8px) saturate(108%);
  isolation: isolate;
  transition:
    transform 0.18s ease,
    translate 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    rotate 0.24s ease,
    box-shadow 0.24s ease,
    border-color 0.24s ease,
    background 0.24s ease;
}

.rhythm-bubble::before {
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: inherit;
  background:
    linear-gradient(
      145deg,
      rgba(255, 255, 255, 0.62),
      rgba(255, 255, 255, 0) 46%,
      rgba(186, 145, 126, 0.04)
    );
  content: "";
  pointer-events: none;
}

.rhythm-bubble > * {
  position: relative;
  z-index: 1;
}
```

`:before` 只负责一层很淡的斜向高光，不改变内容布局。`backdrop-filter` 是增强项，即使浏览器不支持，半透明背景和阴影也应保持可用。

### 3.3 悬停、聚焦和按压

```css
.rhythm-bubble:hover {
  box-shadow:
    0 11px 24px rgba(109, 71, 56, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    inset 0 -7px 15px rgba(154, 111, 93, 0.05);
}

.rhythm-bubble:focus-visible {
  outline: 2px solid rgba(165, 70, 98, 0.42);
  outline-offset: 2px;
  box-shadow:
    0 11px 24px rgba(109, 71, 56, 0.15),
    0 0 0 4px rgba(165, 70, 98, 0.07),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.rhythm-bubble.pressing {
  border-color: var(--wine);
  box-shadow:
    0 0 0 5px rgba(165, 70, 98, 0.08),
    0 8px 17px rgba(109, 71, 56, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
```

悬停和聚焦只增加少量层次，不能造成明显放大或改变气泡在轨道上的位置。

### 3.4 图标和完成标记

```css
.bubble-icon {
  background: rgba(245, 236, 231, 0.76);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    0 2px 6px rgba(109, 71, 56, 0.06);
}

.bubble-check {
  border-color: rgba(255, 252, 249, 0.96);
  box-shadow:
    0 2px 5px rgba(39, 115, 68, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.42);
}
```

### 3.5 四种状态

#### 当前任务

当前任务应当最容易识别，但避免使用霓虹光。

```css
.rhythm-bubble.current {
  border-color: var(--wine);
  background: rgba(255, 248, 249, 0.8);
  box-shadow:
    0 11px 26px rgba(165, 70, 98, 0.14),
    0 0 0 4px rgba(165, 70, 98, 0.06),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 -7px 15px rgba(165, 70, 98, 0.035);
}

.rhythm-bubble.current .bubble-icon {
  background: rgba(246, 227, 233, 0.82);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 2px 7px rgba(165, 70, 98, 0.08);
}
```

#### 已完成

```css
.rhythm-bubble.completed {
  border-color: rgba(117, 174, 135, 0.9);
  background: rgba(243, 250, 245, 0.74);
  box-shadow:
    0 8px 18px rgba(39, 115, 68, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    inset 0 -7px 15px rgba(39, 115, 68, 0.035);
}

.rhythm-bubble.completed .bubble-icon {
  background: rgba(226, 241, 230, 0.84);
}
```

#### 待完成

```css
.rhythm-bubble.upcoming {
  border-color: rgba(217, 187, 115, 0.92);
  background: rgba(255, 250, 237, 0.78);
  box-shadow:
    0 8px 18px rgba(155, 112, 36, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    inset 0 -7px 15px rgba(155, 112, 36, 0.035);
}

.rhythm-bubble.upcoming .bubble-icon {
  background: rgba(251, 240, 217, 0.86);
}
```

#### 未安排和只读

不要继续使用整颗气泡的 `opacity: 0.78`，否则标题和状态文字会一起变淡。

```css
.rhythm-bubble.unprepared,
.rhythm-bubble.readonly {
  border-color: rgba(190, 180, 173, 0.68);
  background: rgba(246, 243, 240, 0.6);
  opacity: 1;
  box-shadow:
    0 5px 12px rgba(109, 71, 56, 0.055),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.rhythm-bubble.unprepared .bubble-icon,
.rhythm-bubble.readonly .bubble-icon {
  background: rgba(238, 234, 230, 0.72);
}
```

### 3.6 轨道和装饰点

轨道只作背景辅助，不应抢过任务气泡和中心圆。

```css
.bubble-orbit {
  border-color: rgba(190, 151, 133, 0.2);
}

.orbit-b {
  opacity: 0.45;
}

.bubble-speck {
  background: rgba(214, 166, 148, 0.48);
  box-shadow: 0 0 0 3px rgba(214, 166, 148, 0.035);
}

.speck-b {
  background: rgba(183, 153, 190, 0.42);
}
```

## 4. 中心进度圆

保持 `.progress-orb` 的位置、宽度和 `transform: translate(-50%, -50%)` 不变，只覆盖 `.progress-ring` 的材质。

```css
.progress-ring {
  background:
    conic-gradient(
      var(--wine) var(--progress),
      rgba(224, 207, 199, 0.62) var(--progress)
    );
  box-shadow:
    0 14px 30px rgba(109, 71, 56, 0.13),
    0 0 0 1px rgba(255, 255, 255, 0.78),
    inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.progress-ring::before {
  inset: 9px;
  background:
    radial-gradient(
      circle at 34% 27%,
      rgba(255, 255, 255, 0.96),
      rgba(255, 252, 249, 0.96) 53%,
      rgba(246, 235, 230, 0.96)
    );
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.92),
    inset 0 -8px 18px rgba(196, 157, 143, 0.08);
}

.progress-ring strong {
  color: #3d302c;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.72);
}

.progress-ring strong small {
  color: rgba(139, 125, 119, 0.88);
}

.progress-ring span {
  color: var(--wine);
}

.progress-ring em {
  color: rgba(139, 125, 119, 0.92);
}

.progress-ring::after {
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(255, 255, 255, 0.34);
  border-radius: 50%;
  content: "";
  pointer-events: none;
  opacity: 0.7;
}
```

不要对 `.progress-orb` 或 `.progress-ring` 做持续缩放，也不要重新设置其定位 `transform`。中心圆的稳定感比持续运动更重要。

## 5. `todayBubbleMotion.css` 动效方案

当前浮动动效保留结构，只降低幅度、拉长周期，并让不同状态拥有不同的“活跃度”。

### 5.1 动效变量

```css
.rhythm-bubble {
  --bubble-drift: 3px;
  --bubble-sway: 1.2px;
  --bubble-tilt: 0.35deg;
  --bubble-duration: 6.8s;
  animation: bubble-float var(--bubble-duration) ease-in-out infinite;
  translate: 0 0;
  will-change: translate, rotate;
}

.rhythm-bubble.current {
  --bubble-drift: 5px;
  --bubble-sway: 1.8px;
  --bubble-tilt: 0.55deg;
  --bubble-duration: 5.8s;
}

.rhythm-bubble.completed {
  --bubble-drift: 1px;
  --bubble-sway: 0.35px;
  --bubble-tilt: 0.1deg;
  --bubble-duration: 9s;
}

.rhythm-bubble.unprepared,
.rhythm-bubble.readonly {
  --bubble-drift: 0.5px;
  --bubble-sway: 0.2px;
  --bubble-tilt: 0deg;
  --bubble-duration: 10s;
}
```

### 5.2 低幅浮动关键帧

继续使用 `translate` 和 `rotate`，不要改成 `transform`。

```css
@keyframes bubble-float {
  0%,
  100% {
    translate:
      calc(var(--bubble-sway) * -0.45)
      calc(var(--bubble-drift) * -0.35);
    rotate: calc(var(--bubble-tilt) * -1);
  }

  38% {
    translate:
      calc(var(--bubble-sway) * 0.3)
      calc(var(--bubble-drift) * 0.28);
    rotate: calc(var(--bubble-tilt) * 0.35);
  }

  72% {
    translate:
      calc(var(--bubble-sway) * 0.45)
      calc(var(--bubble-drift) * -0.16);
    rotate: calc(var(--bubble-tilt) * -0.25);
  }
}
```

### 5.3 交互时暂停浮动

```css
.rhythm-bubble:hover,
.rhythm-bubble:focus-visible,
.rhythm-bubble.pressing {
  animation-play-state: paused;
  translate: 0 -2px;
}

.rhythm-bubble:active {
  translate: 0 1px;
}
```

### 5.4 减少动效支持

保留并检查现有规则，确保系统设置减少动效时气泡完全静止。

```css
@media (prefers-reduced-motion: reduce) {
  .rhythm-bubble {
    animation: none;
    translate: 0 0;
    rotate: 0deg;
    will-change: auto;
  }

  .rhythm-bubble:hover,
  .rhythm-bubble:focus-visible,
  .rhythm-bubble.pressing {
    translate: 0 0;
  }
}
```

已有的按节点序号延迟可以保留。若希望相位更松散，可以调整延迟，但这不是本次改造的必要项。

## 6. 状态视觉对照表

| 状态 | 背景 | 边框 | 阴影 | 浮动 | 视觉重点 |
| --- | --- | --- | --- | --- | --- |
| 普通待完成 | 暖白半透明 | 灰米色 | 低强度暖色 | 6.8 秒低幅 | 保持安静、可扫描 |
| 当前任务 | 略偏粉白 | 酒红色 | 酒红色淡外圈 | 5.8 秒低幅 | 最容易识别 |
| 已完成 | 浅绿色半透明 | 低饱和绿色 | 很轻的绿色阴影 | 9 秒近似静止 | 传达完成但不抢焦点 |
| 待完成 | 淡奶油色 | 低饱和金色 | 很轻的金色阴影 | 使用普通低幅 | 与当前任务区分 |
| 未安排 | 灰米色半透明 | 降低对比度 | 很轻 | 10 秒近似静止 | 保持文字清晰 |
| 只读 | 灰米色半透明 | 降低对比度 | 很轻 | 10 秒近似静止 | 表达不可操作 |

## 7. 实现顺序

1. 在 `todayStage.css` 中加入舞台视觉变量。
2. 覆盖 `.rhythm-bubble` 的背景、边框、阴影和高光。
3. 覆盖 `.current`、`.completed`、`.upcoming`、`.unprepared`、`.readonly` 状态颜色。
4. 覆盖 `.bubble-icon`、`.bubble-check`、轨道和装饰点。
5. 覆盖 `.progress-ring` 和 `.progress-ring::before`。
6. 在 `todayBubbleMotion.css` 中降低普通、当前、完成和未安排状态的浮动幅度。
7. 检查悬停、聚焦、按压时是否暂停动画。
8. 检查 `prefers-reduced-motion: reduce` 是否完全静止。
9. 全程不要修改 `TodayBubbleStage.tsx`。

## 8. 验收标准

### 视觉验收

- 气泡仍在原来的环形位置和半径上。
- 节点数量、顺序和尺寸逻辑没有变化。
- 中心进度圆没有变大、变小或偏移。
- 气泡文字没有因为透明度而变得难以阅读。
- 当前任务明显，但没有霓虹发光感。
- 已完成、待完成、未安排和只读有明确区别。
- 浮动表现为轻微呼吸，不是明显漂移。
- 悬停、键盘聚焦和按压反馈仍然立即可见。
- 系统开启减少动效后，气泡不再持续运动。
- 小屏幕上气泡不会因为样式变化产生额外重叠或抖动。

### 工程验收

```bash
npm run typecheck
npm run lint
npm run build
npm run verify:local
```

本次只涉及 CSS 文件，不需要修改数据层、服务层、路由模型或组件逻辑。若执行过程中发现必须修改 JSX 才能实现视觉效果，应先停下来确认，因为这超出了本方案的范围。
